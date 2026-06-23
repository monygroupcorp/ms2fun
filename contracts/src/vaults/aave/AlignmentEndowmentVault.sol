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

    // ┌─────────────────────────┐
    // │       Constants         │
    // └─────────────────────────┘
    /// @notice Platform-wide endowment lock. Global, not per-vault or per-collection (decision T4).
    uint256 public constant MATURITY_DURATION = 365 days;
    uint256 internal constant BPS = 10_000;
    // Split weights (the platform 1% is always the remainder, so dust never strands).
    uint256 internal constant MAJOR_BPS = 8_000; // 80%
    uint256 internal constant MINOR_BPS = 1_900; // 19%
    uint256 internal constant YIELD_COMMUNITY_BPS = 9_900; // MVP: community gets 99% of yield

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
    }

    // ┌─────────────────────────┐
    // │   Intake (deposit)      │
    // └─────────────────────────┘

    /// @inheritdoc IAlignmentVault
    /// @dev Native ETH only (`currency` must be the zero Currency); `msg.value == amount`. Wraps to
    ///      WETH and supplies the stataToken, crediting `benefactor`'s refundable principal. Open +
    ///      guarded (matches the reference vault): there is no tradable-share surface to inflate, so
    ///      no caller gate is required for safety.
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
        _deposit(benefactor, amount);
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Direct ETH (e.g. from `weth.withdraw`) is accepted but NOT auto-credited — endowment
    ///      principal is only created through `receiveContribution` with an explicit benefactor.
    receive() external payable override {}

    function _deposit(address benefactor, uint256 amount) internal {
        weth.deposit{value: amount}();
        weth.approve(address(stataToken), amount);
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
        // creator purse deferred → creator share 0; community 99%; platform = remainder (~1%).
        _distribute(got, address(0), 0, communityPayout, YIELD_COMMUNITY_BPS);
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

        // effects before interactions
        principal[benefactor] = 0;
        depositTime[benefactor] = 0;
        totalPrincipal -= p;

        uint256 got = _redeem(p);
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

        if (communityCut > 0) {
            if (community == address(0)) revert CommunityPayoutNotSet();
            SafeTransferLib.safeTransferETH(community, communityCut);
        }
        if (creatorCut > 0 && creator != address(0)) {
            SafeTransferLib.safeTransferETH(creator, creatorCut);
        }
        if (platformCut > 0) SafeTransferLib.safeTransferETH(protocolTreasury, platformCut);
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

    /// @notice Minimal escape hatch: pull the entire position to native ETH at the owner, for an Aave
    ///         reserve deprecation/migration. Accounting is preserved off-chain during migration.
    function migratePosition() external onlyOwner nonReentrant {
        uint256 got = _redeem(_stataValue());
        if (got > 0) SafeTransferLib.safeTransferETH(owner(), got);
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
    function accumulatedFees() external view override returns (uint256) {
        return _pendingYield();
    }

    /// @inheritdoc IAlignmentVault
    function totalShares() external view override returns (uint256) {
        return totalPrincipal;
    }

    /// @inheritdoc IAlignmentVault
    function getBenefactorContribution(address benefactor) external view override returns (uint256) {
        return principal[benefactor];
    }

    /// @inheritdoc IAlignmentVault
    function getBenefactorShares(address benefactor) external view override returns (uint256) {
        return principal[benefactor];
    }

    /// @inheritdoc IAlignmentVault
    /// @dev Preview: a benefactor's principal becomes withdrawable at maturity (gross, pre-split).
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
