// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SmartTransferLib } from "../../libraries/SmartTransferLib.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { RevenueSplitLib } from "../../shared/libraries/RevenueSplitLib.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IFactoryInstance } from "../../interfaces/IFactoryInstance.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { IExitTaxSink } from "../../interfaces/IExitTaxSink.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";

/// @dev The one instance read this sink needs beyond `IFactoryInstance`. Declared here rather than
///      widened onto the shared interface: `weth` is a payout detail of this contract's claim path and
///      nothing else reads it back through an instance.
interface IInstanceWETH {
    function weth() external view returns (address);
}

/**
 * @title ERC404ExitTaxSink
 * @notice Holds the vault and creator legs of the ERC404 bonding exit tax until they are claimed, one
 *         accrual per instance. A sell above the exit-tax threshold pushes both legs here; the
 *         destinations are paid from here, never from the sell.
 * @dev WHY THIS CONTRACT EXISTS. Two reasons, and the second is the one that put it on disk.
 *
 *      1. NEITHER DESTINATION CAN HOLD A SELL HOSTAGE. `sellBonding` is a user path. A creator whose
 *         `owner()` is a reverting contract, or an alignment vault whose `receiveContribution` reverts
 *         (full, below-min, or upgraded), would make every above-threshold sell revert if the legs were
 *         pushed to them inline. Accruing and claiming is the same shape as the graduation
 *         stash-and-retry on `LiquidityDeployerModule.flushPendingVaultCut`.
 *
 *      2. EIP-170. The accrual could have lived in the instance's own storage with a `claimExitTax` on
 *         the instance, and it did in the first cut of this mechanism — measured at +1,144B of instance
 *         runtime against 512B of budget above the headroom floor that
 *         `test/factories/erc404/eip170-diet-gate.sh` enforces. `ERC404BondingOps`, the existing
 *         delegatecall sibling, is not the escape hatch: it holds 277B of usable budget and the diet
 *         runs the other way. So the mechanism needed a THIRD contract home, and this is it — reached
 *         by an ordinary external call rather than a delegatecall, so none of its bytecode lands on
 *         either of the two contracts that are out of room.
 *
 *      THE LEGS ARE NOT IN THE INSTANCE'S BALANCE, which is the property worth having on top of the
 *      byte budget. `withdrawDust` is an owner lever over the instance's surplus balance; an accrual
 *      held here is outside its reach structurally rather than by being subtracted from a locked total
 *      the owner's own contract computes. No lever on this contract moves an accrual anywhere but to
 *      the destination the instance itself names.
 *
 *      THIS CONTRACT IS A SINGLETON, keyed by instance, wired into each instance at create through the
 *      sealed `modules[EXIT_TAX_SINK]` slot (`initModule`, factory-only and set-once). It holds no
 *      owner, no configuration and no pause: every address it pays is read back from the instance at
 *      claim time, so there is no stored payee to repoint and a stolen key changes nothing here.
 *
 *      AN UNWIRED SINK MEANS NO EXIT TAX. The instance reads its sink slot inside the split and skips
 *      the tax entirely when it is zero, so a deployment that wires no sink charges exactly the
 *      `bondingFeeBps` skim it charged before the tax existed. That is the lever's OFF position.
 */
contract ERC404ExitTaxSink is IExitTaxSink, ReentrancyGuard {
    /// @notice Stashing was attempted by an address the master registry does not know as an instance.
    error NotRegisteredInstance();
    /// @notice The requested leg is empty.
    error NothingToClaim();

    /// @notice A sell above the threshold accrued `vaultCut` and `creatorCut` for `instance`. The
    ///         tax's protocol leg never arrives here: the instance pays it to the treasury inline and
    ///         reports it as `BondingFeePaid`, the same event the below-threshold skim has always used.
    event ExitTaxAccrued(address indexed instance, address indexed seller, uint256 vaultCut, uint256 creatorCut);

    /// @notice The tax's 1% protocol leg was paid through to `instance`'s treasury during the sell.
    /// @dev A separate event from the instance's own `BondingFeePaid`, which reports the ordinary
    ///      below-threshold skim. The two are different money charged on different parts of one sell,
    ///      and a tithe report that folded them into one event would double-count neither but would
    ///      lose which rate produced which.
    event ExitTaxProtocolLegPaid(address indexed instance, uint256 amount);

    /// @notice An accrued leg of `instance` was delivered to `recipient`.
    event ExitTaxClaimed(address indexed instance, address indexed recipient, uint256 amount);

    /// @dev Both legs of one instance's accrual, in a single slot pair. Keyed by the instance so one
    ///      deployed sink serves every collection, the way `pendingVaultCut` does on the deployer module.
    struct Accrual {
        uint256 vault;
        uint256 creator;
    }

    /// @notice Unclaimed exit-tax legs per instance.
    mapping(address => Accrual) public accrued;

    /// @notice The registry that says which addresses are instances and which vaults are still curated.
    /// @dev Immutable, and the only piece of configuration this contract has. Held here rather than
    ///      read back off the caller so a non-instance cannot nominate the registry that vouches for it.
    IMasterRegistry public immutable masterRegistry;

    constructor(address _masterRegistry) {
        masterRegistry = IMasterRegistry(_masterRegistry);
    }

    /// @notice Take the calling instance's whole exit tax, split it 1/19/80, pay the protocol leg
    ///         through and accrue the vault and creator legs for a later claim.
    /// @dev Caller-keyed: the accrual belongs to `msg.sender`, and every address this contract later
    ///      pays is read back from that same `msg.sender`. So the registry gate is about keeping this
    ///      contract's books honest, not about custody — a stash from a stranger could only ever pay
    ///      that stranger's own `protocolTreasury()`, `vault()` and `owner()`.
    /// @dev The SPLIT LIVES HERE, not on the instance: `RevenueSplitLib.split` inlines into whatever
    ///      calls it, and the instance is at its EIP-170 headroom floor. The arithmetic is the same
    ///      primitive graduation and mint settlement take, so the tax is divided the one way this
    ///      protocol divides anything.
    /// @dev The protocol leg is PUSHED, not accrued: it goes to the treasury in the sell's own
    ///      transaction, exactly as the below-threshold `bondingFeeBps` skim has always done straight
    ///      from the instance. A treasury that cannot receive ETH would revert that skim today, so
    ///      this adds no destination that could not already brick a sell — unlike the vault and the
    ///      creator, which are a curated third party and an arbitrary creator address and are the two
    ///      this contract exists to keep off the sell path.
    /// @param seller The seller whose sell was taxed, for the event only.
    function stash(address seller) external payable override {
        if (!masterRegistry.isRegisteredInstance(msg.sender)) revert NotRegisteredInstance();

        RevenueSplitLib.Split memory s = RevenueSplitLib.split(msg.value);
        Accrual storage a = accrued[msg.sender];
        a.vault += s.vaultCut;
        a.creator += s.remainder;
        emit ExitTaxAccrued(msg.sender, seller, s.vaultCut, s.remainder);

        if (s.protocolCut > 0) {
            SafeTransferLib.safeTransferETH(IFactoryInstance(msg.sender).protocolTreasury(), s.protocolCut);
            emit ExitTaxProtocolLegPaid(msg.sender, s.protocolCut);
        }
    }

    /// @notice Deliver one accrued leg of `instance`'s exit tax — the creator's when `creatorLeg` is
    ///         true, the alignment vault's otherwise.
    /// @dev Permissionless, like `flushPendingVaultCut`: anyone may push the accrued ETH to the
    ///      destination the instance names. There is nothing to authorize, because the caller cannot
    ///      influence where it goes.
    /// @dev The two legs are INDEPENDENTLY claimable (one leg per call), so a destination that rejects
    ///      its own leg can never hold the other hostage.
    /// @dev The leg is zeroed BEFORE the external call (checks-effects-interactions). A vault that
    ///      still rejects the contribution reverts the whole transaction and the accrual is restored —
    ///      idempotent, no ETH is lost.
    /// @dev The vault leg faces the same de-curation gate as the graduation rail (noesis-126/-435): a
    ///      de-curated or unset target is not force-fed, and its leg goes to the protocol treasury the
    ///      instance names. The creator leg goes out through `smartTransferETH`, so a creator address
    ///      that cannot receive ETH is paid in WETH rather than stranding the leg.
    /// @param instance   The instance whose leg should be delivered.
    /// @param creatorLeg True for the creator leg, false for the alignment-vault leg.
    function claim(address instance, bool creatorLeg) external override nonReentrant {
        Accrual storage a = accrued[instance];
        uint256 amount = creatorLeg ? a.creator : a.vault;
        if (amount == 0) revert NothingToClaim();

        address to;
        if (creatorLeg) {
            a.creator = 0;
            to = IFactoryInstance(instance).owner();
            SmartTransferLib.smartTransferETH(to, amount, IInstanceWETH(instance).weth());
        } else {
            a.vault = 0;
            to = IFactoryInstance(instance).vault();
            if (to == address(0) || !masterRegistry.isVaultRegistered(to)) {
                to = IFactoryInstance(instance).protocolTreasury();
                SmartTransferLib.smartTransferETH(to, amount, IInstanceWETH(instance).weth());
            } else {
                IAlignmentVault(payable(to)).receiveContribution{ value: amount }(
                    Currency.wrap(address(0)), amount, instance
                );
            }
        }
        emit ExitTaxClaimed(instance, to, amount);
    }

    /// @notice Both unclaimed legs of `instance`, for the app and for tests.
    /// @dev The generated getter for a struct-valued mapping already returns the pair; this is the
    ///      named form, so a caller does not have to know the struct's member order.
    /// @return vaultCut   The alignment vault's unclaimed leg.
    /// @return creatorCut The creator's unclaimed leg.
    function pending(address instance) external view override returns (uint256 vaultCut, uint256 creatorCut) {
        Accrual memory a = accrued[instance];
        return (a.vault, a.creator);
    }
}
