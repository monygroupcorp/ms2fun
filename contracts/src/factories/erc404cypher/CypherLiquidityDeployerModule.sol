// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { IERC20 } from "../../shared/interfaces/IERC20.sol";
import { IAlgebraFactory, IAlgebraPool, IAlgebraNFTPositionManager } from "../../interfaces/algebra/IAlgebra.sol";
import { CypherAlignmentVault } from "../../vaults/cypher/CypherAlignmentVault.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { ILiquidityDeployerModule, IGraduationSkipNFTTarget } from "../../interfaces/ILiquidityDeployerModule.sol";
import { IFactoryInstance } from "../../interfaces/IFactoryInstance.sol";
import { IMasterRegistry } from "../../master/interfaces/IMasterRegistry.sol";
import { RevenueSplitLib } from "../../shared/libraries/RevenueSplitLib.sol";
import { Ownable } from "solady/auth/Ownable.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
}

/// @title CypherLiquidityDeployerModule
/// @notice Called by ERC404BondingInstance at graduation.
///         Creates Algebra pool, mints the LP position NFT to the instance, registers benefactor.
/// @dev GRADUATION-LP PERMANENCE INVARIANT (Cypher venue). The Algebra position NFT minted at
///      graduation (`_setupPool`, `recipient: p.instance`) is permanently locked: it is owned by the
///      ERC404 instance, and NO code path in this system can move or remove it. This module exposes no
///      removeLiquidity / decreaseLiquidity / collect / NFT-transfer entry point; the instance is
///      immutable and exposes no function that transfers a foreign ERC-721 (`withdrawDust` touches only
///      its own DN404 units + bonding reserve). Graduation liquidity is therefore locked by design, not
///      by the mere absence of a caller. Do NOT add any path that transfers, burns, or withdraws this
///      position. Pinned by test (`test/factories/LpLockInvariant.t.sol`).
///      Sub-note (benign): Algebra LP swap fees accrue to this position, and the instance has no
///      `collect()` path — they are stranded in the position (they only add to locked depth). This is
///      NOT the alignment tithe: the perpetual swap tithe exists ONLY on the Uni V4 venue (by design);
///      the Cypher-graduated pool is untaxed. See docs/phases/vault-flavors.md.
contract CypherLiquidityDeployerModule is ILiquidityDeployerModule, Ownable {
    using FixedPointMathLib for uint256;

    error ETHMismatch();
    error InvalidParams();
    error ZeroLiquidity();
    /// @dev Caller is not the genuine, registered ERC404 instance named in p.instance.
    error UnauthorizedCaller();
    /// @dev An attacker pre-initialized the graduation pool at a price outside tolerance.
    error PoolPriceMismatch();
    /// @dev flushPendingVaultCut called for an instance with no stashed cut.
    error NoPendingVaultCut();
    /// @dev sweepUnconsumedCoin called for an instance holding no stray coin here.
    error NoUnconsumedCoin();

    /// @notice Max deviation (bps) tolerated between an already-initialized pool's PRICE and the
    ///         intended graduation price. 100 bps (1%) mirrors the 99/100 LP-min-slippage convention
    ///         already used in this module. A larger gap means the pool was seeded by a front-runner
    ///         at a skewed price — we revert (retryable) rather than mint LP into it.
    /// @dev The band is measured on price, which is `sqrtPriceX96` SQUARED — see
    ///      `_requireSqrtPriceWithinTolerance`. Measuring it on the root instead is what made this
    ///      constant mean 2% for as long as it was labelled 1%.
    uint256 public constant MAX_INIT_PRICE_DEVIATION_BPS = 100;

    address public immutable algebraFactory;
    address public immutable positionManager;
    address public immutable weth;
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
    constructor(address _algebraFactory, address _positionManager, address _weth, address _masterRegistry) {
        algebraFactory = _algebraFactory;
        positionManager = _positionManager;
        weth = _weth;
        masterRegistry = IMasterRegistry(_masterRegistry);
        _initializeOwner(msg.sender);
    }

    // Full-range ticks for tick spacing 60: floor(887272/60)*60 = 887220
    int24 public constant TICK_LOWER = -887220;
    int24 public constant TICK_UPPER = 887220;

    event LiquidityDeployed(address indexed vault, address pool, uint256 tokenId, uint256 ethToLP, uint256 tokenToLP);
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
    /// @notice The LP capital the position manager did not take, and where it went. `ethTithed` was
    ///         unwrapped and joined the 80/19/1 rail as a second `excessEth` leg; `ethReturned` and
    ///         `coinReturned` went back to the graduating instance.
    /// @dev Both are zero on an ordinary graduation into a fresh pool, and non-zero only when the pool
    ///      was already initialized at a price inside `MAX_INIT_PRICE_DEVIATION_BPS` but not at the
    ///      graduation price, which is the only case where a full-range mint binds on one side.
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

    struct PoolSetupResult {
        uint256 tokenId;
        address pool;
        uint256 ethToLP;
        uint256 protocolFee; // 1% of raise + 1% of carve
        uint256 vaultCut; // 19% of raise + 19% of carve
        uint256 creatorCut; // 80% of carve → creator
        uint256 carvePaid; // effective gross diversion: carve + excess, post-clamp
        bool tokenIsZero;
        uint256 residueTithed; // LP ETH the position manager declined, folded onto the rail here
        uint256 ethUsed; // WETH the position manager actually took out of ethToLP
        uint256 coinUsed; // coin the position manager actually took out of p.tokenReserve
    }

    /// @notice Deploy Algebra pool liquidity and register with vault.
    /// @dev Caller must have pre-transferred tokenReserve to this contract.
    ///      ETH must equal p.ethReserve exactly.
    // slither-disable-next-line reentrancy-events
    function deployLiquidity(DeployParams calldata p) external payable override {
        // Strict caller guard: only a genuine, registered ERC404 instance acting as itself may
        // deploy liquidity. For ERC404, instance == token, and the instance is the msg.sender at
        // graduation. Blocks arbitrary callers passing a crafted DeployParams.
        if (msg.sender != p.instance || !masterRegistry.isRegisteredInstance(msg.sender)) {
            revert UnauthorizedCaller();
        }
        if (msg.value != p.ethReserve) revert ETHMismatch();
        if (p.token == address(0) || p.vault == address(0)) revert InvalidParams();

        PoolSetupResult memory r = _setupPool(p);
        _returnResidue(p, r);
        _postMint(p, r);
    }

    // slither-disable-next-line arbitrary-send-eth,incorrect-equality,timestamp,unused-return
    function _setupPool(ILiquidityDeployerModule.DeployParams calldata p) private returns (PoolSetupResult memory r) {
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
        r.ethToLP = g.ethForPool;

        // ── Compute sqrtPriceX96 internally from token ordering ──
        bool tokenIsZero = p.token < weth;
        uint256 amount0 = tokenIsZero ? p.tokenReserve : r.ethToLP;
        uint256 amount1 = tokenIsZero ? r.ethToLP : p.tokenReserve;
        // Clamp the derived sqrtPrice to the valid tick range (mirrors the Uni LiquidityDeployerModule).
        // An extreme reserve ratio can push the raw sqrt above uint160.max (wrapping on the cast) or below
        // MIN_SQRT_PRICE, which would corrupt the pool init price; cap then clamp to [MIN+1, MAX-1].
        uint256 sqrtRaw = FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(amount1, 1 << 192, amount0));
        if (sqrtRaw > type(uint160).max) sqrtRaw = type(uint160).max;
        uint160 sqrtPriceX96 = uint160(sqrtRaw);
        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE + 1) sqrtPriceX96 = TickMath.MIN_SQRT_PRICE + 1;
        if (sqrtPriceX96 > TickMath.MAX_SQRT_PRICE - 1) sqrtPriceX96 = TickMath.MAX_SQRT_PRICE - 1;

        // ── Wrap ETH to WETH for LP ──
        IWETH(weth).deposit{ value: r.ethToLP }();

        // ── Create/validate Algebra pool (front-run-safe) ──
        // Algebra's createPool reverts if the pair already exists, so an attacker who pre-created the
        // pool would have permanently DoS'd graduation. Instead: reuse an existing pool, initialize it
        // if still fresh, and if it was already initialized accept it only within price tolerance —
        // never mint LP into an attacker-skewed pool.
        r.pool = _createOrValidatePool(p.token, sqrtPriceX96);

        // ── Name this venue's coin counterparties to the graduating instance ──
        // BEFORE the approves below, which are what let the coin move. An ERC404 instance mints one
        // NFT id per `unit` to an unflagged recipient, so an unflagged graduation counterparty takes
        // delivery of the whole coin side in ids — and the pool re-mints them on the sell side of
        // every later swap.
        //
        // This venue is why the mechanism is a callback rather than a getter on the module: the pool
        // does not exist until the line above, so there is no address for the instance to read before
        // the call. Both the pool and the position manager are flagged, because which of the two takes
        // custody of the coin is an implementation detail of the Algebra periphery — production
        // periphery pays payer→pool inside the mint callback, while this repo's in-tree Algebra double
        // pulls both amounts to the position manager. Flagging both is correct under either, and the
        // position manager holds no ids under either. The calls are hard, not fail-soft: an instance
        // that cannot be told is one whose pool would silently take delivery.
        IGraduationSkipNFTTarget(p.instance).markGraduationSkipNFT(r.pool);
        IGraduationSkipNFTTarget(p.instance).markGraduationSkipNFT(positionManager);

        // ── Determine token ordering and amounts ──
        r.tokenIsZero = tokenIsZero;
        (address token0, address token1) = tokenIsZero ? (p.token, weth) : (weth, p.token);

        // ── Approve and mint LP ──
        IERC20(p.token).approve(positionManager, p.tokenReserve);
        IERC20(weth).approve(positionManager, r.ethToLP);

        // KEEP THE RETURN VALUES. `mint` takes up to `amountNDesired` of each side and stops at the
        // pool's live price, so discarding `(amount0, amount1)` was the module never even observing
        // what its own venue had declined to take.
        uint128 liquidity;
        uint256 used0;
        uint256 used1;
        (r.tokenId, liquidity, used0, used1) = IAlgebraNFTPositionManager(positionManager)
            .mint(
                IAlgebraNFTPositionManager.MintParams({
                    token0: token0,
                    token1: token1,
                    deployer: address(0),
                    tickLower: TICK_LOWER,
                    tickUpper: TICK_UPPER,
                    amount0Desired: amount0,
                    amount1Desired: amount1,
                    amount0Min: amount0 * 99 / 100, // 1% slippage tolerance
                    amount1Min: amount1 * 99 / 100,
                    recipient: p.instance,
                    deadline: block.timestamp + 15 minutes
                })
            );
        if (liquidity == 0) revert ZeroLiquidity();
        (r.coinUsed, r.ethUsed) = tokenIsZero ? (used0, used1) : (used1, used0);
    }

    // slither-disable-next-line arbitrary-send-eth,reentrancy-events,timestamp
    function _postMint(ILiquidityDeployerModule.DeployParams calldata p, PoolSetupResult memory r) private {
        // D2 — decoupled launch LP: the graduation position is now owned by p.instance (minted to it
        // above), NOT the vault. The vault's own LP position is its reference-priced ALIGNMENT position
        // built via convertAndAddLiquidity, so the module no longer registers a launch position here.
        // 1% → protocol treasury
        if (r.protocolFee > 0 && p.protocolTreasury != address(0)) {
            SafeTransferLib.safeTransferETH(p.protocolTreasury, r.protocolFee);
            emit GraduationFeePaid(p.protocolTreasury, r.protocolFee);
        }
        // 19% of raise (+ 19% of carve) → alignment vault via receiveContribution. Isolate the send: a
        // reverting vault (cut below MIN_CONTRIBUTION, participant cap, a broken upgrade) must NOT brick
        // graduation. On failure the r.vaultCut ETH is retained in this module and stashed as
        // pendingVaultCut[p.instance] for later delivery via flushPendingVaultCut — mirroring the
        // ERC1155/721 try/catch + pending-cut retry. Graduation completes; the tithe is deferred, not lost.
        if (r.vaultCut > 0) {
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
                try CypherAlignmentVault(payable(p.vault)).receiveContribution{ value: r.vaultCut }(
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
        // The DELIVERED legs, not the requested ones: `r.ethToLP` and `r.coinUsed` are what the
        // position manager actually took. This is the figure indexers read for the graduated pool's
        // opening depth, and it was reporting the request.
        emit LiquidityDeployed(p.vault, r.pool, r.tokenId, r.ethToLP, r.coinUsed);
    }

    /// @dev Give the LP capital the position manager did not take an owner, in the same transaction
    ///      that discovers it. This module is a SINGLETON shared by every ERC404 graduation on this
    ///      venue, so anything left here is not merely locked, it is unattributable: it mixes with the
    ///      next collection's money and with the `pendingVaultCut` stash. Two destinations, neither of
    ///      them new:
    ///
    ///        * WETH is unwrapped and joins the 80/19/1 rail as a second `excessEth` leg — the same
    ///          treatment the instance already gives LP-share ETH its own parity clamp could not place
    ///          (`ERC404BondingOps.deployLiquidity`, noesis-188). It has to come back through
    ///          `withdraw` because this module wraps the WHOLE LP leg up front, so the residue is WETH
    ///          and the rail pays in ETH. `_titheResidue` re-runs the split with the residue folded
    ///          into the diverted legs, so the figures `_postMint` pays out account for it.
    ///        * Coin goes back to the graduating instance, which is the only address with any claim on
    ///          it. The instance's own skipNFT is set at `_initializeDN404`, so this mints it no ids.
    ///          Both leftover allowances are zeroed with it: what this module no longer holds must not
    ///          stay spendable by the position manager.
    ///
    ///      NO REMOVAL PATH IS ADDED. The Algebra position NFT is the instance's and is untouched; this
    ///      moves only what never entered the pool. `test/factories/LpLockInvariant.t.sol` pins that
    ///      distinction by probing for removal-shaped selectors, and it still finds none.
    ///
    ///      With no creator the rail has no 80 leg to pay, so the ETH follows the coin to the instance
    ///      rather than staying in the singleton — a strictly better home than this contract, and
    ///      deliberately not a policy decision about what a renounced launch is owed (that is L-11).
    function _returnResidue(ILiquidityDeployerModule.DeployParams calldata p, PoolSetupResult memory r) private {
        uint256 ethResidue = r.ethToLP - r.ethUsed;
        uint256 coinResidue = p.tokenReserve - r.coinUsed;

        if (ethResidue != 0) {
            IERC20(weth).approve(positionManager, 0);
            IWETH(weth).withdraw(ethResidue);
            if (p.creator == address(0)) {
                SafeTransferLib.forceSafeTransferETH(p.instance, ethResidue);
            } else {
                _titheResidue(p, r, ethResidue);
            }
        }
        if (coinResidue != 0) {
            IERC20(p.token).approve(positionManager, 0);
            SafeTransferLib.safeTransfer(p.token, p.instance, coinResidue);
        }
        if (ethResidue != 0 || coinResidue != 0) {
            bool renounced = p.creator == address(0);
            emit GraduationResidueReturned(
                p.instance, renounced ? 0 : ethResidue, renounced ? ethResidue : 0, coinResidue
            );
        }
        // From here on `r` describes the pool as it IS, not as it was sized. `_titheResidue` already
        // lands `ethToLP` on this value; the no-creator branch has to be told.
        r.ethToLP = r.ethUsed;
    }

    /// @dev Re-run the graduation split with `residueEth` added to the diverted legs, so every figure
    ///      `_postMint` pays is computed against the ETH the pool actually took. The residue rides the
    ///      rail rather than being paid out whole because it IS LP-share ETH: the 1% and 19% legs are
    ///      levied on the full raise and the 80 is the creator's, and none of that changes because a
    ///      front-runner moved the pool's price.
    function _titheResidue(
        ILiquidityDeployerModule.DeployParams calldata p,
        PoolSetupResult memory r,
        uint256 residueEth
    ) private pure {
        RevenueSplitLib.GraduationSplit memory g = RevenueSplitLib.splitGraduation(
            p.ethReserve, p.carveEth + p.excessEth + residueEth, 0
        );
        r.protocolFee = g.protocolCut;
        r.vaultCut = g.vaultCut;
        r.creatorCut = g.creatorCut;
        r.carvePaid = g.carveApplied;
        r.ethToLP = g.ethForPool;
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
    ///        * NO ETH, AND NO WETH. An ETH sweep on this module would be a genuine new trust surface:
    ///          the module custodies live graduation ETH and the `pendingVaultCut` stash, whose
    ///          invariant is that the sum of every pending amount is covered by this balance. The WETH
    ///          residue is unwrapped and routed in transaction instead, and no path here moves ETH that
    ///          is not owed to a named payee.
    ///        * NOT A REMOVAL PATH. The graduation position is an Algebra NFT owned by the instance,
    ///          not a coin balance here, so this cannot reach it. Pinned by `LpLockInvariant.t.sol`.
    /// @param instance The graduated ERC404 instance, which is also its own token.
    function sweepUnconsumedCoin(address instance) external {
        uint256 amount = SafeTransferLib.balanceOf(instance, address(this));
        if (amount == 0) revert NoUnconsumedCoin();
        SafeTransferLib.safeTransfer(instance, instance, amount);
        emit UnconsumedCoinSwept(instance, amount);
    }

    /// @dev Front-run-safe pool acquisition. Returns a pool initialized at (or within tolerance of)
    ///      the intended graduation price, reverting PoolPriceMismatch on an attacker-skewed pre-init.
    function _createOrValidatePool(address token, uint160 intendedSqrtPriceX96) private returns (address pool) {
        pool = IAlgebraFactory(algebraFactory).poolByPair(token, weth);
        if (pool == address(0)) {
            pool = IAlgebraFactory(algebraFactory).createPool(token, weth, "");
            IAlgebraPool(pool).initialize(intendedSqrtPriceX96);
        } else {
            (uint160 existingSqrtPriceX96,,,,,) = IAlgebraPool(pool).globalState();
            if (existingSqrtPriceX96 == 0) {
                IAlgebraPool(pool).initialize(intendedSqrtPriceX96);
            } else {
                _requireSqrtPriceWithinTolerance(existingSqrtPriceX96, intendedSqrtPriceX96);
            }
        }
    }

    /// @dev Reverts unless the existing pool's PRICE is within MAX_INIT_PRICE_DEVIATION_BPS of the
    ///      intended graduation price.
    ///
    ///      MEASURED ON PRICE, NOT ON `sqrtPriceX96`. The band used to be applied to the square root,
    ///      and price is its square, so a constant labelled 100 bps admitted -1.99%/+2.01% on the
    ///      quantity that actually decides how much of each side the pool takes. The `amountNMin`
    ///      floors below capped the damage here at 1% of a leg, but the label was still wrong by a
    ///      factor of two, and it is the same defect the Uni V4 module carried uncapped.
    ///
    ///      The deviation on price is `|e^2 - i^2| / i^2 = diff*sum / i^2`, and both `diff*sum` and
    ///      `i^2` overflow `uint256` at the top of the `uint160` range, so the comparison is taken one
    ///      division early: `(diff*sum / i)*10000 <= i*bps`. `fullMulDiv` carries the intermediate at
    ///      512 bits, so the only rounding is that single floor.
    function _requireSqrtPriceWithinTolerance(uint160 existingSqrtPriceX96, uint160 intendedSqrtPriceX96) private pure {
        uint256 diff = existingSqrtPriceX96 > intendedSqrtPriceX96
            ? existingSqrtPriceX96 - intendedSqrtPriceX96
            : intendedSqrtPriceX96 - existingSqrtPriceX96;
        uint256 sum = uint256(existingSqrtPriceX96) + intendedSqrtPriceX96;
        uint256 deviation = FixedPointMathLib.fullMulDiv(diff, sum, intendedSqrtPriceX96);
        if (deviation * 10_000 > uint256(intendedSqrtPriceX96) * MAX_INIT_PRICE_DEVIATION_BPS) {
            revert PoolPriceMismatch();
        }
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
            CypherAlignmentVault(payable(pc.vault)).receiveContribution{ value: pc.amount }(
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
