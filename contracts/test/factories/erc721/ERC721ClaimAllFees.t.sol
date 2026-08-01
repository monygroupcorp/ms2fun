// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC721AuctionInstance } from "../../../src/factories/erc721/ERC721AuctionInstance.sol";

// ── Mocks ────────────────────────────────────────────────────────────────────

/// @dev Minimal registry exposing only getInstanceVaults (the sole method claimAllFees calls).
contract MockVaultListRegistry721 {
    address[] internal _vaults;

    function setVaults(address[] memory v) external {
        _vaults = v;
    }

    function getInstanceVaults(address) external view returns (address[] memory) {
        return _vaults;
    }
}

/// @dev A vault that pays the benefactor by PUSHING ETH (mirrors the real vaults' payment model).
contract MockPayingVault721 {
    uint256 public payout;

    function setPayout(uint256 p) external {
        payout = p;
    }

    function claimFees() external returns (uint256 ethClaimed) {
        ethClaimed = payout;
        payout = 0;
        (bool ok,) = payable(msg.sender).call{ value: ethClaimed }("");
        require(ok, "push failed");
    }

    receive() external payable { }
}

/// @dev A vault that intentionally reverts on claimFees (e.g. AlignmentEndowmentVault's NotSupported()).
///      In a naive loop this bricks fee delivery for every other vault.
contract MockRevertingVault721 {
    error NotSupported();

    function claimFees() external pure returns (uint256) {
        revert NotSupported();
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

contract ERC721ClaimAllFeesTest is Test {
    address internal owner = address(0xC0FFEE);
    address internal treasury = address(0x7EA);
    address internal factory = address(0xFAC7);
    address internal gmr = address(0xDEAD); // globalMessageRegistry (must be non-zero)

    MockVaultListRegistry721 internal registry;

    /// @dev Deploy an instance directly with a chosen genesis vault and our mock registry.
    function _deploy(address genesisVault) internal returns (ERC721AuctionInstance inst) {
        registry = new MockVaultListRegistry721();
        ERC721AuctionInstance.ConstructorParams memory p = ERC721AuctionInstance.ConstructorParams({
            vault: genesisVault,
            protocolTreasury: treasury,
            owner: owner,
            name: "AuctionTest",
            symbol: "AUC",
            metadataURI: "ipfs://meta",
            lines: 1,
            baseDuration: 1 hours,
            timeBuffer: 5 minutes,
            bidIncrement: 0.01 ether,
            globalMessageRegistry: gmr,
            masterRegistry: address(registry),
            factory: factory,
            weth: address(0)
        });
        inst = new ERC721AuctionInstance(p);
    }

    /// @dev Paying vaults in the list forward their aggregate to the owner; nothing stranded.
    function test_claimAllFees_forwardsAggregateToOwner() public {
        MockPayingVault721 v1 = new MockPayingVault721();
        MockPayingVault721 v2 = new MockPayingVault721();
        ERC721AuctionInstance inst = _deploy(address(v1));

        vm.deal(address(v1), 1 ether);
        v1.setPayout(1 ether);
        vm.deal(address(v2), 2 ether);
        v2.setPayout(2 ether);

        address[] memory list = new address[](2);
        list[0] = address(v1);
        list[1] = address(v2);
        registry.setVaults(list);

        uint256 ownerBefore = owner.balance;

        vm.prank(owner);
        inst.claimAllFees();

        assertEq(owner.balance - ownerBefore, 3 ether, "aggregate of both vaults forwarded to owner");
        assertEq(address(inst).balance, 0, "instance retains nothing (no strand)");
    }

    /// @dev A reverting endowment vault in the list must NOT brick the sweep: healthy vaults still pay out,
    ///      and the claimed ETH is forwarded to the owner rather than stranded.
    function test_claimAllFees_revertingVaultDoesNotBrickSweep() public {
        MockPayingVault721 v1 = new MockPayingVault721();
        MockRevertingVault721 bad = new MockRevertingVault721();
        MockPayingVault721 v2 = new MockPayingVault721();
        ERC721AuctionInstance inst = _deploy(address(v1));

        vm.deal(address(v1), 1 ether);
        v1.setPayout(1 ether);
        vm.deal(address(v2), 4 ether);
        v2.setPayout(4 ether);

        address[] memory list = new address[](3);
        list[0] = address(v1);
        list[1] = address(bad); // reverts NotSupported() — must be skipped, not bubble up
        list[2] = address(v2);
        registry.setVaults(list);

        uint256 ownerBefore = owner.balance;

        vm.prank(owner);
        inst.claimAllFees(); // must not revert

        assertEq(owner.balance - ownerBefore, 5 ether, "healthy vaults still pay out despite the reverter");
        assertEq(address(inst).balance, 0, "claimed ETH forwarded, nothing stranded");
    }

    /// @dev Nothing pushed → no forward, no revert (delta == 0).
    function test_claimAllFees_noFeesIsNoop() public {
        MockPayingVault721 v1 = new MockPayingVault721();
        ERC721AuctionInstance inst = _deploy(address(v1));

        address[] memory list = new address[](1);
        list[0] = address(v1);
        registry.setVaults(list);

        uint256 ownerBefore = owner.balance;

        vm.prank(owner);
        inst.claimAllFees();

        assertEq(owner.balance - ownerBefore, 0, "no fees, no forward");
        assertEq(address(inst).balance, 0);
    }

    /// @dev Only the owner may sweep.
    function test_claimAllFees_onlyOwner() public {
        MockPayingVault721 v1 = new MockPayingVault721();
        ERC721AuctionInstance inst = _deploy(address(v1));

        address[] memory list = new address[](1);
        list[0] = address(v1);
        registry.setVaults(list);

        vm.prank(address(0xBAD));
        vm.expectRevert();
        inst.claimAllFees();
    }
}
