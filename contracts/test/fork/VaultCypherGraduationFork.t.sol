// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ForkTestBase } from "./helpers/ForkTestBase.sol";
import { CypherAlignmentVault } from "../../src/vaults/cypher/CypherAlignmentVault.sol";
import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";
import { zRouter } from "../../src/peripherals/zRouter.sol";
import { MockZQuoter } from "../mocks/MockZQuoter.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { IAlgebraFactory, IAlgebraPool, IAlgebraNFTPositionManager } from "../../src/interfaces/algebra/IAlgebra.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { Currency } from "v4-core/types/Currency.sol";

/**
 * @title VaultCypherGraduationFork
 * @notice THE MISSING CYPHER GRADUATION-ACQUIRE FORK TEST (noesis-027b verify list / LOCKED-audit D4).
 *         The Uni flavor has VaultUniGraduationFork; the Cypher flavor had only mock coverage
 *         (MockCypherAlgebra / MockZRouter), so no fork-level test confirmed the acquire/seed/LP path
 *         against REAL Algebra Integral semantics — the exact gap D4 says would let a real
 *         createPool/initialize ordering, globalState decoding, or NFPM mint under-absorption mismatch
 *         vs the mock ship undetected. This drives `convertAndAddLiquidity` end-to-end on the mainnet
 *         fork:
 *
 *           1. Reference price: the REAL Uniswap V3 WETH/USDC 0.3% pool TWAP (kind 0) — the canonical
 *              ReferencePool the vault prices everything from.
 *           2. Acquire: a REAL ETH->USDC swap through the REAL zRouter (best-route UNI_V3 leg; the
 *              quoter is mocked to *select* the route, but the swap itself hits the live Uni V3 pool).
 *           3. Seed + LP: the vault calls the REAL Cypher/Algebra factory `createPool` + pool
 *              `initialize(referenceSqrtPrice)` + REAL NFPM `mint` (then `increaseLiquidity` on the
 *              repeat), so the fresh target/WETH pool is created and seeded at the reference price and
 *              the position is LP'd against production Algebra contracts — not the mock.
 *
 *         USDC is the alignment target: it has a deep real Uni V3 WETH pool (reference + acquire
 *         liquidity) while the Cypher/Algebra USDC/WETH pool is created fresh by the vault here.
 *
 *         Fork-gated: ForkTestBase.loadAddresses() calls vm.skip(true) when WETH has no code (no
 *         --fork-url), so this is inert in the default `forge test` run.
 *         Run: forge test --mp test/fork/VaultCypherGraduationFork.t.sol --fork-url $MAINNET_RPC_URL -vv
 */
contract VaultCypherGraduationForkTest is ForkTestBase {
    // ── Canonical Cypher/Algebra mainnet addresses (mirror DeployMainnet). ──
    address constant CYPHER_ALGEBRA_FACTORY = 0xfb8Ed3485EfA29a0e4bed93351dD51B59fC4b0f0;
    address constant CYPHER_NFPM = 0x0a984a446A116335ac90425d2D1E69A7199A2f7c;
    address constant CYPHER_SWAP_ROUTER = 0x20C5893f69F635f55b0367C519F3f95e59c0b0Ab;

    uint256 constant TARGET_ID = 1;

    CypherAlignmentVault vault;
    MockZQuoter quoter;
    address alignmentToken;
    address benefactor;
    address protocolTreasury = makeAddr("treasury");

    function setUp() public {
        loadAddresses(); // vm.skip(true) when not on a fork

        alignmentToken = USDC; // deep real Uni V3 WETH pool for the reference + the acquire
        benefactor = makeAddr("benefactor");

        // Real routing (as production wires it) + a mocked quoter that SELECTS the real Uni V3 leg.
        zRouter router = new zRouter();
        quoter = new MockZQuoter();

        // Real price validator reading the real Uni V3 WETH/USDC pool TWAP for the reference (kind 0).
        UniswapVaultPriceValidator validator = new UniswapVaultPriceValidator(
            WETH, UNISWAP_V2_FACTORY, UNISWAP_V3_FACTORY, UNISWAP_V4_POOL_MANAGER, 1000, 1800
        );

        MockAlignmentRegistry registry = new MockAlignmentRegistry();
        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, alignmentToken, true);
        // Reference = real Uni V3 WETH/USDC 0.3% pool (kind 0); acquire route = ALGEBRA (Cypher target).
        registry.setReferencePool(
            TARGET_ID,
            alignmentToken,
            IAlignmentRegistry.ReferencePool({ pool: WETH_USDC_V3_03, kind: 0, twapWindow: 1800 })
        );
        registry.setAcquireRoute(
            TARGET_ID,
            alignmentToken,
            IAlignmentRegistry.AcquireRoute({
                venue: IAlignmentRegistry.Venue.ALGEBRA, fee: 0, tickSpacing: 0, feeOrHook: 0
            })
        );

        CypherAlignmentVault impl = new CypherAlignmentVault();
        vault = CypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            CYPHER_NFPM,
            CYPHER_SWAP_ROUTER,
            CYPHER_ALGEBRA_FACTORY,
            WETH,
            alignmentToken,
            protocolTreasury,
            address(router),
            address(quoter),
            address(validator),
            IAlignmentRegistry(address(registry)),
            TARGET_ID
        );

        vm.label(address(vault), "CypherAlignmentVault");
        vm.label(address(router), "zRouter");
    }

    /// @notice Full graduation/acquire round-trip against real Algebra: contributions → convert →
    ///         a fresh Cypher pool is created + seeded at the reference price and a live NFPM position
    ///         exists; a second convert aggregates into the SAME NFT (never a second one).
    function test_cypherVaultConvert_realAlgebra_acquiresSeedsAndLPs() public {
        assertTrue(vault.isLiquidityReady(), "vault must be liquidity-ready");

        // The Cypher/Algebra USDC/WETH pool should not exist yet — the vault creates it fresh.
        address poolBefore = IAlgebraFactory(CYPHER_ALGEBRA_FACTORY).poolByPair(alignmentToken, WETH);

        // Route ETH into the vault as an instance's alignment tithe would (spendable pending ETH).
        _contribute(benefactor, 2 ether);
        assertEq(vault.totalPendingETH(), 2 ether, "pending ETH tracked");

        // Tell the mocked quoter to select the real Uni V3 0.3% leg for the ETH->USDC acquire; the
        // amountOut here only picks the route — zRouter executes the REAL swap on the live pool.
        quoter.setBest(MockZQuoter.AMM.UNI_V3, 30, 1 ether, 1);

        vault.convertAndAddLiquidity(1);

        // ── The vault created + LP'd a real Algebra position. ──
        address pool = vault.lpPool();
        assertTrue(pool != address(0), "vault must resolve/create the Cypher LP pool");
        assertEq(
            IAlgebraFactory(CYPHER_ALGEBRA_FACTORY).poolByPair(alignmentToken, WETH),
            pool,
            "lpPool is the canonical Cypher pair pool"
        );
        uint256 tokenId = vault.lpTokenId();
        assertGt(tokenId, 0, "an NFPM position was minted");
        assertEq(IAlgebraNFTPositionManager(CYPHER_NFPM).ownerOf(tokenId), address(vault), "vault owns the position");
        (,,,,,,, uint128 posLiquidity,,,,) = IAlgebraNFTPositionManager(CYPHER_NFPM).positions(tokenId);
        assertGt(posLiquidity, 0, "a live Algebra position exists on-chain");

        // ── Seeded at the reference price (not caller/self spot) when the vault created the pool. ──
        if (poolBefore == address(0)) {
            (uint160 poolSqrt,,,,,) = IAlgebraPool(pool).globalState();
            uint160 refSqrt = _referenceSqrt(validator());
            // mint at the current price does not move it, and the acquire hit a DIFFERENT (Uni) pool,
            // so the fresh Cypher pool stays exactly at the reference-derived seed price.
            assertApproxEqRel(uint256(poolSqrt), uint256(refSqrt), 1e16, "fresh pool seeded at the reference price");
        }

        // ── B2: a second convert aggregates into the SAME NFT, strictly increasing liquidity. ──
        _contribute(benefactor, 2 ether);
        vault.convertAndAddLiquidity(1);
        assertEq(vault.lpTokenId(), tokenId, "repeat convert reuses the same tokenId (no second NFT)");
        (,,,,,,, uint128 posLiquidity2,,,,) = IAlgebraNFTPositionManager(CYPHER_NFPM).positions(tokenId);
        assertGt(posLiquidity2, posLiquidity, "repeat convert increased the position's liquidity");

        emit log_named_uint("Cypher position liquidity after convert #1", posLiquidity);
        emit log_named_uint("Cypher position liquidity after convert #2", posLiquidity2);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _contribute(address who, uint256 amount) internal {
        vm.deal(address(this), amount);
        vault.receiveContribution{ value: amount }(Currency.wrap(address(0)), amount, who);
    }

    /// @dev The vault's own reference-derived sqrtPriceX96 for the target/WETH pool ordering — mirrors
    ///      `CypherAlignmentVault._deriveReferenceSqrtPrice` so we can assert the fresh seed price.
    function _referenceSqrt(UniswapVaultPriceValidator v) internal view returns (uint160) {
        uint256 ethPerToken = v.quoteEthForTokensVia(WETH_USDC_V3_03, 0, 1800, alignmentToken, 1e18);
        (uint256 a0, uint256 a1) = alignmentToken < WETH ? (uint256(1e18), ethPerToken) : (ethPerToken, uint256(1e18));
        return uint160(FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(a1, 1 << 192, a0)));
    }

    /// @dev The validator instance wired into the vault (re-read from the vault to avoid stashing it).
    function validator() internal view returns (UniswapVaultPriceValidator) {
        return UniswapVaultPriceValidator(address(vault.priceValidator()));
    }
}
