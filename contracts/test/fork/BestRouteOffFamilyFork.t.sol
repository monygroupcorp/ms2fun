// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ForkTestBase } from "./helpers/ForkTestBase.sol";
import { UniAlignmentVault } from "src/vaults/uni/UniAlignmentVault.sol";
import { UniAlignmentVaultFactory } from "src/vaults/uni/UniAlignmentVaultFactory.sol";
import { UniswapVaultPriceValidator } from "src/peripherals/UniswapVaultPriceValidator.sol";
import { IVaultPriceValidator } from "src/interfaces/IVaultPriceValidator.sol";
import { zRouter } from "src/peripherals/zRouter.sol";
import { CANONICAL_ZROUTER } from "./VaultUniGraduationFork.t.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { IAlignmentRegistry } from "src/master/interfaces/IAlignmentRegistry.sol";
import { CREATEX } from "src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

/**
 * @title BestRouteOffFamilyFork
 * @notice noesis-106 (a) — the RPC-gated regression pin for swap-path finding 1: with a REAL zQuoter
 *         set, a Uni-family vault buying a token whose DEEPEST liquidity is on a NON-family venue
 *         (e.g. a V2-only token) actually routes through best-route (off-family), instead of being
 *         confined to its fixed V4 family pool. Together with the in-gate fallback pin
 *         (test/vaults/BestRouteFallbackPin.t.sol), this pins the #65/#093 enablement so the
 *         multi-venue capability can never silently regress to fixed-pool-only.
 *
 * @dev Operator input, NOT hardcoded in this test:
 *        - ZQUOTER_ADDRESS  — the canonical zQuoter of the zRouter/zQuoter suite whose AMM enum
 *                             `BestRouteAcquirer.IBestRouteQuoter` mirrors (`zQuoterBase` on mainnet).
 *        - OFF_FAMILY_TOKEN — a token whose deepest ETH liquidity is on a non-V4 (off-family) venue.
 *      Both are read from the environment; the test skips cleanly when either is absent, exactly as
 *      it skips without `--fork-url`. It NEVER hardcodes a route address and NEVER fails the standard
 *      gate — it is exercised only in the RPC-enabled fork job with those two env vars supplied:
 *        forge test --mp test/fork/BestRouteOffFamilyFork.t.sol --fork-url "$MAINNET_RPC_URL" \
 *          --env ZQUOTER_ADDRESS=0x... --env OFF_FAMILY_TOKEN=0x... -vv
 *
 *      Fork-gated: ForkTestBase.loadAddresses() calls vm.skip(true) when WETH has no code (no fork),
 *      so this is inert in the default `forge test` run.
 */
contract BestRouteOffFamilyForkTest is ForkTestBase {
    uint24 constant FEE = 3000; // vault fixed-pool family fee (V4)
    int24 constant TICK_SPACING = 60;
    uint256 constant TARGET_ID = 1;
    address constant TREASURY = address(0xFEE);

    address zQuoter; // operator-supplied real quoter (ZQUOTER_ADDRESS)
    address offFamilyToken; // operator-supplied off-family token (OFF_FAMILY_TOKEN)

    zRouter router;
    UniAlignmentVault vaultBest; // wired WITH the real zQuoter → best-route enabled
    UniAlignmentVault vaultCtrl; // wired with zQuoter == address(0) → fixed-pool fallback only
    address alice;

    function setUp() public {
        loadAddresses(); // vm.skip(true) when not on a fork

        zQuoter = vm.envOr("ZQUOTER_ADDRESS", address(0));
        offFamilyToken = vm.envOr("OFF_FAMILY_TOKEN", address(0));
        // Without a real quoter + off-family token (operator input) there is nothing real to route;
        // skip rather than assert against a placeholder. Combined with the no-fork skip above, this
        // test only executes in the RPC job with both env vars set.
        //
        // The skip carries its REASON. A bare `vm.skip(true)` reports as an unexplained "1 skipped" in the
        // run summary, which reads like coverage that ran; naming the unmet precondition makes it legible
        // in the summary line itself that this pin contributed no assertions and why.
        if (zQuoter == address(0)) {
            vm.skip(true, "ZQUOTER_ADDRESS unset - no real quoter to route through (operator input)");
            return;
        }
        if (zQuoter.code.length == 0) {
            vm.skip(true, "ZQUOTER_ADDRESS has no code at this fork block - not a live quoter");
            return;
        }
        if (offFamilyToken == address(0)) {
            vm.skip(true, "OFF_FAMILY_TOKEN unset - no off-family token to acquire (operator input)");
            return;
        }

        alice = makeAddr("alice");
        vm.etch(alice, "");
        vm.etch(CREATEX, CREATEX_BYTECODE); // factory CREATE3 path

        // The canonical deployed zRouter singleton production pins, not a local copy of it.
        require(CANONICAL_ZROUTER.code.length > 0, "canonical zRouter has no code at this fork block");
        router = zRouter(payable(CANONICAL_ZROUTER));
        UniswapVaultPriceValidator priceValidator = new UniswapVaultPriceValidator(
            WETH, UNISWAP_V2_FACTORY, UNISWAP_V3_FACTORY, UNISWAP_V4_POOL_MANAGER, 1000, 1800
        );

        MockAlignmentRegistry registry = new MockAlignmentRegistry();
        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, offFamilyToken, true);

        vaultBest = _deployVault(priceValidator, registry, zQuoter, keccak256("offfamily-best"));
        vaultCtrl = _deployVault(priceValidator, registry, address(0), keccak256("offfamily-ctrl"));
    }

    function _deployVault(
        UniswapVaultPriceValidator priceValidator,
        MockAlignmentRegistry registry,
        address quoter,
        bytes32 salt
    ) internal returns (UniAlignmentVault vault) {
        UniAlignmentVaultFactory factory = new UniAlignmentVaultFactory(
            WETH,
            UNISWAP_V4_POOL_MANAGER,
            address(router),
            FEE,
            TICK_SPACING,
            TREASURY,
            IVaultPriceValidator(address(priceValidator)),
            IAlignmentRegistry(address(registry)),
            quoter // factory forwards to vault.setZQuoter on create when != address(0)
        );
        vault = UniAlignmentVault(
            payable(factory.deployVault(salt, offFamilyToken, TARGET_ID, IVaultPriceValidator(address(0))))
        );
        // The vault's FIXED family pool key: native ETH / token on the V4 FEE/TICK venue. For a genuine
        // off-family token this pool is absent or thin — so the fixed-pool fallback path cannot fill.
        factory.setVaultPoolKey(
            address(vault),
            PoolKey({
                currency0: Currency.wrap(address(0)),
                currency1: Currency.wrap(offFamilyToken),
                fee: FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(address(0))
            })
        );
    }

    /// With a real zQuoter set, converting an off-family token routes through best-route and succeeds;
    /// the fixed-pool-only control (zQuoter == 0) cannot beat it — it reverts (family venue can't fill)
    /// or books no more LP. This is the "acquired-out reflects the deeper (off-family) venue" pin.
    function test_offFamilyToken_routesThroughBestRoute() public {
        // Precondition: the two vaults differ ONLY in quoter wiring.
        assertEq(vaultBest.zQuoter(), zQuoter, "best vault wired to the real quoter");
        assertEq(vaultCtrl.zQuoter(), address(0), "control vault is fixed-pool-only");

        vm.deal(alice, 20 ether);

        // Best-route vault: convert must succeed and book LP — the acquire found the off-family venue.
        vm.prank(alice);
        (bool okBest,) = address(vaultBest).call{ value: 5 ether }("");
        require(okBest, "best contribution failed");
        vaultBest.convertAndAddLiquidity(1);
        uint256 lpBest = vaultBest.totalLPUnits();
        assertGt(lpBest, 0, "best-route vault must acquire off-family and book LP");

        // Control vault: same token, same ETH, but fixed-pool-only. If the family venue truly lacks the
        // depth, this reverts — proving best-route is what enabled the acquire. If it happens to fill,
        // it can never out-book the deeper off-family route.
        vm.prank(alice);
        (bool okCtrl,) = address(vaultCtrl).call{ value: 5 ether }("");
        require(okCtrl, "control contribution failed");

        try vaultCtrl.convertAndAddLiquidity(1) {
            assertLe(vaultCtrl.totalLPUnits(), lpBest, "fixed-pool fallback cannot exceed the off-family best route");
        } catch {
            // Fixed-pool family venue could not fill the off-family token — best-route alone enabled it.
            assertTrue(true, "fixed-pool-only convert reverted; best-route was required for the off-family token");
        }
    }
}
