// test/vaults/CypherAlignmentVaultFactory.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../src/vaults/cypher/CypherAlignmentVaultFactory.sol";
import "../../src/vaults/cypher/CypherAlignmentVault.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract CypherAlignmentVaultFactoryTest is Test {
    CypherAlignmentVaultFactory factory;
    MockAlignmentRegistry registry;
    uint256 internal _saltCounter;

    address positionManager = makeAddr("positionManager");
    address swapRouter = makeAddr("swapRouter");
    address algebraFactory = makeAddr("algebraFactory");
    address zRouter = makeAddr("zRouter");
    address weth = makeAddr("weth");
    address alignmentToken = makeAddr("alignmentToken");
    address treasury = makeAddr("treasury");

    uint256 constant TARGET_ID = 1;

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        registry = new MockAlignmentRegistry();
        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, alignmentToken, true);

        CypherAlignmentVault impl = new CypherAlignmentVault();
        factory = new CypherAlignmentVaultFactory(
            address(impl),
            IVaultPriceValidator(address(0)), // floor mechanics covered in the vault test; deploy test only
            algebraFactory,
            zRouter,
            address(0), // zQuoter
            registry
        );
    }

    function test_createVault_deploysClone() public {
        CypherAlignmentVault vault =
            factory.createVault(_nextSalt(), positionManager, swapRouter, weth, alignmentToken, treasury, TARGET_ID);
        assertNotEq(address(vault), address(0));
        assertEq(vault.alignmentToken(), alignmentToken);
        assertEq(vault.alignmentTargetId(), TARGET_ID);
        assertEq(vault.algebraFactory(), algebraFactory);
        assertEq(vault.zRouter(), zRouter);
        assertEq(address(vault.alignmentRegistry()), address(registry));
        assertEq(vault.protocolYieldCutBps(), 100);
    }

    function test_createVault_multipleVaultsDifferentAddresses() public {
        CypherAlignmentVault v1 =
            factory.createVault(_nextSalt(), positionManager, swapRouter, weth, alignmentToken, treasury, TARGET_ID);
        CypherAlignmentVault v2 =
            factory.createVault(_nextSalt(), positionManager, swapRouter, weth, alignmentToken, treasury, TARGET_ID);
        assertNotEq(address(v1), address(v2));
    }

    /// @dev F6: the deployment salt is bound to the caller — the same salt resolves to a different
    ///      deterministic address per creator, so a front-runner cannot squat the victim's address.
    function test_F6_SaltBoundToCreator_DifferentPerCaller() public view {
        bytes32 salt = bytes32(uint256(0xABCDEF));
        assertTrue(
            factory.computeVaultAddress(address(0xA11CE), salt) != factory.computeVaultAddress(address(0xBAD), salt),
            "same salt must map to different address per creator"
        );
    }
}
