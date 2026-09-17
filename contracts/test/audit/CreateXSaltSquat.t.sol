// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721AuctionFactory } from "../../src/factories/erc721/ERC721AuctionFactory.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { ICreateX, CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

/// @dev Minimal contract to park at the squatted address.
contract Junk {
    uint256 public x = 1;
}

/// @dev A stand-in "vault" so the factory's `code.length` check passes.
contract StubVault {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

/// @notice Audit finding A — the CREATE3 "sender-bound salt" gives per-creator address separation
///         but NOT front-run resistance: CreateX's Random-salt guard has no msg.sender term.
contract CreateXSaltSquatTest is Test {
    ERC721AuctionFactory internal factory;
    MockMasterRegistry internal registry;
    StubVault internal vault;

    address internal victim = address(0xA11CE);
    address internal attacker = address(0xBAD);

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        registry = new MockMasterRegistry();
        vault = new StubVault();
        factory = new ERC721AuctionFactory(address(registry), address(0xB0B), address(0xE7));
        factory.setProtocolTreasury(address(0xFEE));
    }

    function _params(string memory name) internal view returns (ERC721AuctionFactory.CreateParams memory) {
        return ERC721AuctionFactory.CreateParams({
            name: name,
            metadataURI: "ipfs://x",
            creator: victim,
            vault: address(vault),
            symbol: "SYM",
            lines: 1,
            baseDuration: 1 days,
            timeBuffer: 10 minutes,
            bidIncrement: 0.01 ether
        });
    }

    /// @dev Step 0: the guard CreateX actually applies to a "sender-bound" salt is the
    ///      no-protection path keccak256(abi.encode(salt)) — identical for every caller.
    function test_A0_guardHasNoSenderTerm() public {
        bytes32 salt = bytes32(uint256(0x1234));
        bytes32 sbVictim = keccak256(abi.encodePacked(victim, salt));

        bytes32 guarded = keccak256(abi.encode(sbVictim));
        address predicted = ICreateX(CREATEX).computeCreate3Address(guarded, CREATEX);
        assertEq(predicted, factory.computeInstanceAddress(victim, salt), "repo's own preview uses the Random path");

        // The attacker, from a completely different address, deploys to it.
        vm.prank(attacker);
        address squatted = ICreateX(CREATEX).deployCreate3(sbVictim, type(Junk).creationCode);
        assertEq(squatted, predicted, "attacker landed on the victim's CREATE3 address");
    }

    /// @dev Step 1: the squat makes the victim's PERMISSIONLESS createInstance revert.
    function test_A1_squatBricksCreateInstance() public {
        bytes32 salt = bytes32(uint256(0xDEADBEEF));
        address predicted = factory.computeInstanceAddress(victim, salt);

        // Attacker reads (victim, salt) out of the pending tx's public calldata and front-runs.
        vm.prank(attacker);
        address squatted =
            ICreateX(CREATEX).deployCreate3(keccak256(abi.encodePacked(victim, salt)), type(Junk).creationCode);
        assertEq(squatted, predicted, "front-run consumed the victim's address");

        vm.prank(victim);
        vm.expectRevert();
        factory.createInstance(salt, _params("Victim Collection"));
    }

    /// @dev Control: an unmolested createInstance succeeds in this fixture (so A1 fails for the
    ///      right reason).
    function test_A_control_cleanCreateWorks() public {
        vm.prank(victim);
        address inst = factory.createInstance(bytes32(uint256(0x11)), _params("Clean"));
        assertTrue(inst != address(0));
    }

    /// @dev Step 2: recoverability — a fresh salt succeeds, so the block is per-salt, not permanent.
    function test_A2_victimCanRetryWithANewSalt() public {
        bytes32 salt = bytes32(uint256(0xDEADBEEF));
        vm.prank(attacker);
        ICreateX(CREATEX).deployCreate3(keccak256(abi.encodePacked(victim, salt)), type(Junk).creationCode);

        vm.prank(victim);
        vm.expectRevert();
        factory.createInstance(salt, _params("Victim Collection"));

        vm.prank(victim);
        address inst = factory.createInstance(bytes32(uint256(0xFEED)), _params("Victim Collection"));
        assertTrue(inst != address(0), "retry with a fresh salt deploys fine");
    }

    /// @dev Step 3: the squat cost. A minimal CREATE3 squat is cheap and repeatable.
    function test_A3_squatGasCost() public {
        bytes32 salt = bytes32(uint256(0xC0FFEE));
        vm.prank(attacker);
        uint256 g0 = gasleft();
        ICreateX(CREATEX).deployCreate3(keccak256(abi.encodePacked(victim, salt)), type(Junk).creationCode);
        uint256 used = g0 - gasleft();
        emit log_named_uint("gas to squat one CREATE3 address", used);
        assertLt(used, 200_000);
    }

    /// @dev Side finding: ERC404Factory.computeInstanceAddress (src/factories/erc404/ERC404Factory.sol:779)
    ///      uses the PERMISSIONED guard formula while deployCreate3 takes the Random path, so its
    ///      preview disagrees with the address CreateX will actually use.
    function test_A4_erc404PreviewFormulaDisagrees() public {
        address f = address(0xF4C); // stand-in for the ERC404Factory instance
        address creator = address(0xA11CE);
        bytes32 salt = bytes32(uint256(7));
        bytes32 sb = keccak256(abi.encodePacked(creator, salt));

        bytes32 erc404Guard = keccak256(abi.encodePacked(uint256(uint160(f)), sb)); // ERC404Factory.sol:779
        bytes32 siblingGuard = keccak256(abi.encode(sb)); // every other factory + what CreateX applies

        address erc404Preview = ICreateX(CREATEX).computeCreate3Address(erc404Guard, CREATEX);
        address realAddress = ICreateX(CREATEX).deployCreate3(sb, type(Junk).creationCode);

        assertEq(
            realAddress, ICreateX(CREATEX).computeCreate3Address(siblingGuard, CREATEX), "Random guard is the live path"
        );
        assertTrue(erc404Preview != realAddress, "ERC404Factory.computeInstanceAddress previews the WRONG address");
        emit log_named_address("ERC404Factory preview", erc404Preview);
        emit log_named_address("address CreateX actually uses", realAddress);
    }

    /// @dev The fix, demonstrated: give CreateX a salt whose first 20 bytes ARE the caller and whose
    ///      21st byte is 0x00. `_parseSalt` then takes the PERMISSIONED path and guards with
    ///      keccak256(msg.sender, salt), which no third party can reproduce. This is also exactly the
    ///      formula ERC404Factory.computeInstanceAddress already assumes (:779) — evidence the
    ///      permissioned path was the intent and the extra keccak256(sender, salt) defeats it.
    function test_A5_permissionedSaltShapeIsUnsquattable() public {
        // Entropy still per-(creator, salt); only the SHAPE changes.
        bytes32 entropy = keccak256(abi.encodePacked(victim, bytes32(uint256(0xABCD))));
        bytes32 permissionedSalt =
            bytes32(abi.encodePacked(address(this), uint8(0x00), bytes11(bytes32(uint256(entropy) << 168))));

        // The attacker cannot use it at all: CreateX sees bytes20(salt) != attacker, so for them it is
        // a Random salt and resolves to a DIFFERENT address.
        vm.prank(attacker);
        address attackerAddr = ICreateX(CREATEX).deployCreate3(permissionedSalt, type(Junk).creationCode);

        // This contract (the "factory") deploys with the same salt and gets its own, untouched address.
        address ours = ICreateX(CREATEX).deployCreate3(permissionedSalt, type(Junk).creationCode);
        assertTrue(ours != attackerAddr, "permissioned salt: the squat lands somewhere else entirely");
        assertEq(
            ours,
            ICreateX(CREATEX)
                .computeCreate3Address(
                    keccak256(abi.encodePacked(uint256(uint160(address(this))), permissionedSalt)), CREATEX
                ),
            "guard is keccak256(deployer, salt) - exactly ERC404Factory:779's formula"
        );
        emit log_named_address("attacker's address for the same salt", attackerAddr);
        emit log_named_address("factory's address for the same salt", ours);
    }
}
