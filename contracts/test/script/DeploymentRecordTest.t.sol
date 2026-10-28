// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

/// @notice The deployment record is the only published account of what a deploy produced, and an
///         address it omits is an address nobody downstream can name. `MigrateOwnership` is the
///         downstream that matters here: it takes every contract it migrates from the environment,
///         and the operator fills that environment from this file. A contract `DeployCore` creates
///         and this file does not carry is therefore not merely undocumented — it is unmigratable
///         without reading the broadcast logs by hand.
///
/// @dev Writes the record to a real path, because `_writeDeploymentJson` only runs when
///      `cfg.jsonOutputPath` is set and the thing under test is the file it produces. Every other
///      DeployCore test sets the path empty and so never exercises this function at all.
contract DeploymentRecordTest is Test {
    address constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address constant STUB_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    /// @dev Under `deployments/`, the one directory `foundry.toml` grants write access, and prefixed
    ///      so it cannot collide with a real network record. Removed at the end of each test.
    string constant RECORD_PATH = "./deployments/test-deployment-record.json";

    DeployCore s;
    string record;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(STETH, RETURN_TRUE);
        vm.etch(WSTETH, RETURN_TRUE);
        vm.etch(STUB_LINK, RETURN_TRUE);

        s = new DeployCore();
        s.deploy(address(s), _testConfig());

        record = vm.readFile(RECORD_PATH);
        vm.removeFile(RECORD_PATH);
    }

    /// @notice The clause. This config sets `v4PoolManager` and `weth`, so `DeployCore` builds the
    ///         Uni-V4 swap-tithe hook factory, and the record must say where it is. The factory
    ///         stamps an owner into every graduation hook it deploys, and `MigrateOwnership` moves
    ///         that stamp by reading `UNI_TITHE_HOOK_FACTORY` — an address the operator can only get
    ///         from here.
    function test_recordCarriesTheUniTitheHookFactory() public view {
        address inRecord = vm.parseJsonAddress(record, ".contracts.UniTitheHookFactory");
        assertTrue(s.uniTitheHookFactory() != address(0), "this config builds the tithe hook factory");
        assertEq(inRecord, s.uniTitheHookFactory(), "the record names the tithe hook factory DeployCore built");
    }

    /// @notice Guard on the guard ([[vacuity-check]]): the read above must be able to fail. A parse
    ///         that returned zero for every key, or a record whose sibling Uni-rail addresses were
    ///         also missing, would make the assertion meaningless — so the siblings the reviewer can
    ///         already find in the file are pinned alongside it.
    function test_recordCarriesTheUniRailSiblings() public view {
        assertEq(vm.parseJsonAddress(record, ".contracts.zRouter"), address(s.zrouter()), "zRouter");
        assertEq(
            vm.parseJsonAddress(record, ".contracts.ModuleUniV4Deployer"),
            s.moduleUniV4Deployer(),
            "ModuleUniV4Deployer"
        );
        assertEq(vm.parseJsonAddress(record, ".factories.UNI"), address(s.uniVaultFactory()), "factories.UNI");
        assertEq(
            vm.parseJsonAddress(record, ".contracts.AlignmentHookSwapRouter"),
            s.alignmentHookSwapRouter(),
            "AlignmentHookSwapRouter"
        );
    }

    /// @notice The clone implementations are what a block explorer needs to resolve a collection's
    ///         surface, so each must be in the record and name the contract `DeployCore` built.
    function test_recordCarriesTheCloneImplementations() public view {
        assertTrue(address(s.erc404Impl()) != address(0), "this config builds the ERC-404 implementation");
        assertEq(
            vm.parseJsonAddress(record, ".contracts.ERC404BondingInstance"),
            address(s.erc404Impl()),
            "ERC404BondingInstance"
        );
        assertEq(vm.parseJsonAddress(record, ".contracts.ERC1155Instance"), address(s.erc1155Impl()), "ERC1155Instance");
    }

    /// @notice The record's shape. Pins every key at every level, exactly, so a key that silently stops
    ///         being written is red here instead of surfacing at verification time — and so is one
    ///         added without being declared. Adding a key to `_writeDeploymentJson` means adding it here.
    function test_recordKeySetIsExactlyTheDeclaredShape() public view {
        string[] memory root = new string[](7);
        root[0] = "chainId";
        root[1] = "deployer";
        root[2] = "contracts";
        root[3] = "factories";
        root[4] = "uniswap";
        root[5] = "instances";
        root[6] = "vaults";
        _assertKeys(".", root, "root");

        string[] memory contracts_ = new string[](31);
        contracts_[0] = "MasterRegistry";
        contracts_[1] = "ProtocolTreasury";
        contracts_[2] = "FeaturedQueueManager";
        contracts_[3] = "GlobalMessageRegistry";
        contracts_[4] = "AlignmentRegistry";
        contracts_[5] = "ComponentRegistry";
        contracts_[6] = "ProfileRegistry";
        contracts_[7] = "CurationRegistry";
        contracts_[8] = "AlignmentTargetRequestRegistry";
        contracts_[9] = "QueryAggregator";
        contracts_[10] = "zRouter";
        contracts_[11] = "zQuoter";
        contracts_[12] = "LaunchManager";
        contracts_[13] = "CurveParamsComputer";
        contracts_[14] = "ERC1155Instance";
        contracts_[15] = "ERC404BondingInstance";
        contracts_[16] = "DynamicPricingModule";
        contracts_[17] = "ModuleMerkleGating";
        contracts_[18] = "ModuleUniV4Deployer";
        contracts_[19] = "AlignmentHookSwapRouter";
        contracts_[20] = "UniTitheHookFactory";
        contracts_[21] = "ModuleZAMMDeployer";
        contracts_[22] = "ERC404StakingModule";
        contracts_[23] = "MetadataResolverRouter";
        contracts_[24] = "MetadataOverlayModule";
        contracts_[25] = "TokenTierBandResolver";
        contracts_[26] = "DeployBondEscrow";
        contracts_[27] = "SeedUniVault";
        contracts_[28] = "SeedAaveVault";
        contracts_[29] = "SeedZammVault";
        contracts_[30] = "UniswapVaultPriceValidator";
        _assertKeys(".contracts", contracts_, "contracts");

        string[] memory factories = new string[](5);
        factories[0] = "ERC404";
        factories[1] = "ERC1155";
        factories[2] = "ERC721";
        factories[3] = "UNI";
        factories[4] = "AAVE";
        _assertKeys(".factories", factories, "factories");

        string[] memory uniswap = new string[](3);
        uniswap[0] = "v4PoolManager";
        uniswap[1] = "v3Factory";
        uniswap[2] = "v2Factory";
        _assertKeys(".uniswap", uniswap, "uniswap");
    }

    /// @dev Set equality, order-free: same count, and every expected key present. `object` is the
    ///      JSON path of the object.
    function _assertKeys(string memory object, string[] memory expected, string memory label) internal view {
        string[] memory actual = vm.parseJsonKeys(record, object);
        assertEq(actual.length, expected.length, string.concat(label, ": key count"));
        for (uint256 i = 0; i < expected.length; i++) {
            bool found;
            for (uint256 j = 0; j < actual.length; j++) {
                if (keccak256(bytes(actual[j])) == keccak256(bytes(expected[i]))) found = true;
            }
            assertTrue(found, string.concat(label, ": missing key ", expected[i]));
        }
    }

    function _testConfig() internal returns (DeployCore.NetworkConfig memory cfg) {
        DeployCore.AlignmentTargetConfig[] memory targets = new DeployCore.AlignmentTargetConfig[](1);
        targets[0] = DeployCore.AlignmentTargetConfig({
            token: STUB_LINK,
            symbol: "LINK",
            name: "Chainlink",
            description: "Test alignment target",
            deployUniVault: true,
            deployZAMMVault: false,
            communityPayout: address(0)
        });

        cfg.chainId = 1337;
        cfg.weth = STUB_LINK;
        cfg.v4PoolManager = address(1);
        cfg.v3Factory = address(0);
        cfg.v2Factory = address(0);
        cfg.zamm = address(0);
        cfg.zrouter = address(0);
        cfg.safe = address(0);
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
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = RECORD_PATH;
    }
}
