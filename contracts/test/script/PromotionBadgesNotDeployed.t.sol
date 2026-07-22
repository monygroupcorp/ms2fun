// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { VmSafe } from "forge-std/Vm.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

/**
 * @title PromotionBadgesNotDeployed
 * @notice Un-deployed guard for noesis-074. `src/promotion/PromotionBadges.sol` is PARKED pre-testnet:
 *         its open `purchaseBadge` lets anyone self-assign a `VERIFIED` badge (an unresolved trust
 *         hole). Until rth signs off on the trust-architecture fix, it must NEVER be part of the
 *         deployed set. This test runs the canonical DeployCore path with state-diff recording and
 *         asserts no CREATE produced PromotionBadges runtime bytecode — so a future deploy edit that
 *         wires it in (`new PromotionBadges(...)`) trips this gate.
 *
 *         Compile-safe by design: the parked contract is referenced only by artifact path string via
 *         `vm.getDeployedCode`, never imported — the guard keeps compiling even if the contract moves
 *         or is deleted. PromotionBadges carries no immutables, so its runtime bytecode is
 *         deterministic and an exact keccak256 match is reliable.
 */
contract PromotionBadgesNotDeployedTest is Test {
    address constant STUB_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(STUB_LINK, RETURN_TRUE);
    }

    function test_promotionBadgesNeverDeployed() public {
        // Load the parked contract's runtime bytecode by artifact path (no import → compile-safe).
        bytes memory badgeCode = vm.getDeployedCode("PromotionBadges.sol:PromotionBadges");
        assertGt(badgeCode.length, 0, "artifact resolution failed - guard would be vacuous");
        bytes32 badgeHash = keccak256(badgeCode);

        DeployCore s = new DeployCore();

        vm.startStateDiffRecording();
        s.deploy(address(s), _testConfig());
        VmSafe.AccountAccess[] memory accesses = vm.stopAndReturnStateDiff();

        for (uint256 i = 0; i < accesses.length; i++) {
            if (accesses[i].kind == VmSafe.AccountAccessKind.Create) {
                assertTrue(
                    keccak256(accesses[i].deployedCode) != badgeHash,
                    "PromotionBadges is PARKED and must not be deployed - remove it from the deploy path (noesis-074)"
                );
            }
        }
    }

    // Minimal but complete NetworkConfig — mirrors DeployCoreTest. Single unguarded-salt path so any
    // caller can drive CreateX; no file I/O.
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
}
