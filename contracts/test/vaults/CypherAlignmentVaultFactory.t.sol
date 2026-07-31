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
import { Ownable } from "solady/auth/Ownable.sol";

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
        assertEq(vault.PROTOCOL_CUT_BPS(), 100);
    }

    function test_createVault_multipleVaultsDifferentAddresses() public {
        CypherAlignmentVault v1 =
            factory.createVault(_nextSalt(), positionManager, swapRouter, weth, alignmentToken, treasury, TARGET_ID);
        CypherAlignmentVault v2 =
            factory.createVault(_nextSalt(), positionManager, swapRouter, weth, alignmentToken, treasury, TARGET_ID);
        assertNotEq(address(v1), address(v2));
    }

    /// @dev Governance unbrick: the Cypher factory is now Ownable and its owner is the deployer.
    ///      Pre-fix the factory was not Ownable at all, so the vault's onlyOwner setPriceValidator /
    ///      setMaxPriceDeviationBps (the anti-manipulation levers) were unreachable forever.
    function test_owner_isDeployer() public view {
        assertEq(factory.owner(), address(this));
    }

    function test_setVaultPriceValidator_ownerCanRotate() public {
        CypherAlignmentVault vault =
            factory.createVault(_nextSalt(), positionManager, swapRouter, weth, alignmentToken, treasury, TARGET_ID);
        // Vault owner is the factory; the setter is only reachable via the factory passthrough.
        assertEq(vault.owner(), address(factory));

        address newValidator = makeAddr("rotatedValidator");
        factory.setVaultPriceValidator(address(vault), newValidator);
        assertEq(address(vault.priceValidator()), newValidator);
    }

    function test_setVaultMaxPriceDeviationBps_ownerCanRotate() public {
        CypherAlignmentVault vault =
            factory.createVault(_nextSalt(), positionManager, swapRouter, weth, alignmentToken, treasury, TARGET_ID);
        factory.setVaultMaxPriceDeviationBps(address(vault), 250);
        assertEq(vault.maxPriceDeviationBps(), 250);
    }

    function test_setVaultPriceValidator_nonOwnerReverts() public {
        CypherAlignmentVault vault =
            factory.createVault(_nextSalt(), positionManager, swapRouter, weth, alignmentToken, treasury, TARGET_ID);
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(Ownable.Unauthorized.selector);
        factory.setVaultPriceValidator(address(vault), makeAddr("rotatedValidator"));
    }

    function test_setVaultMaxPriceDeviationBps_nonOwnerReverts() public {
        CypherAlignmentVault vault =
            factory.createVault(_nextSalt(), positionManager, swapRouter, weth, alignmentToken, treasury, TARGET_ID);
        vm.prank(makeAddr("attacker"));
        vm.expectRevert(Ownable.Unauthorized.selector);
        factory.setVaultMaxPriceDeviationBps(address(vault), 250);
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
