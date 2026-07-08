// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { SafeOwnableUUPS } from "../../src/shared/SafeOwnableUUPS.sol";
import { MockSafeOwnableUUPS } from "../mocks/MockSafeOwnableUUPS.sol";

/**
 * @title SafeOwnableUUPSTest
 * @notice Characterization tests for SafeOwnableUUPS — the ownership-safety base inherited by
 *         MasterRegistryV1, ProtocolTreasuryV1, and the core registries. Asserts single-step
 *         ownership transfer/renounce are disabled and the two-step handover flow works.
 */
contract SafeOwnableUUPSTest is Test {
    MockSafeOwnableUUPS public target;

    address public owner = address(0xA11CE);
    address public pendingOwner = address(0xB0B);

    function setUp() public {
        target = new MockSafeOwnableUUPS(owner);
    }

    function test_transferOwnership_revertsWithUseRequestOwnershipHandover() public {
        vm.prank(owner);
        vm.expectRevert(SafeOwnableUUPS.UseRequestOwnershipHandover.selector);
        target.transferOwnership(pendingOwner);
    }

    function test_renounceOwnership_revertsWithRenounceDisabled() public {
        vm.prank(owner);
        vm.expectRevert(SafeOwnableUUPS.RenounceDisabled.selector);
        target.renounceOwnership();
    }

    function test_ownershipHandover_twoStepFlowSucceeds() public {
        assertEq(target.owner(), owner);

        vm.prank(pendingOwner);
        target.requestOwnershipHandover();

        vm.prank(owner);
        target.completeOwnershipHandover(pendingOwner);

        assertEq(target.owner(), pendingOwner);
    }
}
