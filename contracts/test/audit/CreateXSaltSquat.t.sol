// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721AuctionFactory } from "../../src/factories/erc721/ERC721AuctionFactory.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { CreateXSalt, ICreateX, CREATEX } from "../../src/shared/CreateXConstants.sol";
import { ERC404Factory } from "../../src/factories/erc404/ERC404Factory.sol";
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

/// @notice Audit finding L-1. Hashing the creator INTO the salt gave per-creator address separation
///         but NOT front-run resistance: the digest can never equal the caller, so CreateX fell
///         through to its Random guard, which has no `msg.sender` term at all. The factories now hand
///         CreateX the permissioned salt shape instead — and previewing through the same helper is
///         what keeps `computeInstanceAddress` honest about where the deploy will land.
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
            bidIncrement: 0.01 ether,
            royaltyReceiver: address(0),
            royaltyBps: 0
        });
    }

    /// @dev The salt the factory hands CreateX now takes the PERMISSIONED path, so the guard carries
    ///      a `msg.sender` term only the factory can produce. The attacker deploying the same salt
    ///      lands somewhere else entirely, and the factory's own address is untouched.
    function test_A0_permissionedSaltHasASenderTerm() public {
        bytes32 salt = bytes32(uint256(0x1234));
        address predicted = factory.computeInstanceAddress(victim, salt);
        bytes32 create3Salt = CreateXSalt.permissioned(address(factory), victim, salt);

        assertEq(
            predicted,
            ICreateX(CREATEX).computeCreate3Address(CreateXSalt.guarded(address(factory), create3Salt), CREATEX),
            "preview is the permissioned guard"
        );

        // The attacker replays the exact salt the factory would use. CreateX sees bytes20(salt) is not
        // their address, so for them it is a Random salt and resolves elsewhere.
        vm.prank(attacker);
        address squatted = ICreateX(CREATEX).deployCreate3(create3Salt, type(Junk).creationCode);
        assertTrue(squatted != predicted, "the replay cannot reach the victim's address");
    }

    /// @dev The whole point: a front-run off the pending transaction's public calldata no longer
    ///      bricks the victim's permissionless createInstance.
    function test_A1_frontRunNoLongerBricksCreateInstance() public {
        bytes32 salt = bytes32(uint256(0xDEADBEEF));
        address predicted = factory.computeInstanceAddress(victim, salt);

        // Every salt the attacker can derive from the public calldata, tried in turn.
        vm.startPrank(attacker);
        ICreateX(CREATEX).deployCreate3(keccak256(abi.encodePacked(victim, salt)), type(Junk).creationCode);
        ICreateX(CREATEX)
            .deployCreate3(CreateXSalt.permissioned(address(factory), victim, salt), type(Junk).creationCode);
        vm.stopPrank();

        vm.prank(victim);
        address inst = factory.createInstance(salt, _params("Victim Collection"));
        assertEq(inst, predicted, "the victim still gets the address the preview promised");
    }

    /// @dev Control: an unmolested createInstance succeeds in this fixture (so A1 fails for the
    ///      right reason).
    function test_A_control_cleanCreateWorks() public {
        vm.prank(victim);
        address inst = factory.createInstance(bytes32(uint256(0x11)), _params("Clean"));
        assertTrue(inst != address(0));
    }

    /// @dev Per-creator separation survives the shape change: the creator is folded into the 11 bytes
    ///      of entropy the permissioned shape leaves free, so two creators still get two addresses.
    function test_A2_addressesStayPerCreator() public view {
        bytes32 salt = bytes32(uint256(0xFEED));
        assertTrue(
            factory.computeInstanceAddress(victim, salt) != factory.computeInstanceAddress(attacker, salt),
            "distinct creators, distinct addresses"
        );
        assertTrue(
            factory.computeInstanceAddress(victim, salt) != factory.computeInstanceAddress(victim, bytes32(uint256(1))),
            "distinct salts, distinct addresses"
        );
    }

    /// @dev The preview is the deploy. This is the adjacent real bug L-1 names: ERC404Factory
    ///      previewed with the permissioned guard while its deploy took the Random path, so it
    ///      returned an address CreateX would never use and no test said so.
    function test_A4_previewMatchesWhereTheDeployLands() public {
        ERC404Factory f = new ERC404Factory(
            ERC404Factory.CoreConfig({
                implementation: address(0x1111),
                masterRegistry: address(0x2222),
                protocol: address(0xDA0),
                weth: address(0x3333)
            }),
            ERC404Factory.ModuleConfig({
                globalMessageRegistry: address(0x4444),
                componentRegistry: address(0x5555),
                launchManager: address(0x6666)
            })
        );
        address creator = address(0xA11CE);
        bytes32 salt = bytes32(uint256(7));

        address preview = f.computeInstanceAddress(creator, salt);

        // Stand where the factory stands and take its deploy path with its own salt.
        vm.prank(address(f));
        address landed = ICreateX(CREATEX)
            .deployCreate3(CreateXSalt.permissioned(address(f), creator, salt), type(Junk).creationCode);

        assertEq(preview, landed, "the preview is the address CreateX uses");

        // The formula that used to be live resolves somewhere else — this assertion is what would
        // have caught the drift.
        address oldRandomPath = ICreateX(CREATEX)
            .computeCreate3Address(keccak256(abi.encode(keccak256(abi.encodePacked(creator, salt)))), CREATEX);
        assertTrue(oldRandomPath != preview, "the old Random-path address is not this one");
    }

    /// @dev The sibling factories carry the same shape, previewed through the same helper. Their
    ///      previews were already self-consistent; what changes is that they are now unsquattable too.
    function test_A5_siblingPreviewsAlsoTakeThePermissionedPath() public view {
        address creator = address(0xA11CE);
        bytes32 salt = bytes32(uint256(0xABCD));
        bytes32 create3Salt = CreateXSalt.permissioned(address(factory), creator, salt);

        assertEq(
            factory.computeInstanceAddress(creator, salt),
            ICreateX(CREATEX).computeCreate3Address(CreateXSalt.guarded(address(factory), create3Salt), CREATEX),
            "ERC721AuctionFactory previews the permissioned guard"
        );

        // The shape itself: 20 bytes of deployer, then the 0x00 that selects the path.
        assertEq(address(bytes20(create3Salt)), address(factory), "first 20 bytes are the deployer");
        assertEq(uint8(create3Salt[20]), 0, "21st byte selects the permissioned path");
    }
}
