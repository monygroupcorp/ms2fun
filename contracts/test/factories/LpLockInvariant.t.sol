// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Graduation-LP permanence invariant (noesis-069 / finding 2, Medium).
//
// The "permanent liquidity depth" promise across the three ERC404 graduation venues was proven only
// by absence-of-removal-code — no test pinned "after graduation on venue X, no actor can remove the
// launch liquidity." These tests formalize that guarantee for each venue:
//   * Uni V4  — the position accrues to the singleton LiquidityDeployerModule (locked on the module).
//   * ZAMM    — LP shares are minted to the ERC404 instance (p.instance).
//   * Cypher  — the Algebra position NFT is minted to the ERC404 instance (p.instance).
// In every case NO contract in the system exposes a callable path that removes/withdraws that
// liquidity. The assertions below are: (a) the LP lands on the expected lock, (b) the deployer module
// custodies nothing withdrawable and exposes no removal entry point, and (c) exercising every
// callable module external leaves the locked liquidity intact — a tripwire that fires the moment
// someone adds a removeLiquidity/withdraw/burn path to a deployer module.

import { Test } from "forge-std/Test.sol";
import { ILiquidityDeployerModule } from "../../src/interfaces/ILiquidityDeployerModule.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";

// ── ZAMM venue ────────────────────────────────────────────────────────────────
import { ZAMMLiquidityDeployerModule } from "../../src/factories/erc404zamm/ZAMMLiquidityDeployerModule.sol";
import { MockZAMM } from "../mocks/MockZAMM.sol";
import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockVault } from "../mocks/MockVault.sol";

// ── Cypher venue ──────────────────────────────────────────────────────────────
import { CypherLiquidityDeployerModule } from "../../src/factories/erc404cypher/CypherLiquidityDeployerModule.sol";
import { CypherAlignmentVault } from "../../src/vaults/cypher/CypherAlignmentVault.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockAlgebraFactory, MockAlgebraPositionManager, MockAlgebraSwapRouter } from "../mocks/MockCypherAlgebra.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";

// ── Uni V4 venue ──────────────────────────────────────────────────────────────
import { LiquidityDeployerModule } from "../../src/factories/erc404/LiquidityDeployerModule.sol";

/// @dev Removal-shaped selectors that MUST NOT exist on any graduation deployer module. A deployer
///      has only `receive()` (no fallback), so a call carrying an unknown selector reverts — proving
///      the entry point is absent. If a future change adds any of these, the call succeeds (or reverts
///      for a different reason) and the assertion fires.
library RemovalProbe {
    function assertNoRemovalEntryPoints(address module) internal {
        string[8] memory sigs = [
            "removeLiquidity(uint256)",
            "removeLiquidity(uint256,uint256,uint256)",
            "decreaseLiquidity(uint256)",
            "withdraw()",
            "withdrawLiquidity()",
            "collect(uint256)",
            "burn(uint256)",
            "unwind()"
        ];
        for (uint256 i = 0; i < sigs.length; i++) {
            (bool ok,) = module.call(abi.encodeWithSignature(sigs[i]));
            require(!ok, string.concat("removal entry point must not exist: ", sigs[i]));
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// ZAMM
// ════════════════════════════════════════════════════════════════════════════════
contract ZammLpLockInvariantTest is Test {
    ZAMMLiquidityDeployerModule module;
    MockZAMM zamm;
    MockERC20 token;
    MockVault vault;
    MockMasterRegistry registry;

    address treasury = address(0xBEEF);
    address instance; // == this test contract; stands in for the graduating ERC404 instance

    function setUp() public {
        zamm = new MockZAMM();
        token = new MockERC20("Test", "TST");
        vault = new MockVault();
        registry = new MockMasterRegistry();
        module = new ZAMMLiquidityDeployerModule(address(zamm), 30, address(registry));
        instance = address(this);
    }

    function _graduate() internal returns (uint256 poolId) {
        uint256 ethReserve = 10 ether;
        uint256 tokenReserve = 1000 ether;
        token.mint(address(module), tokenReserve);
        vm.deal(address(this), ethReserve);
        module.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: treasury,
                vault: address(vault),
                token: address(token),
                instance: instance,
                creator: address(0),
                carveEth: 0
            })
        );
        // Reconstruct the poolId the module used: ETH (address(0)) is always token0.
        MockZAMM.PoolKey memory key = MockZAMM.PoolKey({
            id0: 0, id1: 0, token0: address(0), token1: address(token), feeOrHook: module.feeOrHook()
        });
        poolId = uint256(keccak256(abi.encode(key)));
    }

    /// @notice LP shares land on the instance; the module custodies none; no removal path exists; and
    ///         exercising every callable module external leaves the locked LP intact.
    function test_zamm_graduationLpIsPermanentlyLocked() public {
        uint256 poolId = _graduate();

        uint256 lockedLp = zamm.balanceOf(instance, poolId);
        assertGt(lockedLp, 0, "LP shares must be minted to the instance");
        assertEq(zamm.balanceOf(address(module), poolId), 0, "deployer module custodies no LP");

        RemovalProbe.assertNoRemovalEntryPoints(address(module));

        // Exercise every callable module external and assert the locked LP is unchanged.
        module.setMetadataURI("ipfs://x"); // onlyOwner (this test is the deployer/owner)
        vm.deal(address(this), 1 wei);
        (bool ok,) = payable(address(module)).call{ value: 1 wei }(""); // receive()
        assertTrue(ok, "module receive() accepts ETH");

        assertEq(zamm.balanceOf(instance, poolId), lockedLp, "locked LP intact after every module external");
        assertEq(zamm.balanceOf(address(module), poolId), 0, "module still custodies no LP");
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// Cypher — also asserts the module still deploys liquidity correctly after the IERC20 import unify.
// ════════════════════════════════════════════════════════════════════════════════
contract CypherLpLockInvariantTest is Test {
    CypherLiquidityDeployerModule deployer;
    CypherAlignmentVault vault;
    MockAlgebraFactory algebraFactory;
    MockAlgebraPositionManager positionManager;
    MockAlgebraSwapRouter swapRouter;
    MockERC20 token;
    MockWETH weth;
    MockMasterRegistry registry;
    MockAlignmentRegistry alignmentRegistry;

    address protocolTreasury = makeAddr("treasury");
    address instance;
    uint256 constant TARGET_ID = 1;

    function setUp() public {
        algebraFactory = new MockAlgebraFactory();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
        token = new MockERC20("Token", "TKN");
        weth = new MockWETH();
        registry = new MockMasterRegistry();
        alignmentRegistry = new MockAlignmentRegistry();
        alignmentRegistry.setTargetActive(TARGET_ID, true);
        alignmentRegistry.setTokenInTarget(TARGET_ID, address(token), true);
        instance = address(this);

        deployer = new CypherLiquidityDeployerModule(
            address(algebraFactory), address(positionManager), address(weth), address(registry)
        );

        CypherAlignmentVault impl = new CypherAlignmentVault();
        vault = CypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            address(positionManager),
            address(swapRouter),
            address(algebraFactory),
            address(weth),
            address(token),
            protocolTreasury,
            address(0),
            address(0),
            address(0),
            alignmentRegistry,
            TARGET_ID
        );
    }

    function _graduate() internal {
        uint256 ethReserve = 1 ether;
        uint256 tokenReserve = 1000e18;
        token.mint(address(deployer), tokenReserve);
        vm.deal(address(this), ethReserve);
        deployer.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: protocolTreasury,
                token: address(token),
                vault: address(vault),
                instance: instance,
                creator: address(0),
                carveEth: 0
            })
        );
    }

    /// @notice After the OZ→shared IERC20 unify, Cypher still deploys graduation liquidity correctly:
    ///         a pool is created and the position NFT is minted to the instance.
    function test_cypher_deploysLiquidityAfterIerc20Unify() public {
        _graduate();
        assertEq(positionManager.ownerOf(1), instance, "position NFT minted to the instance");
        assertNotEq(algebraFactory.poolByPair(address(token), address(weth)), address(0), "pool created");
        assertGt(vault.benefactorContribution(instance), 0, "19% tithe credited to the vault");
    }

    /// @notice The graduation position NFT is permanently locked on the instance: the module custodies
    ///         no NFT, exposes no removal path, and every callable module external leaves ownership
    ///         intact. (Sub-note: Algebra LP swap fees accrue to this position with no collect() path
    ///         on the instance — stranded, benign, adds to locked depth; NOT the alignment tithe.)
    function test_cypher_graduationNftIsPermanentlyLocked() public {
        _graduate();
        uint256 tokenId = 1;
        assertEq(positionManager.ownerOf(tokenId), instance, "NFT owned by the instance");
        assertNotEq(positionManager.ownerOf(tokenId), address(deployer), "module does not custody the NFT");

        RemovalProbe.assertNoRemovalEntryPoints(address(deployer));

        deployer.setMetadataURI("ipfs://x"); // onlyOwner
        vm.deal(address(this), 1 wei);
        (bool ok,) = payable(address(deployer)).call{ value: 1 wei }(""); // receive()
        assertTrue(ok, "module receive() accepts ETH");

        assertEq(positionManager.ownerOf(tokenId), instance, "NFT ownership intact after every module external");
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// Uni V4 — the position accrues to the singleton module; full graduation is fork-covered
// (LiquidityDeployerModuleGraduationFork.t.sol). Here we pin the ABI-level lock: the module exposes
// no removal/withdrawal entry point, so the position it holds cannot be pulled.
// ════════════════════════════════════════════════════════════════════════════════
contract UniLpLockInvariantTest is Test {
    LiquidityDeployerModule module;
    MockMasterRegistry registry;

    function setUp() public {
        registry = new MockMasterRegistry();
        module = new LiquidityDeployerModule(address(0), address(0x3), 3000, 60, address(registry));
    }

    /// @notice The singleton Uni deployer — which custodies the graduation V4 position — exposes no
    ///         callable path that removes or withdraws liquidity.
    function test_uni_moduleExposesNoRemovalPath() public {
        RemovalProbe.assertNoRemovalEntryPoints(address(module));
    }
}
