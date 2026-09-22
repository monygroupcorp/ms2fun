// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { IERC20 } from "../../shared/interfaces/IERC20.sol";
import { IAlignmentVault } from "../../interfaces/IAlignmentVault.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { ILiquidityDeployerModule, IGraduationSkipNFTTarget } from "../../interfaces/ILiquidityDeployerModule.sol";
import { IFactoryInstance } from "../../interfaces/IFactoryInstance.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { RevenueSplitLib } from "../../shared/libraries/RevenueSplitLib.sol";
import { Ownable } from "solady/auth/Ownable.sol";

interface IZAMM {
    struct PoolKey {
        uint256 id0;
        uint256 id1;
        address token0;
        address token1;
        uint256 feeOrHook;
    }

    struct Pool {
        uint112 reserve0;
        uint112 reserve1;
        uint32 blockTimestampLast;
        uint256 price0CumulativeLast;
        uint256 price1CumulativeLast;
        uint256 kLast;
        uint256 supply;
    }

    function pools(uint256 poolId) external view returns (Pool memory);

    function addLiquidity(
        PoolKey calldata poolKey,
        uint256 amount0Desired,
        uint256 amount1Desired,
        uint256 amount0Min,
        uint256 amount1Min,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amount0, uint256 amount1, uint256 liquidity);
}

/**
 * @title ZAMMLiquidityDeployerModule
 * @notice Singleton called by ERC404BondingInstance at graduation.
 *         Receives ETH + tokens, deploys ZAMM liquidity, pays graduation fees.
 * @dev GRADUATION-LP PERMANENCE INVARIANT (ZAMM venue). The LP shares minted at graduation
 *      (`_deployPool`, `addLiquidity(... to: p.instance ...)`) are permanently locked: they are held
 *      by the ERC404 instance, and NO code path in this system can move or remove them. This module
 *      exposes no removeLiquidity / LP-transfer entry point; the instance is immutable and exposes no
 *      function that transfers a foreign LP token (`withdrawDust` touches only its own DN404 units +
 *      bonding reserve). Graduation liquidity is locked by design, not by the mere absence of a caller.
 *      Do NOT add any path that transfers, burns, or withdraws these LP shares. Pinned by test
 *      (`test/factories/LpLockInvariant.t.sol`).
 *      The ZAMM-graduated pool is UNTAXED post-graduation: `feeOrHook` is wired as a plain LP fee with
 *      no alignment hook. The perpetual swap tithe to the vault exists ONLY on the Uni V4 venue, by
 *      design (seeding depth off Uniswap is itself the alignment service). See docs/phases/vault-flavors.md.
 */
contract ZAMMLiquidityDeployerModule is ILiquidityDeployerModule, Ownable {
    error ETHMismatch();
    error NoETHForPool();
    error NoTokensForPool();
    /// @dev Caller is not the genuine, registered ERC404 instance named in p.instance.
    error UnauthorizedCaller();
    /// @dev An attacker pre-seeded the graduation pool at a reserve ratio outside tolerance.
    error PoolPriceMismatch();
    /// @dev flushPendingVaultCut called for an instance with no stashed cut.
    error NoPendingVaultCut();
    /// @dev sweepUnconsumedCoin called for an instance holding no stray coin here.
    error NoUnconsumedCoin();

    /// @notice Max deviation (bps) tolerated between an already-seeded pool's reserve ratio and the
    ///         intended graduation ratio. 100 bps (1%) mirrors the 99/100 LP-min-slippage convention
    ///         already used in this module. A larger gap means the pool was seeded by a front-runner
    ///         at a skewed price — we revert (retryable) rather than add liquidity into it.
    uint256 public constant MAX_INIT_PRICE_DEVIATION_BPS = 100;

    address public immutable zamm;
    uint256 public immutable feeOrHook;
    IMasterRegistry public immutable masterRegistry;

    string private _metadataURI;

    /// @dev A graduation vault cut that could not be delivered (the vault reverted on receiveContribution).
    ///      The ETH is retained in this module and re-sendable via flushPendingVaultCut. Keyed by instance
    ///      because this deployer is a singleton shared across every ERC404 graduation; the bound vault is
    ///      stored alongside the amount so a retry can only ever re-send to that same vault (no redirect
    ///      surface). Mirrors the ERC1155/721 pendingVaultCut stash, held on the module (which already
    ///      custodies the graduation ETH).
    /// @dev INVARIANT: the sum of every pendingVaultCut[*].amount is <= address(this).balance.
    struct PendingCut {
        address vault;
        uint256 amount;
    }

    mapping(address => PendingCut) public pendingVaultCut;

    // slither-disable-next-line missing-zero-check
    constructor(address _zamm, uint256 _feeOrHook, address _masterRegistry) {
        zamm = _zamm;
        feeOrHook = _feeOrHook;
        masterRegistry = IMasterRegistry(_masterRegistry);
        _initializeOwner(msg.sender);
    }

    struct PoolResult {
        uint256 ethForPool;
        uint256 protocolFee; // 1% of raise + 1% of carve → protocol treasury
        uint256 vaultCut; // 19% of raise + 19% of carve → alignment vault
        uint256 creatorCut; // 80% of carve → creator
        uint256 carvePaid; // effective gross diversion: carve + excess, post-clamp
        bool ethIsToken0;
        address token0;
        address token1;
        uint256 liquidity;
        uint256 residueTithed; // LP ETH the venue declined, folded onto the rail here
        uint256 ethUsed; // ETH the pool actually took out of ethForPool
        uint256 coinUsed; // coin the pool actually pulled out of p.tokenReserve
    }

    event LiquidityDeployed(address indexed zamm, address token0, address token1, uint256 liquidity);
    event GraduationFeePaid(address indexed treasury, uint256 amount);
    event GraduationVaultContribution(address indexed vault, uint256 amount);
    /// @notice The creator's own carve. `requested` is `p.carveEth` — what the creator asked for, on the
    ///         axis the collection's declared allowance is measured on — and never includes any other
    ///         diverted leg.
    event CreatorCarvePaid(address indexed instance, address indexed creator, uint256 requested, uint256 paid);
    /// @notice LP-share ETH the caller's parity clamp could not place at the pool price, tithed 80/19/1 on
    ///         the same rail as the carve. Mirrors the instance's `GraduationEthDiverted.excessEth`.
    event GraduationExcessTithed(address indexed instance, uint256 amount);
    /// @notice A graduation vault cut could not be delivered and was stashed for retry.
    event VaultContributionFailed(address indexed vault, address indexed instance, uint256 amount);
    /// @notice A previously-stashed graduation vault cut was successfully re-delivered.
    event VaultContributionRetried(address indexed vault, address indexed instance, uint256 amount);
    /// @notice The vault's alignment target was de-curated (`isVaultRegistered` false); the graduation
    ///         community cut was returned to the creator instead of feeding the de-curated vault.
    /// @dev INVARIANT: de-curation may destroy value; it may not transfer value to the protocol. No
    ///      `isVaultRegistered`-false branch in this contract routes to `protocolTreasury`.
    event VaultCutReturnedToCreator(address indexed vault, address indexed creator, uint256 amount);
    /// @notice A stashed vault cut was returned to the instance's creator on the retry, because the
    ///         vault's alignment target was de-curated while the cut sat pending.
    /// @dev Distinct topic from `VaultCutReturnedToCreator`, which the graduation path emits when a cut
    ///      is returned as it is earned. Both move the same money to the same place, but only one of
    ///      them is new revenue: a tithe report that saw a single event for both would double-count
    ///      every cut that was stashed once and returned later. This is the retry.
    event PendingVaultCutReturnedToCreator(address indexed vault, address indexed creator, uint256 amount);
    /// @notice The LP capital ZAMM did not take, and where it went. `ethTithed` joined the 80/19/1 rail
    ///         as a second `excessEth` leg; `ethReturned` and `coinReturned` went back to the graduating
    ///         instance.
    /// @dev Both are zero on an ordinary graduation into a fresh pool, and non-zero only when the pool
    ///      was already seeded at a reserve ratio inside `MAX_INIT_PRICE_DEVIATION_BPS` but not at the
    ///      graduation ratio, which is the only case where `addLiquidity` caps a leg.
    /// @dev `ethTithed` is its OWN leg on the rail, beside `CreatorCarvePaid` and
    ///      `GraduationExcessTithed`, and the three sum to the graduation's whole diverted total. It is
    ///      reported here rather than inside `GraduationExcessTithed` because it is the one leg the
    ///      graduating instance cannot compute: the instance knows what its parity clamp could not
    ///      place, and only this module learns what the venue then declined.
    /// @dev `ethTithed` and `ethReturned` are the same ETH under the two destinations it can have, and
    ///      never both non-zero: with a creator the residue rides the rail, and with none — a renounced
    ///      launch — it is force-transferred to the instance beside the coin. Both are zero when the
    ///      venue took the whole ETH leg and declined only coin. They are reported apart rather than as one figure because only the tithed leg is
    ///      revenue: a report summing the ETH a graduation diverted must add `ethTithed` and must NOT
    ///      add `ethReturned`, which was never levied on anyone. Splitting them is also what makes the
    ///      returned leg readable at all — it used to be reported nowhere, and where a renounced
    ///      launch's LP capital went could only be recovered from a balance.
    event GraduationResidueReturned(
        address indexed instance, uint256 ethTithed, uint256 ethReturned, uint256 coinReturned
    );
    /// @notice Coin swept out of this module to the instance that graduated it.
    event UnconsumedCoinSwept(address indexed instance, uint256 amount);

    /**
     * @notice Deploy ZAMM liquidity on behalf of an ERC404BondingInstance.
     * @dev Caller must transfer tokenReserve tokens to this contract before calling.
     *      ETH must equal p.ethReserve exactly.
     */
    // slither-disable-next-line reentrancy-events
    function deployLiquidity(DeployParams calldata p) external payable override {
        // Strict caller guard: only a genuine, registered ERC404 instance acting as itself may
        // deploy liquidity. For ERC404, instance == token, and the instance is the msg.sender at
        // graduation. Blocks arbitrary callers passing a crafted DeployParams.
        if (msg.sender != p.instance || !masterRegistry.isRegisteredInstance(msg.sender)) {
            revert UnauthorizedCaller();
        }
        if (msg.value != p.ethReserve) revert ETHMismatch();

        // Name this venue's coin counterparty to the graduating instance BEFORE any coin moves. ZAMM is
        // a singleton AMM: `addLiquidity` pulls the pool's coin side out of this module and into
        // `zamm`, which then holds it for the life of the market. An ERC404 instance mints one NFT id
        // per `unit` to an unflagged recipient, so without this the AMM takes delivery of the whole
        // coin side in ids and re-mints them on the sell side of every later swap. The call is hard,
        // not fail-soft: an instance that cannot be told is one whose pool would silently take that
        // delivery.
        IGraduationSkipNFTTarget(p.instance).markGraduationSkipNFT(zamm);

        PoolResult memory r = _deployPool(p);
        _returnResidue(p, r);
        _payFees(p, r);
    }

    /// @dev Give the LP capital ZAMM did not take an owner, in the same transaction that discovers it.
    ///      This module is a SINGLETON shared by every ERC404 graduation on this venue, so anything
    ///      left here is not merely locked, it is unattributable: it mixes with the next collection's
    ///      money and with the `pendingVaultCut` stash. Two destinations, neither of them new:
    ///
    ///        * ETH joins the 80/19/1 rail as a second `excessEth` leg — the same treatment the
    ///          instance already gives LP-share ETH its own parity clamp could not place
    ///          (`ERC404BondingOps.deployLiquidity`, noesis-188). `_titheResidue` re-runs the split
    ///          with the residue folded into the diverted legs, so the figures `_payFees` pays out are
    ///          the ones that account for it.
    ///        * Coin goes back to the graduating instance, which is the only address with any claim on
    ///          it. The instance's own skipNFT is set at `_initializeDN404`, so this mints it no ids.
    ///          The leftover allowance is zeroed with it: coin this module no longer holds must not
    ///          stay spendable by the AMM.
    ///
    ///      NO REMOVAL PATH IS ADDED. The LP shares are the instance's and are untouched; this moves
    ///      only what never entered the pool. `test/factories/LpLockInvariant.t.sol` pins that
    ///      distinction by probing for removal-shaped selectors, and it still finds none.
    ///
    ///      With no creator the rail has no 80 leg to pay, so the ETH follows the coin to the instance
    ///      rather than staying in the singleton — a strictly better home than this contract, and
    ///      deliberately not a policy decision about what a renounced launch is owed (that is L-11).
    function _returnResidue(ILiquidityDeployerModule.DeployParams calldata p, PoolResult memory r) private {
        uint256 ethResidue = r.ethForPool - r.ethUsed;
        uint256 coinResidue = p.tokenReserve - r.coinUsed;

        if (ethResidue != 0) {
            if (p.creator == address(0)) {
                SafeTransferLib.forceSafeTransferETH(p.instance, ethResidue);
            } else {
                _titheResidue(p, r, ethResidue);
            }
        }
        if (coinResidue != 0) {
            IERC20(p.token).approve(zamm, 0);
            SafeTransferLib.safeTransfer(p.token, p.instance, coinResidue);
        }
        if (ethResidue != 0 || coinResidue != 0) {
            bool renounced = p.creator == address(0);
            emit GraduationResidueReturned(
                p.instance, renounced ? 0 : ethResidue, renounced ? ethResidue : 0, coinResidue
            );
        }
        // From here on `r` describes the pool as it IS, not as it was sized. `_titheResidue` already
        // lands `ethForPool` on this value; the no-creator branch has to be told.
        r.ethForPool = r.ethUsed;
    }

    /// @dev Re-run the graduation split with `residueEth` added to the diverted legs, so every figure
    ///      `_payFees` pays is computed against the ETH the pool actually took. The residue rides the
    ///      rail rather than being paid out whole because it IS LP-share ETH: the 1% and 19% legs are
    ///      levied on the full raise and the 80 is the creator's, and none of that changes because a
    ///      front-runner moved the pool's reserve ratio.
    function _titheResidue(ILiquidityDeployerModule.DeployParams calldata p, PoolResult memory r, uint256 residueEth)
        private
        pure
    {
        RevenueSplitLib.GraduationSplit memory g =
            RevenueSplitLib.splitGraduation(p.ethReserve, p.carveEth + p.excessEth + residueEth, 0);
        r.protocolFee = g.protocolCut;
        r.vaultCut = g.vaultCut;
        r.creatorCut = g.creatorCut;
        r.carvePaid = g.carveApplied;
        r.ethForPool = g.ethForPool;
        r.residueTithed = residueEth;
    }

    /// @notice Send an instance's coin sitting in this module back to that instance.
    /// @dev The backstop behind `_returnResidue`, for coin a venue leaves here by a route the
    ///      in-transaction return does not see. It is deliberately the COIN leg only, and deliberately
    ///      has no destination parameter:
    ///
    ///        * PERMISSIONLESS AND UNDIRECTED. The destination is the argument's own identity — for
    ///          ERC404 the instance IS the token, so `instance`'s coin can only ever go to `instance`.
    ///          There is nothing for a caller to choose and so nothing for an owner to be trusted
    ///          with; it is not the owner sweep the audit warns about, which is why it is not one.
    ///        * NO ETH. An ETH sweep on this module would be a genuine new trust surface: the module
    ///          custodies live graduation ETH and the `pendingVaultCut` stash, whose invariant is that
    ///          the sum of every pending amount is covered by this balance. ETH residue is routed in
    ///          transaction instead, and no path here moves ETH that is not owed to a named payee.
    ///        * NOT A REMOVAL PATH. The graduation LP shares are ERC-6909 balances held by the
    ///          instance inside ZAMM, not a coin balance here, so this cannot reach them. Pinned by
    ///          `LpLockInvariant.t.sol`.
    /// @param instance The graduated ERC404 instance, which is also its own token.
    function sweepUnconsumedCoin(address instance) external {
        uint256 amount = SafeTransferLib.balanceOf(instance, address(this));
        if (amount == 0) revert NoUnconsumedCoin();
        SafeTransferLib.safeTransfer(instance, instance, amount);
        emit UnconsumedCoinSwept(instance, amount);
    }

    // slither-disable-next-line arbitrary-send-eth,unused-return
    function _deployPool(ILiquidityDeployerModule.DeployParams calldata p) private returns (PoolResult memory r) {
        // 1/19/80 split of the raise + the tithed diversions (80/19/1) out of the LP 80. Both diverted
        // legs — the creator's carve and the caller's unplaceable parity residue — ride the same rail, so
        // the split's input is their sum and every downstream figure is independent of how the caller
        // apportioned them. The instance resolves the effective carve; splitGraduation re-clamps to the
        // LP share.
        uint256 carve = p.creator == address(0) ? 0 : p.carveEth + p.excessEth;
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(p.ethReserve, carve, 0);
        r.protocolFee = g.protocolCut;
        r.vaultCut = g.vaultCut;
        r.creatorCut = g.creatorCut;
        r.carvePaid = g.carveApplied;
        r.ethForPool = g.ethForPool;
        if (r.ethForPool == 0) revert NoETHForPool();
        if (p.tokenReserve == 0) revert NoTokensForPool();

        r.ethIsToken0 = address(0) < p.token;
        r.token0 = r.ethIsToken0 ? address(0) : p.token;
        r.token1 = r.ethIsToken0 ? p.token : address(0);

        IERC20(p.token).approve(zamm, p.tokenReserve);

        IZAMM.PoolKey memory zammKey =
            IZAMM.PoolKey({ id0: 0, id1: 0, token0: r.token0, token1: r.token1, feeOrHook: feeOrHook });

        uint256 a0 = r.ethIsToken0 ? r.ethForPool : p.tokenReserve;
        uint256 a1 = r.ethIsToken0 ? p.tokenReserve : r.ethForPool;

        // Front-run-safe: a fresh pool (zero reserves) is created at our ratio by addLiquidity. If an
        // attacker pre-seeded the pool, addLiquidity would silently deposit at THEIR ratio — accept it
        // only if the existing reserve ratio is within tolerance of our intended a1/a0, else revert
        // (retryable) rather than provide liquidity at an attacker-chosen price.
        _requireReserveRatioWithinTolerance(uint256(keccak256(abi.encode(zammKey))), a0, a1);

        uint256 a0Min = a0 * 99 / 100; // 1% slippage tolerance
        uint256 a1Min = a1 * 99 / 100;
        // KEEP THE RETURN VALUES. `addLiquidity` caps both legs at the pool's live reserve ratio and
        // refunds the ETH remainder to msg.sender — this module — so discarding `(amount0, amount1)`
        // was the module never even observing what its own venue had handed back.
        uint256 used0;
        uint256 used1;
        (used0, used1, r.liquidity) =
            IZAMM(zamm).addLiquidity{ value: r.ethForPool }(zammKey, a0, a1, a0Min, a1Min, p.instance, block.timestamp);
        (r.ethUsed, r.coinUsed) = r.ethIsToken0 ? (used0, used1) : (used1, used0);
    }

    // slither-disable-next-line arbitrary-send-eth,reentrancy-events
    function _payFees(ILiquidityDeployerModule.DeployParams calldata p, PoolResult memory r) private {
        // 1% of raise (+ 1% of carve) → protocol treasury
        if (r.protocolFee > 0 && p.protocolTreasury != address(0)) {
            SafeTransferLib.safeTransferETH(p.protocolTreasury, r.protocolFee);
            emit GraduationFeePaid(p.protocolTreasury, r.protocolFee);
        }
        // 19% of raise (+ 19% of carve) → alignment vault. Isolate the send: a reverting vault (cut below
        // MIN_CONTRIBUTION, participant cap, a broken upgrade) must NOT brick graduation. On failure the
        // r.vaultCut ETH is retained in this module and stashed as pendingVaultCut[p.instance] for later
        // delivery via flushPendingVaultCut — mirroring the ERC1155/721 try/catch + pending-cut retry.
        // Graduation completes; the tithe is deferred, not lost.
        if (r.vaultCut > 0 && p.vault != address(0)) {
            // De-curation gate (noesis-126/noesis-435): if the alignment target was revoked
            // (`isVaultRegistered` false), fold the community cut into the creator leg instead of feeding
            // the de-curated vault — mirroring the ERC1155/721 primary paths.
            // INVARIANT: de-curation may destroy value; it may not transfer value to the protocol. Losing
            // the ability to pay a community is a consequence of curation; gaining their revenue is a
            // conflict of interest, so this branch must never route to `protocolTreasury`. A creator
            // betrayed by the community they aligned to gets their alignment share back — restitution, not
            // windfall. The fold moves whatever `vaultCut` resolved to, never a hardcoded 19%, and the
            // creator leg below force-transfers so the brick-proof property of this leg survives the fold.
            // For an active target, keep the try/catch + stash retry.
            if (!masterRegistry.isVaultRegistered(p.vault)) {
                r.creatorCut += r.vaultCut;
                emit VaultCutReturnedToCreator(p.vault, p.creator, r.vaultCut);
            } else {
                try IAlignmentVault(payable(p.vault)).receiveContribution{ value: r.vaultCut }(
                    Currency.wrap(address(0)), r.vaultCut, p.instance
                ) {
                    emit GraduationVaultContribution(p.vault, r.vaultCut);
                } catch {
                    PendingCut storage pc = pendingVaultCut[p.instance];
                    pc.vault = p.vault;
                    pc.amount += r.vaultCut;
                    emit VaultContributionFailed(p.vault, p.instance, r.vaultCut);
                }
            }
        }
        // 80% of carve → creator, plus any community cut folded in by the de-curation gate above.
        // force-transfer (noesis-435): the folded leg was brick-proof before the fold and must stay so —
        // a creator contract that rejects ETH cannot be allowed to brick graduation.
        if (r.creatorCut > 0) {
            SafeTransferLib.forceSafeTransferETH(p.creator, r.creatorCut);
        }
        // The two diverted legs, reported apart. `r.carvePaid` is the post-clamp figure for their SUM;
        // attribution is CARVE-FIRST — the creator's request is met first and the clamp residue absorbs
        // any squeeze — so the two emitted figures always sum to `r.carvePaid` exactly. A squeeze cannot
        // arise on the ERC404 graduation path (the instance sizes the legs so their sum is
        // `lp - ethForPool`, inside `splitGraduation`'s headroom), and for any caller where it can,
        // carve-first keeps the creator-facing figure the one the creator actually asked for.
        if (p.carveEth > 0) {
            emit CreatorCarvePaid(
                p.instance, p.creator, p.carveEth, r.carvePaid < p.carveEth ? r.carvePaid : p.carveEth
            );
        }
        // The CALLER's clamp residue, which is `r.carvePaid` less the carve and less the residue this
        // module discovered for itself. Three legs now ride the rail and each event reports the one its
        // own layer can see: the instance knows what its parity clamp could not place, and only the
        // module knows what the venue then declined. `GraduationResidueReturned` carries that third
        // leg, so the three figures sum to `r.carvePaid` exactly and none of them double-counts.
        // Guarded, not subtracted blind: with `p.creator == address(0)` the split above zeroes the
        // carve entirely while `p.carveEth` still carries the caller's request, so the difference runs
        // backwards. That is the case `test_deployLiquidity_carve_zeroCreatorZeroesCarve` pins.
        uint256 diverted = p.carveEth + r.residueTithed;
        if (r.carvePaid > diverted) {
            emit GraduationExcessTithed(p.instance, r.carvePaid - diverted);
        }
        emit LiquidityDeployed(zamm, r.token0, r.token1, r.liquidity);
    }

    /// @dev Reverts unless the existing pool's reserve ratio matches the intended a1/a0 within
    ///      MAX_INIT_PRICE_DEVIATION_BPS. A fresh pool (both reserves zero) passes — addLiquidity then
    ///      creates it at our ratio. Compared cross-multiplied (reserve1·a0 vs reserve0·a1) to avoid
    ///      division; reserves are uint112 and amounts fit ETH/token magnitudes, so no overflow.
    function _requireReserveRatioWithinTolerance(uint256 poolId, uint256 a0, uint256 a1) private view {
        IZAMM.Pool memory pool = IZAMM(zamm).pools(poolId);
        if (pool.reserve0 == 0 && pool.reserve1 == 0) return; // fresh pool → created at our ratio
        uint256 lhs = uint256(pool.reserve1) * a0;
        uint256 rhs = uint256(pool.reserve0) * a1;
        uint256 diff = lhs > rhs ? lhs - rhs : rhs - lhs;
        if (diff * 10_000 > rhs * MAX_INIT_PRICE_DEVIATION_BPS) revert PoolPriceMismatch();
    }

    /// @notice Retry delivering a graduation vault cut that a reverting vault previously rejected.
    /// @dev Permissionless (mirrors the ERC721 flushPendingVaultCut authority model): the ETH goes to the
    ///      vault bound at stash time UNLESS that target has since been de-curated, in which case the
    ///      de-curation gate (noesis-126/noesis-435) returns the cut to the instance's creator — the retry
    ///      is not a redirect-free surface, it faces the same de-curation risk as the primary send. The
    ///      pending amount is zeroed BEFORE the external call (checks-effects-interactions); if the active
    ///      vault still reverts the whole transaction reverts and the stash is restored — idempotent, no ETH
    ///      is ever lost.
    /// @param instance The graduated instance whose stashed cut should be flushed.
    function flushPendingVaultCut(address instance) external {
        PendingCut memory pc = pendingVaultCut[instance];
        if (pc.amount == 0) revert NoPendingVaultCut();
        delete pendingVaultCut[instance];
        if (!masterRegistry.isVaultRegistered(pc.vault)) {
            // Target de-curated while stashed: return the cut to the instance's creator rather than
            // force-feed the de-curated vault. The stashed cut is the same money as a fresh one and must
            // not survive as a treasury path (noesis-435).
            // The creator is read back through the instance for the same reason the treasury was — the
            // instance's `owner()` is the address the primary graduation leg pays as `DeployParams.creator`
            // — so `PendingCut` does not have to grow a field (it is a public mapping; a new member would
            // change the generated getter for no benefit). forceSafeTransferETH is brick-proof so a
            // creator that rejects ETH cannot strand the retry.
            address creator = IFactoryInstance(instance).owner();
            SafeTransferLib.forceSafeTransferETH(creator, pc.amount);
            emit PendingVaultCutReturnedToCreator(pc.vault, creator, pc.amount);
        } else {
            IAlignmentVault(payable(pc.vault)).receiveContribution{ value: pc.amount }(
                Currency.wrap(address(0)), pc.amount, instance
            );
            emit VaultContributionRetried(pc.vault, instance, pc.amount);
        }
    }

    receive() external payable { }

    // ── IComponentModule ───────────────────────────────────────────────────────

    function metadataURI() external view override returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external override onlyOwner {
        _metadataURI = uri;
        emit MetadataURIUpdated(uri);
    }
}
