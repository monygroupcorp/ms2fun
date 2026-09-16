// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, StdStorage, stdStorage } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";
import {
    NoFeeClaimingVault,
    NotSupported,
    ActivateStakingFailed,
    SetBondingOpenTimeFailed,
    MaturityTooFarAfterOpenTime,
    MaturityMustBeAfterOpenTime,
    MAX_BONDING_DURATION
} from "../../../src/factories/erc404/ERC404BondingStorage.sol";
import { ERC404StakingModule } from "../../../src/factories/erc404/ERC404StakingModule.sol";
import { CurveParamsComputer } from "../../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { IMasterRegistry } from "../../../src/master/interfaces/IMasterRegistry.sol";
import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

/// @dev A vault with a real pull-claim model: `claimFees()` pushes its whole ETH balance to the
///      caller, which is how fee delivery actually lands staking-reward ETH in the instance balance.
contract PushingFeeVault {
    function claimFees() external returns (uint256 ethClaimed) {
        ethClaimed = address(this).balance;
        if (ethClaimed > 0) {
            (bool ok,) = msg.sender.call{ value: ethClaimed }("");
            require(ok, "fee push failed");
        }
    }

    receive() external payable { }
}

/// @dev A vault whose pull-claim has nothing to give right now. It is NOT an endowment: it has the
///      model, it is merely empty, and `NothingToClaim` is a different answer from `NotSupported`.
contract EmptyClaimVault {
    error NothingToClaim();

    function claimFees() external pure returns (uint256) {
        revert NothingToClaim();
    }

    receive() external payable { }
}

contract MockDeployer is ILiquidityDeployerModule {
    function deployLiquidity(ILiquidityDeployerModule.DeployParams calldata) external payable override { }

    function metadataURI() external view override returns (string memory) {
        return "";
    }
    function setMetadataURI(string calldata) external override { }
}

/**
 * @title ERC404EndowmentStakingGuardTest
 * @notice Two refusals that answer the same shape of finding: a setter that was checked once and then
 *         left to drift.
 *
 *         THE STAKING ONE. An ERC404 collection aligned to an `AlignmentEndowmentVault` could turn
 *         staking on and pay its stakers nothing, forever. The staking stream has exactly one source
 *         — the ETH balance delta `claimAllFees` produces by pulling on each registered vault — and an
 *         endowment has no pull-claim model at all: its `claimFees()` is `revert NotSupported()`. So
 *         the delta is structurally zero, `rewardRate` never leaves zero, and every staker who locks
 *         tokens accrues nothing. `activateStaking` is irreversible, so there is no later moment at
 *         which this can be said. It is now refused at that moment, and only there: creating the
 *         pairing stays legal, and registering one fee-pushing vault alongside the endowment makes the
 *         same call succeed.
 *
 *         THE SCHEDULE ONE. `setBondingMaturityTime` caps `maturity - open` at `MAX_BONDING_DURATION`,
 *         but it reads the open time stored when it runs. `setBondingOpenTime` did not read maturity at
 *         all, so open-far / maturity-at-the-cap / open-back left a stored pair spanning a window
 *         neither setter would have accepted in one call. Both writers now owe the bound.
 *
 * @dev Where the assertions are made. Both bodies live in `ERC404BondingOps`, behind the instance's
 *      discard-returndata trampolines, so through an instance the refusal arrives as that entry
 *      point's generic error. Each refusal is therefore asserted TWICE: once through a real instance,
 *      where the observable fact is that nothing moved, and once against a bare `ERC404BondingOps`
 *      deployment, where the specific error is read by selector rather than inferred. That is the
 *      pattern `ERC404BondingInstance.t.sol` established for the maturity ceiling.
 */
contract ERC404EndowmentStakingGuardTest is Test {
    using stdStorage for StdStorage;

    address public owner = address(0x1);
    address public mockGMR = address(0x700);

    uint256 constant MAX_SUPPLY = 10_000_000 * 1e18;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;
    uint256 constant UNIT = 1_000_000 ether;

    BondingCurveMath.Params curveParams;
    CurveParamsComputer public curveComputer;
    MockMasterRegistry public registry;
    ERC404StakingModule public module;

    function setUp() public {
        curveComputer = new CurveParamsComputer(address(this));
        registry = new MockMasterRegistry();
        module = new ERC404StakingModule(address(registry));
        curveParams = BondingCurveMath.Params({ kCoeff: 0.025 ether, poleWad: 1.0438e18, normalizationFactor: 1e7 });
    }

    // ── Harness ─────────────────────────────────────────────────────────────────────────────────

    /// @dev `owner` acts as the factory here (initialize captures msg.sender), so the factory-only
    ///      setters stay callable from `owner`.
    function _newInstance() internal returns (ERC404BondingInstance inst) {
        vm.startPrank(owner);
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new ERC404BondingOps()));
        inst = ERC404BondingInstance(payable(LibClone.clone(address(impl))));
        inst.initialize(
            owner,
            address(0xBEEF),
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: UNIT,
                liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
                declaredMaxAllowanceBps: 0,
                curve: curveParams
            }),
            address(new MockDeployer()),
            address(0),
            address(new DN404Mirror(owner))
        );
        inst.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: mockGMR,
                protocolTreasury: address(0),
                masterRegistry: address(registry),
                bondingFeeBps: 0,
                weth: address(0xBEEF)
            })
        );
        inst.initializeMetadata("T", "T", "", "", "");
        inst.initializeStaking(address(module));
        vm.stopPrank();
    }

    /// @dev Point `getInstanceVaults(target)` at exactly this set. The registry's own write path only
    ///      ever binds ONE vault at create and `migrateVault` refuses to cross families, so a mixed
    ///      set is reached here the same way the existing `claimAllFees` mixed-set test reaches it.
    function _registerVaults(address target, address[] memory vaults) internal {
        vm.mockCall(
            address(registry),
            abi.encodeWithSelector(IMasterRegistry.getInstanceVaults.selector, target),
            abi.encode(vaults)
        );
    }

    function _one(address a) internal pure returns (address[] memory set) {
        set = new address[](1);
        set[0] = a;
    }

    function _two(address a, address b) internal pure returns (address[] memory set) {
        set = new address[](2);
        set[0] = a;
        set[1] = b;
    }

    /// @dev A REAL `AlignmentEndowmentVault`, not a stand-in. Its `claimFees()` is `external pure` and
    ///      reverts unconditionally, so the un-initialized implementation answers the probe exactly as
    ///      a live clone does — which is the whole point: this test reads the production contract's
    ///      own refusal rather than a mock's imitation of it.
    function _endowment() internal returns (address) {
        return address(new AlignmentEndowmentVault());
    }

    /// @dev A bare Ops deployment wired far enough to reach `activateStaking`'s vault check. Nothing
    ///      here is initialized, so `owner()` reads `address(0)` and `factory` is written directly.
    function _bareOps() internal returns (ERC404BondingOps ops) {
        ops = new ERC404BondingOps();
        stdstore.target(address(ops)).sig("factory()").checked_write(address(this));
        stdstore.target(address(ops)).sig("masterRegistry()").checked_write(address(registry));
        ops.initializeStaking(address(module));
    }

    // ── The endowment-only refusal ──────────────────────────────────────────────────────────────

    /// @notice An instance whose whole registered vault set is an endowment cannot turn staking on,
    ///         and the refusal leaves `stakingActive` false — the field the rest of the staking path
    ///         keys off, and the one an irreversible activation would have sealed.
    function test_activateStaking_endowmentOnlyVaultSet_refused() public {
        ERC404BondingInstance inst = _newInstance();
        _registerVaults(address(inst), _one(_endowment()));

        vm.prank(owner);
        vm.expectRevert(ActivateStakingFailed.selector);
        inst.activateStaking();

        assertFalse(inst.stakingActive(), "a refused activation must not seal stakingActive");
    }

    /// @notice The same refusal read by selector, against a bare Ops deployment so the trampoline does
    ///         not collapse it. Two endowments, to show the condition is over the WHOLE set and not
    ///         over the first entry.
    function test_activateStaking_endowmentOnlyVaultSet_namedError() public {
        ERC404BondingOps ops = _bareOps();
        _registerVaults(address(ops), _two(_endowment(), _endowment()));

        vm.prank(address(0));
        vm.expectRevert(NoFeeClaimingVault.selector);
        ops.activateStaking();

        assertFalse(ops.stakingActive(), "a refused activation must not seal stakingActive");
    }

    /// @notice ONE fee-pushing vault alongside the endowment is enough: the stream has a source, so
    ///         the same call succeeds. This is the control that makes the refusal above a statement
    ///         about the vault set rather than about endowments being present at all.
    function test_activateStaking_mixedVaultSet_succeeds() public {
        ERC404BondingInstance inst = _newInstance();
        address endowment = _endowment();
        address pusher = address(new PushingFeeVault());
        _registerVaults(address(inst), _two(endowment, pusher));

        vm.prank(owner);
        inst.activateStaking();

        assertTrue(inst.stakingActive(), "a fundable stream must activate");
    }

    /// @notice Order does not matter — the endowment sitting first in the set does not short-circuit
    ///         the walk before it reaches the vault that can pay.
    function test_activateStaking_mixedVaultSet_orderIndependent() public {
        ERC404BondingInstance a = _newInstance();
        _registerVaults(address(a), _two(address(new PushingFeeVault()), _endowment()));
        vm.prank(owner);
        a.activateStaking();
        assertTrue(a.stakingActive(), "pusher first");

        ERC404BondingInstance b = _newInstance();
        _registerVaults(address(b), _two(_endowment(), address(new PushingFeeVault())));
        vm.prank(owner);
        b.activateStaking();
        assertTrue(b.stakingActive(), "endowment first");
    }

    /// @notice A vault that HAS the pull-claim model and is merely empty is a source. The refusal keys
    ///         on the one explicit "there is nothing to pull here" answer, `NotSupported`, and not on
    ///         "the call reverted" — which every real vault's `claimFees` does under a staticcall,
    ///         because paying out writes storage.
    function test_activateStaking_emptyButClaimableVault_isASource() public {
        ERC404BondingInstance inst = _newInstance();
        _registerVaults(address(inst), _one(address(new EmptyClaimVault())));

        vm.prank(owner);
        inst.activateStaking();

        assertTrue(inst.stakingActive(), "NothingToClaim is not NotSupported");
    }

    /// @notice A funded pushing vault reverts the probe's staticcall with EMPTY returndata (it tries
    ///         to move ETH), which must still read as a source. This is the case a naive
    ///         "treat any revert as unsupported" probe would get wrong, and it is the realistic one:
    ///         a vault with fees waiting is exactly when an owner turns staking on.
    function test_activateStaking_fundedPushingVault_isASource() public {
        ERC404BondingInstance inst = _newInstance();
        PushingFeeVault v = new PushingFeeVault();
        vm.deal(address(v), 3 ether);
        _registerVaults(address(inst), _one(address(v)));

        // The stipend is the assertion. A value-bearing call inside a static context is an
        // exceptional halt that eats the WHOLE frame it was given, so an uncapped probe would need
        // sixty-four times the gas this call actually uses and would be unsendable inside a block.
        // Capping the probe is what keeps this number small; this pins it so it stays that way.
        vm.prank(owner);
        inst.activateStaking{ gas: 500_000 }();

        assertTrue(inst.stakingActive(), "a funded vault is the clearest source there is");
    }

    /// @notice An instance the registry does not know is NOT refused here. The finding is about a
    ///         vault set that exists and cannot feed the stream; an empty set is a different fact,
    ///         one `ERC404Factory` never creates and `claimAllFees` already handles by declining to
    ///         credit. Folding it into this error would be a second rule wearing the first one's name.
    function test_activateStaking_noRegisteredVaults_notThisGuardsBusiness() public {
        ERC404BondingInstance inst = _newInstance();

        vm.prank(owner);
        inst.activateStaking();

        assertTrue(inst.stakingActive(), "an unregistered instance is not a mis-configured vault set");
    }

    /// @notice The selector this contract matches on is the one the production endowment raises. Both
    ///         sides declare `error NotSupported()` in their own file — core contracts here never
    ///         import a concrete vault — so what makes the match correct is that an error's selector
    ///         is fixed by its signature. Pinned, so a rename on either side is a failing test rather
    ///         than a guard that silently stops recognising the vault it was written for.
    function test_notSupportedSelector_matchesTheEndowmentsOwn() public pure {
        assertEq(
            NotSupported.selector,
            AlignmentEndowmentVault.NotSupported.selector,
            "the guard must match the endowment's actual refusal"
        );
        assertEq(NotSupported.selector, bytes4(keccak256("NotSupported()")), "and that is the on-chain signature");
    }

    // ── The bonding-window pair ─────────────────────────────────────────────────────────────────

    /// @notice Open far, set maturity at the cap, then walk the open time back: the stored pair would
    ///         span far more than `MAX_BONDING_DURATION`, and every value in it was legal when it was
    ///         written. The third call is refused, and neither field moves.
    function test_setBondingOpenTime_cannotWidenTheStoredWindowPastTheCap() public {
        ERC404BondingInstance inst = _newInstance();
        uint256 farOpen = block.timestamp + 300 days;
        uint256 maturity = farOpen + MAX_BONDING_DURATION;

        vm.startPrank(owner);
        inst.setBondingOpenTime(farOpen);
        inst.setBondingMaturityTime(maturity);

        // One second inside the cap from the new open time is still fine — the refusal below is the
        // bound and not a blanket ban on moving the open time once maturity is set.
        inst.setBondingOpenTime(maturity - MAX_BONDING_DURATION);

        vm.expectRevert(SetBondingOpenTimeFailed.selector);
        inst.setBondingOpenTime(maturity - MAX_BONDING_DURATION - 1);
        vm.stopPrank();

        assertEq(inst.bondingOpenTime(), maturity - MAX_BONDING_DURATION, "a refused open time is not stored");
        assertEq(inst.bondingMaturityTime(), maturity, "and the maturity it was checked against is untouched");
    }

    /// @notice The same drive against a bare Ops deployment, where the specific error is readable.
    function test_setBondingOpenTime_pastTheCap_namedError() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        uint256 farOpen = block.timestamp + 300 days;
        uint256 maturity = farOpen + MAX_BONDING_DURATION;

        vm.startPrank(address(0));
        ops.setBondingOpenTime(farOpen);
        ops.setBondingMaturityTime(maturity);

        vm.expectRevert(MaturityTooFarAfterOpenTime.selector);
        ops.setBondingOpenTime(maturity - MAX_BONDING_DURATION - 1);

        // Control on the same deployment: the bound itself is accepted.
        ops.setBondingOpenTime(maturity - MAX_BONDING_DURATION);
        vm.stopPrank();

        assertEq(ops.bondingOpenTime(), maturity - MAX_BONDING_DURATION);
    }

    /// @notice The other half of the pair the setter now owes: an open time at or past the stored
    ///         maturity would invert the window, and `MaturityMustBeAfterOpenTime` is the same error
    ///         `setBondingMaturityTime` raises for the same inversion from its own side.
    function test_setBondingOpenTime_cannotOvertakeTheStoredMaturity() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        uint256 open = block.timestamp + 1 days;
        uint256 maturity = open + 30 days;

        vm.startPrank(address(0));
        ops.setBondingOpenTime(open);
        ops.setBondingMaturityTime(maturity);

        vm.expectRevert(MaturityMustBeAfterOpenTime.selector);
        ops.setBondingOpenTime(maturity);

        vm.expectRevert(MaturityMustBeAfterOpenTime.selector);
        ops.setBondingOpenTime(maturity + 1);
        vm.stopPrank();

        assertEq(ops.bondingOpenTime(), open, "neither refusal is stored");
    }

    /// @notice With no maturity set, the open time moves as freely as it always did — the new check is
    ///         conditioned on a stored pair and does not become a general restriction.
    function test_setBondingOpenTime_unconstrainedWhileNoMaturityIsSet() public {
        ERC404BondingInstance inst = _newInstance();

        vm.startPrank(owner);
        inst.setBondingOpenTime(block.timestamp + 1 days);
        inst.setBondingOpenTime(block.timestamp + 3650 days);
        vm.stopPrank();

        assertEq(inst.bondingOpenTime(), block.timestamp + 3650 days);
        assertEq(inst.bondingMaturityTime(), 0);
    }
}
