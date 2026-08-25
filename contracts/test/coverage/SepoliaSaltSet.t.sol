// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { SepoliaSalts } from "../../script/SepoliaSalts.sol";
import { DeploySepolia } from "../../script/DeploySepolia.s.sol";
import { CREATEX, ICreateX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

/// @notice noesis-411. The Sepolia salt set is six hand-pasted 32-byte literals produced by an
///         out-of-tree miner, and a wrong one is not visible by reading it: an address is three
///         keccaks away from the salt, and the failure mode of a spent or malformed salt is a
///         revert partway through a broadcast rather than a compile error.
///
///         These tests re-derive the set from the constants and assert the four properties the
///         deploy actually depends on:
///
///           1. every salt carries `SepoliaSalts.DEPLOYER` in bytes 0..19 — CreateX's
///              permissioned-deploy guard, without which the deploy reverts `InvalidSalt`;
///           2. every salt has the cross-chain redeploy-protection flag OFF at byte 20 — the form
///              the address derivation below assumes, and the form CreateX will apply;
///           3. every derived address carries `ADDRESS_ZERO_PREFIX_BYTES` leading zero bytes;
///           4. the six salts are distinct, so no two proxies collide with each other.
///
///         Vacuity check (vacuity-check): zero any one of the six constants and case 1 fails
///         on the deployer field; corrupt a single entropy byte and case 3 fails on the prefix.
contract SepoliaSaltSetTest is Test {
    bytes32[6] internal salts;

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        salts = [
            SepoliaSalts.MASTER_REGISTRY,
            SepoliaSalts.TREASURY,
            SepoliaSalts.QUEUE_MANAGER,
            SepoliaSalts.GLOBAL_MSG_REG,
            SepoliaSalts.ALIGNMENT_REG,
            SepoliaSalts.COMPONENT_REG
        ];
    }

    /// @dev The permissioned-deploy guard. CreateX compares bytes 0..19 of the salt against
    ///      `msg.sender` and reverts `InvalidSalt` on a mismatch, so a set bound to a different
    ///      deployer cannot be broadcast at all.
    function test_everySaltIsBoundToTheDeployer() public view {
        for (uint256 i = 0; i < salts.length; i++) {
            assertEq(address(bytes20(salts[i])), SepoliaSalts.DEPLOYER, "salt is not bound to SepoliaSalts.DEPLOYER");
        }
    }

    /// @dev Byte 20 selects the guard formula. `0x01` mixes `block.chainid` in and moves every
    ///      derived address; `0x00` is the form the documented derivation and the miner use.
    function test_everySaltHasCrossChainProtectionOff() public view {
        for (uint256 i = 0; i < salts.length; i++) {
            assertEq(uint8(salts[i][20]), 0, "salt byte 20 is not the redeploy-protection-off flag");
        }
    }

    /// @dev The cosmetic property the set is mined for, asserted against the address CreateX itself
    ///      computes rather than against the comment beside the constant.
    function test_everySaltMinesTheDeclaredZeroPrefix() public view {
        uint256 want = SepoliaSalts.ADDRESS_ZERO_PREFIX_BYTES;
        for (uint256 i = 0; i < salts.length; i++) {
            address derived = _create3Address(salts[i]);
            bytes20 b = bytes20(derived);
            for (uint256 j = 0; j < want; j++) {
                assertEq(uint8(b[j]), 0, "derived address is short of the declared zero-byte prefix");
            }
        }
    }

    function test_saltsAreDistinct() public view {
        for (uint256 i = 0; i < salts.length; i++) {
            assertTrue(salts[i] != bytes32(0), "salt is unset");
            for (uint256 j = i + 1; j < salts.length; j++) {
                assertTrue(salts[i] != salts[j], "two proxies share a salt");
            }
        }
    }

    /// @notice The sender guard on the deploy script itself: a broadcast from any address other
    ///         than the one the salts are bound to stops in simulation with a readable message,
    ///         instead of reverting inside CreateX after the first transaction is already sent.
    function test_deployRefusesAForeignSender() public {
        DeploySepolia script = new DeploySepolia();
        vm.prank(address(0xBAD));
        vm.expectRevert(
            bytes("DeploySepolia: sender is not the deployer the salt set is bound to (see script/SepoliaSalts.sol)")
        );
        script.run();
    }

    /// @dev The address CreateX will produce for `salt` when `SepoliaSalts.DEPLOYER` broadcasts:
    ///      guard the salt exactly as CreateX does for the permissioned / protection-off case, then
    ///      ask the (etched) CreateX for the CREATE3 address of the guarded salt.
    function _create3Address(bytes32 salt) internal view returns (address) {
        bytes32 guarded = keccak256(abi.encodePacked(uint256(uint160(SepoliaSalts.DEPLOYER)), salt));
        return ICreateX(CREATEX).computeCreate3Address(guarded, CREATEX);
    }
}
