// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { DN404 } from "dn404/src/DN404.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { BondingCurveMath } from "./libraries/BondingCurveMath.sol";
import { ILiquidityDeployerModule } from "../../interfaces/ILiquidityDeployerModule.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { IGlobalMessageRegistry } from "../../registry/interfaces/IGlobalMessageRegistry.sol";
import { IGatingModule, GatingScope } from "../../gating/IGatingModule.sol";
import { IERC404StakingModule } from "../../interfaces/IERC404StakingModule.sol";

// ── Reroll errors (shared by the instance trampoline + the delegatecall Ops) ────────────────────
// The instance's reroll body lives in ERC404BondingOps (reached by a discard-returndata delegatecall
// trampoline, EIP-170 diet — noesis-091). Ops reverts with these specific errors INTERNALLY; the
// trampoline discards returndata (a via_ir size cliff forbids bubbling), so a caller sees the generic
// `RerollFailed()`. The specifics remain visible in traces.
error InsufficientTokenBalance();
error TokenAmountMustBePositive();
error TokenAmountMustRepresentNFT();
error BalanceMismatchAfterReroll();
error RerollFailed();

// ── Token Tiers errors (shared by the instance seal/trampolines + the delegatecall Ops) ─────────
// Same split as reroll: the tier bodies (`mintUp` / `mintDown`) live in ERC404BondingOps and revert
// with these specific errors INTERNALLY; the instance's discard-returndata trampoline surfaces the
// generic `TierOpFailed()` to the caller (the specifics stay visible in traces). `InvalidBand` and
// `BandIdOverflow` are raised by the instance's OWN `initTierBands` seal, so those two surface verbatim.
error TiersNotConfigured();
error InvalidBand();
error BandExhausted();
error NotBandId();
error NotTierZeroId();
error TierOpFailed();
error BandIdOverflow();

/**
 * @title ERC404BondingStorage
 * @notice Single source of truth for the ERC404 bonding instance's storage layout. Both the deployable
 *         `ERC404BondingInstance` and the delegatecall `ERC404BondingOps` inherit this identical base,
 *         so Ops executes in the instance's storage context with a byte-identical layout (proven by the
 *         CI storageLayout-equality gate). DN404 / Ownable / ReentrancyGuard keep their state at fixed
 *         hashed slots (not sequential), so they never collide with the sequential slots below.
 * @dev    HARD CONSTRAINT (noesis-091): all instance state MUST be declared HERE, in this exact order.
 *         Never add a state variable to `ERC404BondingInstance` or `ERC404BondingOps` directly — a var
 *         outside this shared base is a storage-collision bug across the delegatecall boundary.
 */
abstract contract ERC404BondingStorage is DN404, Ownable, ReentrancyGuard {
    // ┌─────────────────────────┐
    // │      State Variables    │
    // └─────────────────────────┘

    bool internal _initialized;

    string internal _name;
    string internal _symbol;

    uint256 public maxSupply;
    uint256 public liquidityReserve;
    BondingCurveMath.Params public curveParams;
    uint256 public unit;

    address public factory;
    IAlignmentVault public vault;
    IMasterRegistry public masterRegistry;
    IGlobalMessageRegistry public globalMessageRegistry;

    address public protocolTreasury;
    address public weth;
    uint256 public bondingFeeBps;

    string public styleUri;
    string public metadataURI;

    uint256 public bondingOpenTime;
    uint256 public bondingMaturityTime;
    bool public bondingActive;
    uint256 public totalBondingSupply;
    uint256 public reserve;

    // Gating module (address(0) = open gating)
    IGatingModule public gatingModule;
    bool public agentDelegationEnabled;
    bool public gatingActive;

    // Liquidity deployer — set once in initialize(), AMM-agnostic
    ILiquidityDeployerModule public liquidityDeployer;

    // Graduation flag
    bool public graduated;

    // Creator carve disclosure — set once at initialize, immutable thereafter (public getter).
    uint16 public declaredMaxAllowanceBps;

    // Free mint tranche
    uint256 public freeMintAllocation; // NFT count reserved (0 = disabled)
    uint256 public freeMintsClaimed; // running counter (in NFTs, not tokens)
    mapping(address => bool) public freeMintClaimed;
    GatingScope public gatingScope;
    bool internal _freeMintInitialized;

    // Staking module (address(0) = staking not available for this instance)
    IERC404StakingModule public stakingModule;
    bool public stakingActive;

    // ETH currently owed to stakers (a liability held in this instance's balance, NOT part of the
    // bonding `reserve`). Credited when distributable fees arrive (`claimAllFees`, only while
    // `totalStaked > 0`), debited as stakers are actually paid (`unstake`, `claimStakingRewards`).
    // `withdrawDust` subtracts this so the owner can never sweep staker-owed ETH (noesis-061 F1).
    uint256 public stakingReserve;

    // Generic keyed module slots (ADR-0006/0007). One slot for all known + future module pointers
    // (role => module; 0 = absent). Wired ONCE by the factory at create, then sealed — no owner setter.
    mapping(bytes32 => address) public modules;
    bytes32 internal constant METADATA_RESOLVER = keccak256("metadata.resolver");

    // ── Token Tiers (noesis-142) ────────────────────────────────────────────────────────────────
    // Tiers are coin DENOMINATIONS: a tier-N NFT is still exactly ONE DN404 unit of balance (DN404's
    // `ownedLength == balance / unit` invariant is absolute) PLUS `(w_N - 1) * unit` of the holder's own
    // coin escrowed in this instance. The escrow is DERIVED from the id's band — never stored per holder.

    /// @dev One reserved band of ids, all carrying denomination `weight` (in units, `w_0 = 1`).
    ///      `idStart`/`idEnd` are inclusive and live ABOVE `idLimit = totalSupply / unit`, which is what
    ///      makes them unreachable by ordinary minting (DN404 bounds every auto-minted id with
    ///      `_wrapNFTId(.., idLimit)`). uint32 because DN404's `_restrictNFTId` bounds ids to uint32.
    struct TierBand {
        uint32 idStart;
        uint32 idEnd;
        uint32 weight;
    }

    /// @dev The sealed ladder. `tierBands[i]` describes tier `i + 1`: tier 0 is the IMPLICIT ordinary id
    ///      space `[1..idLimit]` with `w_0 = 1` and is never stored (it needs no band and no escrow).
    ///      Sealed once by the factory at create — mutable weights would retroactively reprice every
    ///      outstanding band NFT.
    TierBand[] public tierBands;

    /// @dev Per-band high-water cursor: the next never-issued id in `tierBands[i]`. Initialized to
    ///      `idStart` at seal time.
    mapping(uint256 => uint256) public bandNextFree;

    /// @dev Per-band LIFO stack of ids returned by `mintDown`. Popped before the high-water cursor, so
    ///      id reuse is deterministic and O(1) — no scanning.
    mapping(uint256 => uint32[]) internal bandFreed;

    /// @dev Running sum of coin escrowed behind outstanding band NFTs. Part of this instance's own
    ///      `balanceOf(address(this))`, but NOT part of the curve: the buy cap is counter-based
    ///      (`totalBondingSupply`), so escrow can never inflate the buyable pool.
    uint256 public totalTierEscrow;

    /// @dev Set-once seal flag for `initTierBands`.
    bool internal _tiersSealed;

    // ── Reroll events (emitted by Ops in the instance's context under delegatecall) ─────────────
    event RerollInitiated(address indexed user, uint256 tokenAmount, uint256[] exemptedNFTIds);
    event RerollCompleted(address indexed user, uint256 tokensReturned);

    // ── Token Tiers events (emitted by Ops in the instance's context under delegatecall) ─────────
    event MintedUp(address indexed holder, uint8 indexed tierN, uint256 tierZeroId, uint256 bandId);
    event MintedDown(address indexed holder, uint8 indexed tierN, uint256 bandId, uint256 tierZeroId);
    event TierBandsSealed(uint256 bandCount);

    // ── DN404 unit override (shared: DN404 internals in both the instance and Ops read this) ────
    function _unit() internal view override returns (uint256) {
        return unit;
    }
}
