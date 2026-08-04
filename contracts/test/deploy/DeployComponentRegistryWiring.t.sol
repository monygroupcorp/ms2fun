// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { ERC404Factory } from "../../src/factories/erc404/ERC404Factory.sol";
import { MetadataResolverRouter } from "../../src/metadata/MetadataResolverRouter.sol";
import { MetadataOverlayModule } from "../../src/metadata/MetadataOverlayModule.sol";
import { TierRevealModule } from "../../src/metadata/TierRevealModule.sol";
import { FreeMintParams } from "../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../src/gating/IGatingModule.sol";

/// @notice noesis-129 regression guard. `DeployCore` must wire
///         `masterRegistry.setComponentRegistry(componentRegistry)` — without it
///         `MasterRegistryV1.componentRegistry()` stays `address(0)` on every deploy and
///         `MetadataResolverRouter.initResolvers` (the seal, read by every overlay/tier stack) reverts
///         with "call to non-contract address 0x0" because it dereferences the zero pointer. This test
///         runs a full `DeployCore` and proves BOTH: the pointer is set to the deployed registry, and an
///         overlay/tier resolver stack seals end-to-end through the deployed factory with no manual wiring.
contract DeployComponentRegistryWiringTest is Test {
    address constant STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address constant WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address constant STUB_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;

    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    DeployCore s;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(STETH, RETURN_TRUE);
        vm.etch(WSTETH, RETURN_TRUE);
        vm.etch(STUB_LINK, RETURN_TRUE);

        s = new DeployCore();
        s.deploy(address(s), _testConfig());
    }

    // Minimal but complete NetworkConfig — mirrors test/script/DeployTest.t.sol so DeployCore runs
    // exactly as it would on a real deploy (sequential unguarded salts; no file I/O).
    function _testConfig() internal pure returns (DeployCore.NetworkConfig memory cfg) {
        DeployCore.AlignmentTargetConfig[] memory targets = new DeployCore.AlignmentTargetConfig[](1);
        targets[0] = DeployCore.AlignmentTargetConfig({
            token: STUB_LINK,
            symbol: "LINK",
            name: "Chainlink",
            description: "Test alignment target",
            deployUniVault: true,
            deployCypherVault: false,
            deployZAMMVault: false,
            communityPayout: address(0)
        });

        cfg.chainId = 1337;
        cfg.weth = STUB_LINK;
        cfg.v4PoolManager = address(1);
        cfg.v3Factory = address(0);
        cfg.v2Factory = address(0);
        cfg.cypherPositionManager = address(0);
        cfg.cypherRouter = address(0);
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
        cfg.jsonOutputPath = "";
    }

    /// @dev The pointer DeployCore forgot to set (fixed in noesis-129): non-zero AND the deployed registry.
    function test_deployCore_wiresComponentRegistryPointer() public view {
        address wired = address(MasterRegistryV1(s.masterRegistry()).componentRegistry());
        assertTrue(wired != address(0), "componentRegistry pointer must be non-zero after deploy");
        assertEq(wired, address(s.componentRegistry()), "pointer must equal the deployed ComponentRegistry");
    }

    /// @dev End-to-end seal: create a real instance with an [overlay, tier] router stack through the
    ///      DeployCore-deployed factory. The factory's `_wireMetadata` calls
    ///      `MetadataResolverRouter.initResolvers`, which validates each child against
    ///      `masterRegistry.componentRegistry()` — this reverts on a call to `address(0)` when the pointer
    ///      is unset. The create succeeding (children sealed) proves DeployCore wired the pointer, so NO
    ///      manual `registry.setComponentRegistry` is needed (unlike test/metadata/MetadataStackIntegration).
    function test_deployCore_overlayTierStackSealsEndToEnd() public {
        ERC404Factory factory = s.erc404Factory();
        MetadataResolverRouter router = s.metadataResolverRouter();
        MetadataOverlayModule overlay = s.metadataOverlayModule();
        TierRevealModule tier = s.tierRevealModule();

        TierRevealModule.Tier[] memory tiers = new TierRevealModule.Tier[](1);
        tiers[0] = TierRevealModule.Tier({
            idStart: 1,
            idEnd: 2,
            minBalance: 1e24, // positive → passes the T1 minBalance>0 seal check
            baseURI: "rare-",
            lockedURI: "locked-"
        });

        address[] memory children = new address[](2);
        children[0] = address(overlay);
        children[1] = address(tier);

        ERC404Factory.MetadataConfig memory meta = ERC404Factory.MetadataConfig({
            resolver: address(router),
            childResolvers: children,
            overlay: address(overlay),
            tier: address(tier),
            tiers: tiers,
            autoLatest: false,
            defaultPayout: MetadataOverlayModule.Payout.ARTIST
        });

        ERC404Factory.CreateParams memory params = ERC404Factory.CreateParams({
            salt: bytes32(uint256(0xC0FFEE)),
            owner: address(this),
            nftCount: 10,
            presetId: 1, // active preset from DeployCore
            vault: s.uniVaults(0), // registry-validated alignment vault
            name: "prism-deploy",
            symbol: "PRISM",
            styleUri: "",
            tokenBaseURI: "base/",
            stakingModule: address(0),
            declaredMaxAllowanceBps: 0
        });

        // Would revert inside router.initResolvers (call to address(0)) if the pointer were unset.
        address inst = factory.createInstance(
            params,
            "ipfs://collection",
            s.moduleUniV4Deployer(), // approved LIQUIDITY_DEPLOYER
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH }),
            meta
        );

        assertEq(router.resolverCount(inst), 2, "overlay+tier children sealed via DeployCore-wired pointer");
        assertTrue(tier.sealed_(inst), "tier config sealed end-to-end after a plain DeployCore");
    }
}
