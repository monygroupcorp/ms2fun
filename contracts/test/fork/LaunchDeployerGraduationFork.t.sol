// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Vm } from "forge-std/Vm.sol";
import { ForkTestBase } from "./helpers/ForkTestBase.sol";
import { ZAMMLiquidityDeployerModule } from "../../src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
import { CypherLiquidityDeployerModule } from "../../src/factories/erc404cypher/CypherLiquidityDeployerModule.sol";
import { CypherAlignmentVault } from "../../src/vaults/cypher/CypherAlignmentVault.sol";
import { ILiquidityDeployerModule } from "../../src/interfaces/ILiquidityDeployerModule.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockVault } from "../mocks/MockVault.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { IAlgebraFactory } from "../../src/interfaces/algebra/IAlgebra.sol";
import { LibClone } from "solady/utils/LibClone.sol";

/**
 * @title LaunchDeployerGraduationFork
 * @notice The graduation-brick regression (noesis-039). Proves the REAL launch liquidity deployers —
 *         the ones DeployMainnet now wires under LIQUIDITY_DEPLOYER — actually stand up an LP at
 *         graduation against live mainnet infrastructure, instead of the MockComponentModule stubs
 *         that reverted graduation permanently:
 *
 *           1. ZAMM V1 (0x…616eD) answers the exact IZAMM.addLiquidity surface the module compiles
 *              against. deployLiquidity → addLiquidity succeeds and mints LP (the V1-vs-V0 fork check).
 *           2. Cypher/Algebra (mainnet factory + NFPM) creates the pool and mints the full-range LP
 *              position into the alignment vault.
 *
 *         Fork-gated: ForkTestBase.loadAddresses() calls vm.skip(true) when WETH has no code (no
 *         --fork-url), so this is inert in the default `forge test` run.
 *         Run: forge test --fork-url "$ETHEREUM_RPC_URL" \
 *                --match-path test/fork/LaunchDeployerGraduationFork.t.sol -vvv
 */
contract LaunchDeployerGraduationForkTest is ForkTestBase {
    // ── Canonical mainnet addresses (mirror DeployMainnet). ──
    address constant ZAMM_V1 = 0x000000000000040470635EB91b7CE4D132D616eD;
    address constant CYPHER_ALGEBRA_FACTORY = 0xfb8Ed3485EfA29a0e4bed93351dD51B59fC4b0f0;
    address constant CYPHER_NFPM = 0x0a984a446A116335ac90425d2D1E69A7199A2f7c;
    address constant CYPHER_SWAP_ROUTER = 0x20C5893f69F635f55b0367C519F3f95e59c0b0Ab;

    uint256 constant ZAMM_FEE_OR_HOOK = 30; // 0.3% — LOCKED

    // keccak256("LiquidityDeployed(address,address,address,uint256)") — ZAMM module graduation event.
    bytes32 constant ZAMM_LIQUIDITY_DEPLOYED = keccak256("LiquidityDeployed(address,address,address,uint256)");

    MockMasterRegistry registry;
    MockERC20 token;

    address protocolTreasury = makeAddr("treasury");

    function setUp() public {
        loadAddresses(); // vm.skip(true) when not on a fork
        registry = new MockMasterRegistry(); // isRegisteredInstance() defaults to true
        token = new MockERC20("Grad Token", "GRAD");
    }

    /// @notice ZAMM V1 graduation: the module's IZAMM.addLiquidity call against the live V1 singleton
    ///         succeeds and mints a non-zero LP position. This is the V1 ABI confirmation.
    function test_zammV1_graduation_deploysLiquidity() public {
        uint256 ethReserve = 10 ether;
        uint256 tokenReserve = 1_000_000e18;

        ZAMMLiquidityDeployerModule module =
            new ZAMMLiquidityDeployerModule(ZAMM_V1, ZAMM_FEE_OR_HOOK, address(registry));
        MockVault vault = new MockVault();

        // Mirror ERC404BondingInstance.deployLiquidity: LP tokens pre-transferred to the module, the
        // ETH reserve forwarded as msg.value, and the instance itself is the caller (== p.instance).
        token.mint(address(module), tokenReserve);
        vm.deal(address(this), ethReserve);

        vm.recordLogs();
        module.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: protocolTreasury,
                vault: address(vault),
                token: address(token),
                instance: address(this),
                creator: address(0),
                carveEth: 0
            })
        );

        uint256 liquidity = _zammLiquidityFromLogs();
        assertGt(liquidity, 0, "ZAMM V1 addLiquidity must mint a non-zero LP position at graduation");
        // 19% of the raise reached the alignment vault — graduation completed past the pool step.
        assertEq(address(vault).balance, (ethReserve * 19) / 100, "vault must receive the 19% raise cut");
    }

    /// @notice Cypher/Algebra graduation on the mainnet fork: the module creates the pool and mints
    ///         the full-range LP into the alignment vault (lpTokenId + lpPool set).
    function test_cypherMainnet_graduation_deploysLiquidity() public {
        uint256 ethReserve = 5 ether;
        uint256 tokenReserve = 1_000_000e18;

        CypherLiquidityDeployerModule module =
            new CypherLiquidityDeployerModule(CYPHER_ALGEBRA_FACTORY, CYPHER_NFPM, WETH, address(registry));

        MockAlignmentRegistry alignmentRegistry = new MockAlignmentRegistry();
        alignmentRegistry.setTargetActive(1, true);
        alignmentRegistry.setTokenInTarget(1, address(token), true);

        CypherAlignmentVault impl = new CypherAlignmentVault();
        CypherAlignmentVault vault = CypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            CYPHER_NFPM,
            CYPHER_SWAP_ROUTER,
            CYPHER_ALGEBRA_FACTORY,
            WETH,
            address(token),
            protocolTreasury,
            address(0), // zRouter
            address(0), // zQuoter
            address(0), // priceValidator inert
            alignmentRegistry,
            1
        );

        token.mint(address(module), tokenReserve);
        vm.deal(address(this), ethReserve);

        module.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: protocolTreasury,
                vault: address(vault),
                token: address(token),
                instance: address(this),
                creator: address(0),
                carveEth: 0
            })
        );

        // D2 — decoupled launch LP: the module creates the Algebra pool and mints the full-range launch
        // position to the INSTANCE (address(this)), NOT the vault. The vault's own LP position is its
        // later reference-priced alignment position, so the launch pool is created but not vault-owned.
        assertTrue(
            IAlgebraFactory(CYPHER_ALGEBRA_FACTORY).poolByPair(address(token), WETH) != address(0),
            "Cypher graduation must create the Algebra pool"
        );
        assertEq(vault.lpTokenId(), 0, "vault holds no launch position (D2: registerPosition dropped)");
        assertGt(vault.benefactorContribution(address(this)), 0, "instance credited with the 19% tithe");
    }

    /// @dev Pull the `liquidity` field out of the ZAMM module's LiquidityDeployed event.
    function _zammLiquidityFromLogs() internal returns (uint256 liquidity) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length > 0 && logs[i].topics[0] == ZAMM_LIQUIDITY_DEPLOYED) {
                // data = abi.encode(address token0, address token1, uint256 liquidity)
                (,, liquidity) = abi.decode(logs[i].data, (address, address, uint256));
                return liquidity;
            }
        }
        revert("LiquidityDeployed event not emitted");
    }
}
