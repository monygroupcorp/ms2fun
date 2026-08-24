// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC1155Factory } from "../../../src/factories/erc1155/ERC1155Factory.sol";
import { ERC1155Instance } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { FreeMintParams } from "../../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import { ExceedsSupply, FreeMintExhausted } from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { ComponentRegistry } from "../../../src/registry/ComponentRegistry.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { CREATEX } from "../../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";

contract MockVaultERC1155Reserve {
    function supportsCapability(bytes32) external pure returns (bool) {
        return true;
    }
    receive() external payable { }
}

/// @dev Reserve-from-supply on the PAID path (noesis-395). A limited edition's free-mint allocation is a
///      RESERVE carved out of `supply`: paid minting must never consume supply that unclaimed free mints
///      are still owed. The paid `mint` supply gate now withholds `freeMintAllocation - freeMintsClaimed`,
///      clamped at zero because the owner can lower the allocation below the claimed count at any time.
///      Invariant exercised here: at every point `supply - minted >= freeMintAllocation - freeMintsClaimed`,
///      so every promised, unclaimed free claim always has supply behind it.
contract ERC1155FreeMintReserveTest is Test {
    ERC1155Factory factory;
    MockMasterRegistry mockRegistry;
    MockVaultERC1155Reserve mockVault;
    ComponentRegistry componentRegistry;

    uint256 internal _saltCounter;

    address protocol = makeAddr("protocol");
    address creator = makeAddr("creator");
    address buyer = makeAddr("buyer");
    address mockGMR = makeAddr("gmr");

    uint256 constant PRICE = 0.01 ether;

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    function setUp() public {
        vm.startPrank(protocol);
        vm.etch(CREATEX, CREATEX_BYTECODE);
        mockRegistry = new MockMasterRegistry();
        mockVault = new MockVaultERC1155Reserve();

        ComponentRegistry impl = new ComponentRegistry();
        address proxy = LibClone.deployERC1967(address(impl));
        componentRegistry = ComponentRegistry(proxy);
        componentRegistry.initialize(protocol);

        factory = new ERC1155Factory(address(mockRegistry), mockGMR, address(componentRegistry), address(0xBEEF));
        vm.stopPrank();
    }

    function _params() internal view returns (ERC1155Factory.CreateParams memory) {
        return ERC1155Factory.CreateParams({
            name: "ReserveEdition",
            symbol: "",
            metadataURI: "ipfs://meta",
            creator: creator,
            vault: address(mockVault),
            styleUri: "",
            gatingModule: address(0),
            freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
        });
    }

    function _deploy() internal returns (ERC1155Instance) {
        vm.prank(creator);
        return ERC1155Instance(payable(factory.createInstance(_nextSalt(), _params())));
    }

    function _addLimited(ERC1155Instance inst, uint256 supply, uint256 freeAlloc) internal returns (uint256 editionId) {
        vm.prank(creator);
        inst.addEdition(
            "Piece", PRICE, supply, "ipfs://edition", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0, freeAlloc
        );
        return inst.nextEditionId() - 1;
    }

    function _addUnlimited(ERC1155Instance inst, uint256 freeAlloc) internal returns (uint256 editionId) {
        vm.prank(creator);
        inst.addEdition("OpenPiece", PRICE, 0, "ipfs://open", ERC1155Instance.PricingModel.UNLIMITED, 0, 0, freeAlloc);
        return inst.nextEditionId() - 1;
    }

    /// Paid mint of `amount` from a funded buyer.
    function _paidMint(ERC1155Instance inst, uint256 editionId, uint256 amount, address from) internal {
        uint256 cost = inst.calculateMintCost(editionId, amount);
        vm.deal(from, cost);
        vm.prank(from);
        inst.mint{ value: cost }(editionId, amount, "", "", 0);
    }

    function _expectPaidRevertExceedsSupply(ERC1155Instance inst, uint256 editionId, uint256 amount, address from)
        internal
    {
        // Fund generously so the revert is the supply gate, never InsufficientPayment.
        vm.deal(from, PRICE * amount + 1 ether);
        vm.prank(from);
        vm.expectRevert(ExceedsSupply.selector);
        inst.mint{ value: PRICE * amount }(editionId, amount, "", "", 0);
    }

    function _claimer(uint256 i) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked("claimer", i)))));
    }

    // ── the noesis-395 defect regression ───────────────────────────────────────

    /// A paid buyer cannot buy the whole edition out from under the reserve: a paid `mint(id, supply)` on
    /// an edition with a free allocation now reverts `ExceedsSupply`, and every free claim still lands.
    function test_reserve_paidCannotConsumeEntireSupply() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addLimited(inst, 100, 10);

        // The exact attack from the finding: one paid mint of the full supply. Now blocked.
        _expectPaidRevertExceedsSupply(inst, id, 100, buyer);

        // Reserve untouched, and every one of the 10 free claims succeeds.
        assertEq(inst.freeMintsClaimed(id), 0);
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(_claimer(i));
            inst.claimFreeMint(id, "");
            assertEq(inst.balanceOf(_claimer(i), id), 1);
        }
        assertEq(inst.freeMintsClaimed(id), 10);
    }

    /// Paid minting is allowed exactly up to the non-reserved supply, and the reserve stays claimable.
    function test_reserve_paidUpToNonReservedCap_thenFreeClaims() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addLimited(inst, 100, 10);

        // 90 = supply(100) - reserve(10). Fills the paid ceiling in one shot.
        _paidMint(inst, id, 90, buyer);
        assertEq(inst.balanceOf(buyer, id), 90);

        // One more paid unit would eat the reserve → revert.
        _expectPaidRevertExceedsSupply(inst, id, 1, buyer);

        // All 10 reserved claims still land, taking minted to exactly supply.
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(_claimer(i));
            inst.claimFreeMint(id, "");
        }
        assertEq(inst.freeMintsClaimed(id), 10);
        (uint256 supply, uint256 minted) = _supplyMinted(inst, id);
        assertEq(minted, supply);
    }

    /// A free claim consumes its own reserved unit — it does NOT open a paid slot. Claiming increments
    /// `minted` and decrements the reserve by one each, so the non-reserved paid capacity is unchanged
    /// and a paid mint at the cap still reverts. This is the accounting that keeps the reserve tight.
    function test_reserve_freeClaimDoesNotOpenPaidSlot() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addLimited(inst, 100, 10);

        _paidMint(inst, id, 90, buyer); // at the cap; reserve == 10
        _expectPaidRevertExceedsSupply(inst, id, 1, buyer);

        // A free claim takes minted to 91 and the reserve to 9 — non-reserved capacity is still zero.
        vm.prank(_claimer(0));
        inst.claimFreeMint(id, "");
        (uint256 supply, uint256 minted) = _supplyMinted(inst, id);
        assertEq(minted, 91);
        assertEq(supply - minted, inst.freeMintAllocation(id) - inst.freeMintsClaimed(id)); // 9 == 9
        _expectPaidRevertExceedsSupply(inst, id, 1, buyer);
    }

    // ── exact boundary ─────────────────────────────────────────────────────────

    function test_reserve_exactBoundary() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addLimited(inst, 100, 10);

        // supply - reserve = 90: a single paid mint of 90 is accepted, 91 is not.
        _expectPaidRevertExceedsSupply(inst, id, 91, buyer);
        _paidMint(inst, id, 90, buyer);
        assertEq(inst.balanceOf(buyer, id), 90);
    }

    /// Allocation == supply: the whole edition is reserved, no paid unit is sellable, all claims land.
    function test_reserve_fullyReservedEdition() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addLimited(inst, 10, 10);

        _expectPaidRevertExceedsSupply(inst, id, 1, buyer);
        for (uint256 i = 0; i < 10; i++) {
            vm.prank(_claimer(i));
            inst.claimFreeMint(id, "");
        }
        assertEq(inst.freeMintsClaimed(id), 10);
        // Reserve now fully consumed by claims; an 11th claim is exhausted.
        vm.prank(_claimer(10));
        vm.expectRevert(FreeMintExhausted.selector);
        inst.claimFreeMint(id, "");
    }

    /// Zero allocation is a no-op reserve: paid minting can take the entire supply (no regression).
    function test_reserve_noAllocationAllowsFullSupply() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addLimited(inst, 100, 0);

        _paidMint(inst, id, 100, buyer);
        assertEq(inst.balanceOf(buyer, id), 100);
        _expectPaidRevertExceedsSupply(inst, id, 1, buyer);
    }

    // ── owner allocation changes: clamp, no underflow ──────────────────────────

    /// Lowering the allocation below the already-claimed count clamps the reserve to zero — the
    /// subtraction never underflows — and the freed supply becomes paid-mintable.
    function test_reserve_lowerBelowClaimed_clampsNoUnderflow() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addLimited(inst, 20, 10);

        // 8 free claims: claimed == 8, reserve == 2.
        for (uint256 i = 0; i < 8; i++) {
            vm.prank(_claimer(i));
            inst.claimFreeMint(id, "");
        }
        // 10 non-reserved units remain (20 - 8 claimed - 2 reserve). 11 would eat the reserve.
        _expectPaidRevertExceedsSupply(inst, id, 11, buyer);

        // Owner lowers allocation to 3, strictly below the 8 already claimed → reserve clamps to 0.
        vm.prank(creator);
        inst.setEditionFreeMintAllocation(id, 3);

        // All remaining supply (12) is now paid-mintable with no underflow revert.
        _paidMint(inst, id, 12, buyer);
        assertEq(inst.balanceOf(buyer, id), 12);
        (uint256 supply, uint256 minted) = _supplyMinted(inst, id);
        assertEq(minted, supply);
    }

    /// Lower-then-raise: lowering frees paid slots; raising the allocation re-applies the reserve to the
    /// still-unminted supply and re-blocks paid mints that would eat it.
    function test_reserve_lowerThenRaise_regates() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addLimited(inst, 100, 10);

        _paidMint(inst, id, 90, buyer); // at cap, reserve 10
        _expectPaidRevertExceedsSupply(inst, id, 1, buyer);

        // Lower to 5 → reserve 5, opens 5 paid slots.
        vm.prank(creator);
        inst.setEditionFreeMintAllocation(id, 5);
        _paidMint(inst, id, 5, buyer); // 95 minted, reserve 5, at cap
        _expectPaidRevertExceedsSupply(inst, id, 1, buyer);

        // Raise back to 10 → reserve 10 against 5 remaining supply; still no paid unit sellable.
        vm.prank(creator);
        inst.setEditionFreeMintAllocation(id, 10);
        _expectPaidRevertExceedsSupply(inst, id, 1, buyer);

        // The 5 units of remaining supply are claimable by free minters.
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(_claimer(i));
            inst.claimFreeMint(id, "");
        }
        (uint256 supply, uint256 minted) = _supplyMinted(inst, id);
        assertEq(minted, supply);
    }

    // ── UNLIMITED editions are unaffected ──────────────────────────────────────

    /// The reserve gate lives only under the limited-supply branch; an UNLIMITED edition takes any paid
    /// amount and its free claims still work.
    function test_reserve_unlimitedEditionUnaffected() public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addUnlimited(inst, 1000);

        _paidMint(inst, id, 5000, buyer);
        assertEq(inst.balanceOf(buyer, id), 5000);

        vm.prank(_claimer(0));
        inst.claimFreeMint(id, "");
        assertEq(inst.balanceOf(_claimer(0), id), 1);
    }

    // ── property: free claims always available under arbitrary paid volume ──────

    /// For any paid volume up to the non-reserved cap, every one of the 10 reserved free claims still
    /// lands — the core guarantee of the fix.
    function testFuzz_reserve_freeClaimsAlwaysAvailable(uint256 paid) public {
        ERC1155Instance inst = _deploy();
        uint256 id = _addLimited(inst, 100, 10);

        paid = bound(paid, 0, 90); // 90 == supply - reserve
        if (paid > 0) {
            _paidMint(inst, id, paid, buyer);
        }

        for (uint256 i = 0; i < 10; i++) {
            vm.prank(_claimer(i));
            inst.claimFreeMint(id, "");
            assertEq(inst.balanceOf(_claimer(i), id), 1);
        }
        assertEq(inst.freeMintsClaimed(id), 10);

        (uint256 supply, uint256 minted) = _supplyMinted(inst, id);
        assertEq(minted, paid + 10);
        assertLe(minted, supply);
    }

    // ── helper: read supply/minted from the public editions() getter ───────────

    /// Pulls just `supply` (struct index 3) and `minted` (index 4) from the auto-generated `editions`
    /// getter; the other seven fields are skipped positionally.
    function _supplyMinted(ERC1155Instance inst, uint256 id) internal view returns (uint256 supply, uint256 minted) {
        (,,, supply, minted,,,,) = inst.editions(id);
    }
}
