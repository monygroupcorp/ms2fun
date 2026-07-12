// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";
import { IZAMM, ZAMMAlignmentVault } from "../../src/vaults/zamm/ZAMMAlignmentVault.sol";
import { ZAMMAlignmentVaultFactory } from "../../src/vaults/zamm/ZAMMAlignmentVaultFactory.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";

/// @title VaultFlavorsTest
/// @notice Coverage for the vault-flavors promotion (Yield + LP families): all four vault families
///         register per alignment target, self-report the four `vaultType()` discriminators, and gate
///         wizard availability on `isLiquidityReady()` (O2). Also exercises the ZAMM post-init
///         pool-key wiring gap-fill (`setPoolKey` / factory `setVaultPoolKey`).
contract VaultFlavorsTest is Test {
    address constant STUB_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    // Stub external singletons — nonzero so the factories instantiate; vault initializers only STORE
    // these (no calls at deploy), except the Aave path which calls weth.approve(stataToken) — covered
    // by the RETURN_TRUE etch on weth below.
    address constant STUB_ZAMM = address(0xADD0);
    address constant STUB_CYPHER_PM = address(0xADD1);
    address constant STUB_CYPHER_ROUTER = address(0xADD2);
    address constant STUB_STATA = address(0xADD3);
    address constant STUB_CYPHER_FACTORY = address(0xADD4);

    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    DeployCore s;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(STUB_LINK, RETURN_TRUE); // doubles as weth stub — approve() returns true

        s = new DeployCore();
        s.deploy(address(s), _allFamiliesConfig());
    }

    /// @dev One target with ALL FOUR vault families enabled, using nonzero stub externals.
    function _allFamiliesConfig() internal pure returns (DeployCore.NetworkConfig memory cfg) {
        DeployCore.AlignmentTargetConfig[] memory targets = new DeployCore.AlignmentTargetConfig[](1);
        targets[0] = DeployCore.AlignmentTargetConfig({
            token: STUB_LINK,
            symbol: "LINK",
            name: "Chainlink",
            description: "Test alignment target",
            deployUniVault: true,
            deployCypherVault: true,
            deployZAMMVault: true,
            communityPayout: address(0)
        });

        cfg.chainId = 1337;
        cfg.weth = STUB_LINK; // etched RETURN_TRUE — Aave init's approve() succeeds
        cfg.v4PoolManager = address(1);
        cfg.cypherPositionManager = STUB_CYPHER_PM;
        cfg.cypherRouter = STUB_CYPHER_ROUTER;
        cfg.cypherAlgebraFactory = STUB_CYPHER_FACTORY; // O2: Cypher vault needs its Algebra factory wired
        cfg.zamm = STUB_ZAMM;
        cfg.aaveStataToken = STUB_STATA;
        cfg.saltMasterRegistry = bytes32(uint256(1));
        cfg.saltTreasury = bytes32(uint256(2));
        cfg.saltQueueManager = bytes32(uint256(3));
        cfg.saltGlobalMsgReg = bytes32(uint256(4));
        cfg.saltAlignmentReg = bytes32(uint256(5));
        cfg.saltComponentReg = bytes32(uint256(6));
        cfg.priceDeviationBps = 1000;
        cfg.twapSeconds = 1800;
        cfg.zrouterFee = 3000;
        cfg.zrouterTickSpacing = 60;
        cfg.zammFeeOrHook = 100;
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "";
    }

    // ── All four families register per target ────────────────────────────────

    function test_fourVaultFamiliesRegisteredPerTarget() public view {
        uint256 targetId = s.alignmentTargetIds(0);
        _assertRegistered(s.uniVaults(0), targetId);
        _assertRegistered(s.zammVaults(0), targetId);
        _assertRegistered(s.cypherVaults(0), targetId);
        _assertRegistered(s.aaveVaults(0), targetId);
    }

    function _assertRegistered(address vault, uint256 targetId) internal view {
        IMasterRegistry.VaultInfo memory info = MasterRegistryV1(s.masterRegistry()).getVaultInfo(vault);
        assertEq(info.vault, vault, "registered vault");
        assertEq(info.targetId, targetId, "vault target");
        assertTrue(info.active, "vault active");
    }

    // ── vaultType() discriminators ───────────────────────────────────────────

    function test_vaultTypeDiscriminators() public view {
        assertEq(IAlignmentVault(payable(s.uniVaults(0))).vaultType(), "UniswapV4LP");
        assertEq(IAlignmentVault(payable(s.zammVaults(0))).vaultType(), "ZAMMLP");
        assertEq(IAlignmentVault(payable(s.cypherVaults(0))).vaultType(), "CypherLP");
        assertEq(IAlignmentVault(payable(s.aaveVaults(0))).vaultType(), "AaveEndowment");
    }

    // ── isLiquidityReady() — deploy wires each LP family so it's selectable (O2) ─────

    function test_allDeployedVaultsAreLiquidityReady() public view {
        assertTrue(_ready(s.uniVaults(0)), "uni ready");
        assertTrue(_ready(s.zammVaults(0)), "zamm ready");
        assertTrue(_ready(s.cypherVaults(0)), "cypher ready");
        assertTrue(_ready(s.aaveVaults(0)), "aave ready");
    }

    function _ready(address vault) internal view returns (bool ok) {
        (, bytes memory ret) = vault.staticcall(abi.encodeWithSignature("isLiquidityReady()"));
        ok = abi.decode(ret, (bool));
    }

    // ── ZAMM pool-key wiring gap-fill + O2 gate ──────────────────────────────

    /// @dev A ZAMM vault deployed with a ZERO pool key is NOT liquidity-ready (wizard hides it);
    ///      wiring the real ETH/token key via the factory flips it ready. Guards the O2 contract.
    function test_zammPoolKeyWiringGate() public {
        ZAMMAlignmentVaultFactory f = new ZAMMAlignmentVaultFactory(
            STUB_ZAMM,
            address(1),
            address(2),
            IVaultPriceValidator(address(3)),
            IAlignmentRegistry(address(0)),
            address(0)
        );

        IZAMM.PoolKey memory zero; // token1 == address(0) → unwired
        address vault = f.deployVault(bytes32(uint256(0xF1A)), STUB_LINK, 1, zero);

        assertFalse(_ready(vault), "unwired ZAMM must not be liquidity-ready");

        IZAMM.PoolKey memory key =
            IZAMM.PoolKey({ id0: 0, id1: 0, token0: address(0), token1: STUB_LINK, feeOrHook: 100 });
        f.setVaultPoolKey(vault, key);

        assertTrue(_ready(vault), "wired ZAMM must be liquidity-ready");
        assertEq(ZAMMAlignmentVault(payable(vault)).getPoolKey().token1, STUB_LINK, "pool key stored");
    }

    /// @dev Only the factory owner (deployer/protocol) may wire the pool key — a front-runner cannot
    ///      point the vault at a manipulated pool before the real key is set.
    function test_zammSetVaultPoolKeyOnlyOwner() public {
        ZAMMAlignmentVaultFactory f = new ZAMMAlignmentVaultFactory(
            STUB_ZAMM,
            address(1),
            address(2),
            IVaultPriceValidator(address(3)),
            IAlignmentRegistry(address(0)),
            address(0)
        );
        IZAMM.PoolKey memory zero;
        address vault = f.deployVault(bytes32(uint256(0xF1B)), STUB_LINK, 1, zero);

        IZAMM.PoolKey memory key =
            IZAMM.PoolKey({ id0: 0, id1: 0, token0: address(0), token1: STUB_LINK, feeOrHook: 100 });
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        f.setVaultPoolKey(vault, key);
    }
}
