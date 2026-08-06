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

// ── Escrow release errors (noesis-143) — raised by the instance's OWN `claimReleasedEscrow`, so
// they surface verbatim (no trampoline in that path).
error NothingToClaim();
error EscrowReleaseFailed();

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

    // ── Burn-safety escrow release (noesis-143) ──────────────────────────────────────────────────
    // DN404 reconciles NFTs to balance on EVERY debit: `numNFTBurns = _zeroFloorSub(ownedLength,
    // balance / unit)` ids are burned LIFO off the tail of `owned[holder]` (DN404.sol:825-838 in
    // `_transfer`, :690-712 in `_burn`). That loop knows nothing about bands, so a band NFT can be
    // burned out from under its holder — which would strand its `(w_N - 1) * unit` of escrow inside
    // this instance forever. `_afterNFTTransfers` (below) catches exactly that and RECORDS a credit;
    // `ERC404BondingInstance.claimReleasedEscrow()` pays it out.

    /// @dev Coin owed to a holder whose band NFT was burned by DN404's reconciliation. Credited by the
    ///      hook (which must never move value), paid by `claimReleasedEscrow`. Part of this instance's
    ///      own `balanceOf(address(this))` — it moved out of `totalTierEscrow` into this liability, so
    ///      the two never double-count.
    mapping(address => uint256) public pendingEscrowRelease;

    /// @dev Running sum of `pendingEscrowRelease`. Lets the conservation invariant be checked on-chain
    ///      and keeps `withdrawDust`-style sweeps honest about what this balance already owes.
    uint256 public totalPendingEscrowRelease;

    // ── Reroll events (emitted by Ops in the instance's context under delegatecall) ─────────────
    event RerollInitiated(address indexed user, uint256 tokenAmount, uint256[] exemptedNFTIds);
    event RerollCompleted(address indexed user, uint256 tokensReturned);

    // ── Token Tiers events (emitted by Ops in the instance's context under delegatecall) ─────────
    event MintedUp(address indexed holder, uint8 indexed tierN, uint256 tierZeroId, uint256 bandId);
    event MintedDown(address indexed holder, uint8 indexed tierN, uint256 bandId, uint256 tierZeroId);
    event TierBandsSealed(uint256 bandCount);

    /// @notice A band NFT was destroyed by DN404's own NFT/balance reconciliation; `amount` of escrow is
    ///         now claimable by `holder` and the id is back on its band's free list.
    event EscrowReleased(address indexed holder, uint256 indexed bandId, uint256 amount);

    // ── DN404 unit override (shared: DN404 internals in both the instance and Ops read this) ────
    function _unit() internal view override returns (uint256) {
        return unit;
    }

    // ┌──────────────────────────────────────┐
    // │  Band lookup (shared, noesis-143)    │
    // └──────────────────────────────────────┘

    /// @dev THE single band-range walk for this instance. Deliberately non-reverting so the three
    ///      callers can each pick their own failure mode: `ERC404BondingOps.mintDown` reverts
    ///      `NotBandId`, `ERC404BondingInstance.coinBalanceOf` sums, and `_afterNFTTransfers` skips.
    ///      Duplicating the walk per call site is how the escrow amount drifts, so there is exactly one.
    ///      O(bandCount) with bandCount fixed at seal (a 2-3 rung ladder in practice).
    function _bandOf(uint256 id) internal view returns (bool found, uint256 idx, uint256 weight) {
        uint256 n = tierBands.length;
        for (uint256 i; i < n; ++i) {
            TierBand storage b = tierBands[i];
            if (id >= b.idStart && id <= b.idEnd) return (true, i, b.weight);
        }
    }

    // ┌────────────────────────────────────────────────┐
    // │  Burn-safety hook (shared, HOT PATH)           │
    // └────────────────────────────────────────────────┘
    // Declared HERE, in the shared base, deliberately: `_afterNFTTransfers` is an INTERNAL DN404 hook,
    // reached by a plain internal jump from `_mint` / `_mintNext` / `_burn` / `_transfer` /
    // `_transferFromNFT` — never through `msg.data`. So the reroll/mintUp trampoline pattern does NOT
    // apply: under `delegatecall` the code that runs is Ops's own, and if only the instance carried an
    // override then `ERC404BondingOps.mintUp`'s escrow leg — the single most likely place to burn a band
    // NFT — would run with the hook DISABLED. Both contracts must compile the identical body, and the
    // shared base is the only way to guarantee that. Measured cost: see the PR body.

    /// @dev Turning this on un-dead-codes DN404's `from`/`to`/`ids` array construction at all five hook
    ///      call sites (a measured, unavoidable floor before any body of ours). `pure` narrows DN404's
    ///      non-view declaration, which is legal and lets the compiler fold the branch.
    function _useAfterNFTTransfers() internal pure override returns (bool) {
        return true;
    }

    /// @notice Release the escrow behind any band NFT that DN404 just burned.
    /// @dev PULL, never push (noesis-143 decision 1). This runs in the middle of DN404's own
    ///      accounting — every call site invokes it after the balance/ownership writes but while the
    ///      caller's frame is still live. Moving value here (`_transfer`, mint, burn) would re-enter the
    ///      very bookkeeping that is mid-flight, so the hook only RECORDS: it credits
    ///      `pendingEscrowRelease`, returns the id to its band's LIFO free list, and moves the amount out
    ///      of `totalTierEscrow` into `totalPendingEscrowRelease`. No external calls, so it cannot
    ///      reenter at all. `claimReleasedEscrow()` on the instance is what actually moves coin.
    /// @dev BURN DETECTION (decision 3), read off the pinned dn404 rather than assumed. The three array
    ///      shapes DN404 builds are: mints → `from[i] == address(0)` (`_mint` :564-569, `_mintNext`
    ///      :653-658, and the mint tail of `_transfer` :884-897); burns → `to[i] == address(0)` (`_burn`
    ///      :728-733 and the burn segment of `_transfer`); plain transfers → BOTH non-zero (the direct
    ///      segment of `_transfer`, and `_transferFromNFT` :998, which cannot carry `to == 0` because it
    ///      reverts `TransferToZeroAddress` first). So `to[i] == address(0)` is exactly "this id ceased
    ///      to exist", and nothing else is. A band id merely CHANGING HANDS is not a release — escrow
    ///      follows the id (decision 4) — which is why the test is on `to`, not on `from`.
    /// @dev HOT PATH. Ordering is by cost: a memory compare (`to[i]`) before a storage compare, and the
    ///      whole body behind a single `tierBands.length` SLOAD that short-circuits every instance that
    ///      never sealed a ladder. `floor_` is the lowest band's `idStart`; `initTierBands` seals
    ///      bands ASCENDING and strictly above `idLimit`, so `id < floor` proves "ordinary id" in one
    ///      comparison and no band walk happens for the overwhelming majority of transfers.
    function _afterNFTTransfers(address[] memory from, address[] memory to, uint256[] memory ids)
        internal
        virtual
        override
    {
        uint256 bandCount = tierBands.length;
        if (bandCount == 0) return;

        uint256 floor_ = tierBands[0].idStart;
        uint256 unitSize = _unit();
        uint256 released;

        uint256 n = ids.length;
        for (uint256 i; i < n; ++i) {
            if (to[i] != address(0)) continue; // not a burn: mint or ordinary transfer
            uint256 id = ids[i];
            if (id < floor_) continue; // ordinary id space — the O(1) early-out
            (bool isBand, uint256 idx, uint256 weight) = _bandOf(id);
            if (!isBand) continue; // above the ordinary space but between bands: impossible today, cheap
            unchecked {
                uint256 amount = (weight - 1) * unitSize; // weight >= 2 is a seal invariant
                address holder = from[i];
                pendingEscrowRelease[holder] += amount;
                released += amount;
                bandFreed[idx].push(uint32(id)); // back on the free list; outstanding count falls with it
                emit EscrowReleased(holder, id, amount);
            }
        }

        if (released != 0) {
            // Checked on purpose: every outstanding band id contributed exactly `(w - 1) * unit` to
            // `totalTierEscrow` when `mintUp` issued it, and an id can only be burned once (the burn
            // clears its ownership), so this can never underflow. If it ever did, that is a broken
            // invariant and reverting the transfer is the correct outcome.
            totalTierEscrow -= released;
            totalPendingEscrowRelease += released;
        }
    }
}
