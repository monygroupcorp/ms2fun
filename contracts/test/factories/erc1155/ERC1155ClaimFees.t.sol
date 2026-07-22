// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import {
    ERC1155Instance,
    InsufficientBalance,
    NoFeesToClaim
} from "../../../src/factories/erc1155/ERC1155Instance.sol";

// ── Mocks ────────────────────────────────────────────────────────────────────

/// @dev Minimal registry exposing only getInstanceVaults (the sole method claimAllFees calls).
///      Passed to the instance as its masterRegistry; the constructor merely stores the address.
contract MockVaultListRegistry {
    address[] internal _vaults;

    function setVaults(address[] memory v) external {
        _vaults = v;
    }

    function getInstanceVaults(address) external view returns (address[] memory) {
        return _vaults;
    }
}

/// @dev A vault that pays the benefactor by PUSHING ETH (mirrors the real vaults'
///      payable(recipient).call{value}("") payment model). The push only lands if the
///      instance has a receive().
contract MockPayingVault {
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

    // fund via vm.deal; receive not needed, but harmless
    receive() external payable { }
}

/// @dev A vault that intentionally reverts on claimFees (e.g. AlignmentEndowmentVault's
///      NotSupported()). In a naive loop this bricks fee delivery for every other vault.
contract MockRevertingVault {
    error NotSupported();

    function claimFees() external pure returns (uint256) {
        revert NotSupported();
    }
}

// ── Tests ────────────────────────────────────────────────────────────────────

contract ERC1155ClaimFeesTest is Test {
    address internal creator = address(0xC0FFEE);
    address internal factory = address(0xFAC7);
    address internal gmr = address(0xDEAD); // globalMessageRegistry (must be non-zero)

    MockVaultListRegistry internal registry;

    /// @dev Deploy an instance directly with a chosen active vault and our mock registry.
    function _deploy(address activeVault) internal returns (ERC1155Instance inst) {
        registry = new MockVaultListRegistry();
        ERC1155Instance.InstanceInit memory init = ERC1155Instance.InstanceInit({
            globalMessageRegistry: gmr,
            protocolTreasury: address(0),
            masterRegistry: address(registry),
            gatingModule: address(0),
            dynamicPricingModule: address(0),
            weth: address(0)
        });
        inst = new ERC1155Instance("FeeTest", creator, factory, activeVault, "", init, false);
    }

    // ── claimVaultFees (single-vault path) ────────────────────────────────────

    /// @dev The instance now has a receive(), so a vault pushing fees lands and is forwarded to owner.
    function test_claimVaultFees_receivesAndForwardsToOwner() public {
        MockPayingVault vault = new MockPayingVault();
        ERC1155Instance inst = _deploy(address(vault));

        uint256 fee = 1 ether;
        vm.deal(address(vault), fee);
        vault.setPayout(fee);

        uint256 ownerBefore = creator.balance;

        vm.prank(creator);
        uint256 claimed = inst.claimVaultFees();

        assertEq(claimed, fee, "claimed amount = pushed fee (measured by balance-delta)");
        assertEq(creator.balance - ownerBefore, fee, "fee forwarded to owner");
        assertEq(address(inst).balance, 0, "instance retains nothing");
    }

    /// @dev With nothing pushed, the single-vault path still reverts NoFeesToClaim.
    function test_claimVaultFees_revertsWhenNothingClaimed() public {
        MockPayingVault vault = new MockPayingVault();
        ERC1155Instance inst = _deploy(address(vault));

        vm.prank(creator);
        vm.expectRevert(NoFeesToClaim.selector);
        inst.claimVaultFees();
    }

    // ── claimAllFees (loop path) ──────────────────────────────────────────────

    /// @dev Fund path recovered: paying vaults in the list forward their total to the owner.
    function test_claimAllFees_forwardsAggregateToOwner() public {
        MockPayingVault v1 = new MockPayingVault();
        MockPayingVault v2 = new MockPayingVault();
        ERC1155Instance inst = _deploy(address(v1));

        vm.deal(address(v1), 1 ether);
        v1.setPayout(1 ether);
        vm.deal(address(v2), 2 ether);
        v2.setPayout(2 ether);

        address[] memory list = new address[](2);
        list[0] = address(v1);
        list[1] = address(v2);
        registry.setVaults(list);

        uint256 ownerBefore = creator.balance;

        vm.prank(creator);
        inst.claimAllFees();

        assertEq(creator.balance - ownerBefore, 3 ether, "aggregate of both vaults forwarded to owner");
        assertEq(address(inst).balance, 0, "instance retains nothing");
    }

    /// @dev A reverting vault in the list does NOT brick the claim: the healthy vaults still pay out.
    function test_claimAllFees_revertingVaultDoesNotBrickLoop() public {
        MockPayingVault v1 = new MockPayingVault();
        MockRevertingVault bad = new MockRevertingVault();
        MockPayingVault v2 = new MockPayingVault();
        ERC1155Instance inst = _deploy(address(v1));

        vm.deal(address(v1), 1 ether);
        v1.setPayout(1 ether);
        vm.deal(address(v2), 4 ether);
        v2.setPayout(4 ether);

        address[] memory list = new address[](3);
        list[0] = address(v1);
        list[1] = address(bad); // reverts NotSupported() — must be skipped
        list[2] = address(v2);
        registry.setVaults(list);

        uint256 ownerBefore = creator.balance;

        vm.prank(creator);
        inst.claimAllFees(); // must not revert

        assertEq(creator.balance - ownerBefore, 5 ether, "healthy vaults still pay out despite the reverter");
    }

    // ── Force-feed containment ────────────────────────────────────────────────

    /// @dev receive() accepts a direct ETH push, but that force-fed ETH cannot inflate withdraw():
    ///      withdraw is capped at totalProceeds - totalWithdrawn (mint proceeds only), which is 0 here.
    function test_forceFed_ETH_cannotInflateWithdraw() public {
        MockPayingVault vault = new MockPayingVault();
        ERC1155Instance inst = _deploy(address(vault));

        // Force-feed 5 ETH directly through receive().
        vm.deal(address(this), 5 ether);
        (bool ok,) = address(inst).call{ value: 5 ether }("");
        assertTrue(ok, "receive() accepts the direct ETH push");
        assertEq(address(inst).balance, 5 ether, "force-fed ETH is held by the instance");

        // totalProceeds == 0 (no mints), so no amount is withdrawable — the force-feed is contained.
        vm.prank(creator);
        vm.expectRevert(InsufficientBalance.selector);
        inst.withdraw(5 ether);

        vm.prank(creator);
        vm.expectRevert(InsufficientBalance.selector);
        inst.withdraw(1 wei);
    }
}
