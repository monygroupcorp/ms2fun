// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IAlignmentVault} from "../../interfaces/IAlignmentVault.sol";
import {IMasterRegistry} from "../../master/interfaces/IMasterRegistry.sol";

/// @dev Minimal WETH surface used by the vault.
interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
    function approve(address, uint256) external returns (bool);
}

/// @dev Minimal ERC-4626 surface of the Aave `StaticATokenV2` (waEthWETH) — the non-rebasing yield engine.
interface IStataToken {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256 assets);
    function maxWithdraw(address owner) external view returns (uint256 assets);
    function balanceOf(address) external view returns (uint256);
    function asset() external view returns (address);
}

/// @dev Read the current owner of a benefactor (collection instance) — follows ownership transfers.
interface IOwnable {
    function owner() external view returns (address);
}

/**
 * @title AlignmentEndowmentVault
 * @notice The Aave endowment vault (ADR-0003). One impl, clone-deployed PER alignment target by
 *         `AlignmentEndowmentVaultFactory`, so each clone serves exactly ONE community — which keeps
 *         yield routing trivial (no per-benefactor accumulator).
 *
 * @dev Each aligned collection ("benefactor" = the instance) parks a refundable WETH PRINCIPAL in
 *      this clone's own Aave `StaticATokenV2` position. Principal compounds; the spread above
 *      `totalPrincipal` is harvestable YIELD.
 *      - Intake (`receiveContribution`): wrap ETH → WETH → supply to the stataToken; `principal += amount`.
 *      - `harvest()` (permissionless): realize yield → MVP split **99% community / 1% platform**
 *        (the creator-19% yield purse is a documented fast-follow — the only thing an accumulator buys).
 *      - `withdrawPrincipal()`: matured → 80 creator / 19 community / 1 platform; early → 80 community /
 *        19 creator / 1 platform. Maturity is a GLOBAL platform constant.
 *      Clone-compatible (EIP-1167): initialized via `initialize()`, owned by the factory.
 *      Legacy LP/share/delegation methods of `IAlignmentVault` revert `NotSupported` (endowment has no
 *      tradable shares). See docs/phases/t4-aave-vault-handoff.md.
 */
contract AlignmentEndowmentVault is ReentrancyGuard, Ownable, IAlignmentVault {
    // ┌─────────────────────────┐
    // │      Custom Errors      │
    // └─────────────────────────┘
    // `AlreadyInitialized()` is inherited from solady Ownable.
    error InvalidAddress();
    error AmountMustBePositive();
    error AmountMismatch();
    error NativeOnly();
    error NoPrincipal();
    error NotAuthorized();
    error CommunityPayoutNotSet();
    error NotSupported();
    error BenefactorNotContract();
    error RedeemShortfall();

    // ┌─────────────────────────┐
    // │       Constants         │
    // └─────────────────────────┘
    /// @notice Platform-wide endowment lock. Global, not per-vault or per-collection (decision T4).
    uint256 public constant MATURITY_DURATION = 365 days;
    uint256 internal constant BPS = 10_000;
    // Split weights (the platform 1% is always the remainder, so dust never strands).
    uint256 internal constant MAJOR_BPS = 8_000; // 80%
    uint256 internal constant MINOR_BPS = 1_900; // 19%
    // MVP yield community share = MAJOR_BPS + MINOR_BPS (= 99%); the creator-19% purse is the
    // documented fast-follow. Derived (not a separate constant) so it can't drift out of sync.
    // A principal redemption short of the request by ≤ REDEEM_DUST is absorbed as ERC-4626
    // floor-rounding; a larger shortfall is treated as an Aave liquidity event and reverts so the
    // benefactor can retry once liquidity returns (rather than losing the unredeemed remainder).
    uint256 internal constant REDEEM_DUST = 1e6; // wei

    // ┌─────────────────────────┐
    // │         Storage         │
    // └─────────────────────────┘
    bool private _initialized;
    IStataToken public stataToken; // this clone's Aave position (waEthWETH)
    IWETH public weth;
    address public protocolTreasury; // 1% platform cut
    IMasterRegistry public masterRegistry; // agent authorization
    address public alignmentToken; // satisfies registerVault's alignmentToken() check
    address public communityPayout; // where this clone's community cut goes (owner-updatable)

    mapping(address => uint256) public principal; // benefactor(instance) → WETH principal, refundable
    mapping(address => uint256) public depositTime; // first-deposit ts; maturity = +MATURITY_DURATION
    uint256 public totalPrincipal;

    event PrincipalWithdrawn(address indexed benefactor, uint256 amount, bool matured);
    event Harvested(uint256 yield, address indexed community);
    event CommunityPayoutUpdated(address indexed payout);
    event Migrated(address indexed to, uint256 amount);

    constructor() {
        // Lock the implementation; clones initialize via initialize().
        _initialized = true;
    }

    /// @notice Initialize a freshly-deployed clone. Callable once, by the factory (becomes owner).
    function initialize(
        address _owner,
        address _weth,
        address _stataToken,
        address _protocolTreasury,
        address _masterRegistry,
        address _alignmentToken,
        address _communityPayout
    ) external {
        if (_initialized) revert AlreadyInitialized();
        if (
            _owner == address(0) || _weth == address(0) || _stataToken == address(0)
                || _protocolTreasury == address(0) || _masterRegistry == address(0)
                || _alignmentToken == address(0)
        ) revert InvalidAddress();
        _initialized = true;
        _initializeOwner(_owner);

        weth = IWETH(_weth);
        stataToken = IStataToken(_stataToken);
        protocolTreasury = _protocolTreasury;
        masterRegistry = IMasterRegistry(_masterRegistry);
        alignmentToken = _alignmentToken;
        communityPayout = _communityPayout; // may be set later via setCommunityPayout

        // One-time max approval: the vault is the sole holder of its WETH, deposited each intake into
        // the stataToken. Cheaper + cleaner than re-approving per deposit.
        IWETH(_weth).approve(_stataToken, type(uint256).max);
    }

    // ┌─────────────────────────┐
    // │   Intake (deposit)      │
    // └─────────────────────────┘

    /// @inheritdoc IAlignmentVault
    /// @dev Native ETH only (`currency` must be the zero Currency); `msg.value == amount`. Wraps to
    ///      WETH and supplies the stataToken, crediting `benefactor`'s refundable principal. Open +
    ///      guarded (matches the reference vault): there is no tradable-share surface to inflate, so
    ///      no caller gate is required. `benefactor` MUST be a contract — withdrawal reads
    ///      `IOwnable(benefactor).owner()`, so crediting a codeless address would strand the funds.
    function receiveContribution(Currency currency, uint256 amount, address benefactor)
        external
        payable
        override
        nonReentrant
    {
        if (Currency.unwrap(currency) != address(0)) revert NativeOnly();
        if (amount == 0) revert AmountMustBePositive();
        if (msg.value != amount) revert AmountMismatch();
        if (benefactor == address(0)) revert InvalidAddress();
        if (benefactor.code.length == 0) revert BenefactorNotContract();
        _deposit(benefactor, amount);
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Direct ETH (e.g. from `weth.withdraw`) is accepted but NOT auto-credited — endowment
    ///      principal is only created through `receiveContribution` with an explicit benefactor.
    receive() external payable override {}

    function _deposit(address benefactor, uint256 amount) internal {
        weth.deposit{value: amount}(); // approval is set once in initialize
        stataToken.deposit(amount, address(this));

        if (depositTime[benefactor] == 0) depositTime[benefactor] = block.timestamp;
        principal[benefactor] += amount;
        totalPrincipal += amount;
        emit ContributionReceived(benefactor, amount);
    }

    // ┌─────────────────────────┐
    // │   Yield (harvest)       │
    // └─────────────────────────┘

    /// @notice Realize the compounded yield and distribute it (MVP: 99% community / 1% platform).
    ///         Permissionless — it only moves the fixed split to fixed destinations.
    function harvest() external nonReentrant {
        uint256 y = _pendingYield();
        if (y == 0) return;
        if (communityPayout == address(0)) revert CommunityPayoutNotSet();

        uint256 got = _redeem(y);
        // creator purse deferred → creator share 0; community 99% (= MAJOR+MINOR); platform = remainder.
        _distribute(got, address(0), 0, communityPayout, MAJOR_BPS + MINOR_BPS);
        emit Harvested(got, communityPayout);
        emit FeesAccumulated(got);
    }

    // ┌─────────────────────────┐
    // │   Principal withdraw    │
    // └─────────────────────────┘

    /// @notice Withdraw a benefactor's refundable principal. Matured → 80 creator / 19 community / 1
    ///         platform; early → 80 community / 19 creator / 1 platform. Callable by the collection's
    ///         current owner (follows ownership transfers) or an approved platform agent acting for them.
    function withdrawPrincipal(address benefactor) external nonReentrant {
        uint256 p = principal[benefactor];
        if (p == 0) revert NoPrincipal();

        address creator = IOwnable(benefactor).owner();
        if (msg.sender != creator && !masterRegistry.isAgent(msg.sender)) revert NotAuthorized();
        if (communityPayout == address(0)) revert CommunityPayoutNotSet();

        bool matured = block.timestamp >= depositTime[benefactor] + MATURITY_DURATION;

        // Redeem from Aave FIRST (trusted calls only) so we never clear accounting for funds we
        // couldn't recover: a shortfall beyond rounding dust is an Aave liquidity event → revert so
        // the benefactor retries later, rather than losing the unredeemed remainder to phantom yield.
        uint256 got = _redeem(p);
        if (got + REDEEM_DUST < p) revert RedeemShortfall();

        // effects (clear state) before the untrusted distribution interactions
        principal[benefactor] = 0;
        depositTime[benefactor] = 0;
        totalPrincipal -= p;

        if (matured) {
            // creator 80 / community 19 / platform 1
            _distribute(got, creator, MAJOR_BPS, communityPayout, MINOR_BPS);
        } else {
            // community 80 / creator 19 / platform 1
            _distribute(got, creator, MINOR_BPS, communityPayout, MAJOR_BPS);
        }
        emit PrincipalWithdrawn(benefactor, p, matured);
        emit FeesClaimed(benefactor, got);
    }

    // ┌─────────────────────────┐
    // │   Internal helpers      │
    // └─────────────────────────┘

    /// @dev WETH value the vault could redeem from its stataToken position right now.
    function _stataValue() internal view returns (uint256) {
        return stataToken.convertToAssets(stataToken.balanceOf(address(this)));
    }

    /// @dev Yield = position value above tracked principal (guarded against rounding underflow).
    function _pendingYield() internal view returns (uint256) {
        uint256 v = _stataValue();
        return v > totalPrincipal ? v - totalPrincipal : 0;
    }

    /// @dev Redeem up to `assets` WETH from the stataToken and unwrap to native ETH. Caps at
    ///      `maxWithdraw` so ERC-4626 floor-rounding (the position can be worth `assets − 1 wei`)
    ///      never reverts the withdrawal; returns the amount actually redeemed (`assets` minus any
    ///      sub-wei dust, which stays in the position).
    function _redeem(uint256 assets) internal returns (uint256) {
        uint256 avail = stataToken.maxWithdraw(address(this));
        uint256 amt = assets < avail ? assets : avail;
        if (amt > 0) {
            stataToken.withdraw(amt, address(this), address(this));
            weth.withdraw(amt);
        }
        return amt;
    }

    /// @dev Split `amount` of ETH: creator (creatorBps) + community (communityBps) + platform
    ///      (remainder, ~1% incl. rounding dust). Skips zero legs; reverts if a community leg is due
    ///      but no payout is set (caught earlier, defensive here).
    function _distribute(
        uint256 amount,
        address creator,
        uint256 creatorBps,
        address community,
        uint256 communityBps
    ) internal {
        uint256 creatorCut = (amount * creatorBps) / BPS;
        uint256 communityCut = (amount * communityBps) / BPS;
        uint256 platformCut = amount - creatorCut - communityCut;

        // force-send: a recipient that rejects ETH (e.g. a creator/community contract without a
        // payable receiver) must not be able to brick harvest/withdrawal for everyone else.
        if (communityCut > 0) {
            if (community == address(0)) revert CommunityPayoutNotSet();
            SafeTransferLib.forceSafeTransferETH(community, communityCut);
        }
        if (creatorCut > 0 && creator != address(0)) {
            SafeTransferLib.forceSafeTransferETH(creator, creatorCut);
        }
        if (platformCut > 0) SafeTransferLib.forceSafeTransferETH(protocolTreasury, platformCut);
    }

    // ┌─────────────────────────┐
    // │   Admin                 │
    // └─────────────────────────┘

    /// @notice Update where this clone's community cut is sent (owner = factory).
    function setCommunityPayout(address payout) external onlyOwner {
        if (payout == address(0)) revert InvalidAddress();
        communityPayout = payout;
        emit CommunityPayoutUpdated(payout);
    }

    /// @notice Emergency escape hatch (owner = factory): redeem the ENTIRE position to native ETH and
    ///         force-send it to `to` (the protocol's recovery address) for an Aave reserve
    ///         deprecation/migration. Zeroes `totalPrincipal`; per-benefactor entries are reconciled
    ///         off-chain — post-migration the vault is decommissioned (withdrawals revert RedeemShortfall).
    /// @dev    Sends to an explicit `to` rather than `owner()`: the owner is the factory, which has no
    ///         `receive()`, so paying it directly would always revert.
    function migratePosition(address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert InvalidAddress();
        uint256 got = _redeem(_stataValue());
        totalPrincipal = 0;
        if (got > 0) SafeTransferLib.forceSafeTransferETH(to, got);
        emit Migrated(to, got);
    }

    // ┌─────────────────────────┐
    // │   IAlignmentVault views │
    // └─────────────────────────┘
    // Note: `alignmentToken()` (required by MasterRegistry.registerVault's staticcall) is the
    // auto-generated getter of the public `alignmentToken` storage var above — not in IAlignmentVault.

    /// @inheritdoc IAlignmentVault
    function vaultType() external pure override returns (string memory) {
        return "AaveEndowment";
    }

    /// @inheritdoc IAlignmentVault
    function description() external pure override returns (string memory) {
        return "Perpetual community endowment: refundable creator principal in Aave, yield to the community.";
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Endowment semantics: returns harvestable yield still IN the Aave position (a preview),
    ///      NOT withdrawn ETH. Realized only by `harvest()`.
    function accumulatedFees() external view override returns (uint256) {
        return _pendingYield();
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Not tradable shares — this is the total refundable WETH principal ledger (in wei).
    function totalShares() external view override returns (uint256) {
        return totalPrincipal;
    }

    /// @inheritdoc IAlignmentVault
    function getBenefactorContribution(address benefactor) external view override returns (uint256) {
        return principal[benefactor];
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Not shares — the benefactor's refundable WETH principal (in wei).
    function getBenefactorShares(address benefactor) external view override returns (uint256) {
        return principal[benefactor];
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Endowment semantics: 0 while principal is LOCKED (not "no claim") → the gross principal at
    ///      maturity (pre-split). Use `principal()`/`depositTime()` for the locked amount + unlock time.
    function calculateClaimableAmount(address benefactor) external view override returns (uint256) {
        if (block.timestamp < depositTime[benefactor] + MATURITY_DURATION) return 0;
        return principal[benefactor];
    }

    /// @inheritdoc IAlignmentVault
    function supportsCapability(bytes32 capability) external pure override returns (bool) {
        return capability == keccak256("YIELD_GENERATION");
    }

    /// @inheritdoc IAlignmentVault
    function currentPolicy() external pure override returns (bytes memory) {
        return "";
    }

    /// @inheritdoc IAlignmentVault
    function validateCompliance(address) external pure override returns (bool) {
        return true;
    }

    /// @inheritdoc IAlignmentVault
    /// @dev No delegation on an endowment — returns the benefactor itself.
    function getBenefactorDelegate(address benefactor) external pure override returns (address) {
        return benefactor;
    }

    // ┌─────────────────────────┐
    // │  Unsupported legacy API │
    // └─────────────────────────┘
    // Endowment has no tradable shares / per-caller fee claims / delegation. Use harvest() +
    // withdrawPrincipal() instead.

    /// @inheritdoc IAlignmentVault
    function claimFees() external pure override returns (uint256) {
        revert NotSupported();
    }

    /// @inheritdoc IAlignmentVault
    function delegateBenefactor(address) external pure override {
        revert NotSupported();
    }

    /// @inheritdoc IAlignmentVault
    function claimFeesAsDelegate(address[] calldata) external pure override returns (uint256) {
        revert NotSupported();
    }
}
