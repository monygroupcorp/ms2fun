// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { TokenTierBandResolver } from "../../src/metadata/TokenTierBandResolver.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { Ownable } from "solady/auth/Ownable.sol";

contract BandToggleRegistry {
    mapping(address => address) public instFactory;

    function setInstanceFactory(address inst, address f) external {
        instFactory[inst] = f;
    }

    function getInstanceInfo(address inst) external view returns (IMasterRegistry.InstanceInfo memory info) {
        info.instance = inst;
        info.factory = instFactory[inst];
    }
}

/// @dev Mock ERC404 instance. It exposes a mutable `balanceOf` ON PURPOSE: the point of the whole
///      resolver is that nothing here can change what `resolve` returns.
contract MockBandInstance {
    mapping(address => uint256) public balanceOf;
    address public stakingModule;

    function setBalance(address a, uint256 v) external {
        balanceOf[a] = v;
    }

    function setStaking(address s) external {
        stakingModule = s;
    }
}

contract TokenTierBandResolverTest is Test {
    TokenTierBandResolver band;
    BandToggleRegistry registry;
    MockBandInstance inst;

    address factory = address(0xF1);
    address attacker = address(0xBAD);
    address holder = address(0xB0);
    address other = address(0xB1);

    uint256 constant UNIT = 1e24;

    function setUp() public {
        registry = new BandToggleRegistry();
        band = new TokenTierBandResolver(address(registry));
        inst = new MockBandInstance();
        registry.setInstanceFactory(address(inst), factory);
    }

    function _oneBand() internal pure returns (TokenTierBandResolver.Band[] memory bs) {
        bs = new TokenTierBandResolver.Band[](1);
        bs[0] = TokenTierBandResolver.Band({ idStart: 101, idEnd: 103, baseURI: "tier2-" });
    }

    function _seal(TokenTierBandResolver.Band[] memory bs) internal {
        vm.prank(factory);
        band.initBands(address(inst), bs);
    }

    // ── Construction ────────────────────────────────────────────────────────────

    function test_constructor_rejectsZeroRegistry() public {
        vm.expectRevert(TokenTierBandResolver.InvalidAddress.selector);
        new TokenTierBandResolver(address(0));
    }

    // ── Seal auth + set-once ────────────────────────────────────────────────────

    function test_initBands_onlyRegisteredFactory() public {
        vm.prank(attacker);
        vm.expectRevert(TokenTierBandResolver.NotRegisteredFactory.selector);
        band.initBands(address(inst), _oneBand());
    }

    /// @dev D1 least-privilege: a DIFFERENT factory (registered for some other instance) cannot seal
    ///      this one. Blocks the seal-front-run on a deterministic CREATE3 address.
    function test_initBands_rejectsWrongFactory() public {
        vm.prank(address(0xF2));
        vm.expectRevert(TokenTierBandResolver.NotRegisteredFactory.selector);
        band.initBands(address(inst), _oneBand());
    }

    function test_initBands_sealOnce() public {
        _seal(_oneBand());
        assertTrue(band.sealed_(address(inst)));
        vm.prank(factory);
        vm.expectRevert(TokenTierBandResolver.AlreadySealed.selector);
        band.initBands(address(inst), _oneBand());
    }

    function test_initBands_emitsBandsSealed() public {
        vm.expectEmit(true, false, false, true);
        emit TokenTierBandResolver.BandsSealed(address(inst), 1);
        _seal(_oneBand());
    }

    /// @dev An EMPTY table is a legal (if pointless) seal — it freezes the instance with no bands,
    ///      which must not be re-openable later.
    function test_initBands_emptyTableStillSeals() public {
        TokenTierBandResolver.Band[] memory bs = new TokenTierBandResolver.Band[](0);
        _seal(bs);
        assertTrue(band.sealed_(address(inst)));
        assertEq(band.bandCount(address(inst)), 0);
        vm.prank(factory);
        vm.expectRevert(TokenTierBandResolver.AlreadySealed.selector);
        band.initBands(address(inst), _oneBand());
    }

    // ── Range validation ────────────────────────────────────────────────────────

    function test_initBands_rejectsInvalidRange() public {
        TokenTierBandResolver.Band[] memory bs = new TokenTierBandResolver.Band[](1);
        bs[0] = TokenTierBandResolver.Band({ idStart: 105, idEnd: 102, baseURI: "x" });
        vm.prank(factory);
        vm.expectRevert(TokenTierBandResolver.InvalidRange.selector);
        band.initBands(address(inst), bs);
    }

    function test_initBands_rejectsOverlapping() public {
        TokenTierBandResolver.Band[] memory bs = new TokenTierBandResolver.Band[](2);
        bs[0] = TokenTierBandResolver.Band({ idStart: 101, idEnd: 105, baseURI: "a" });
        bs[1] = TokenTierBandResolver.Band({ idStart: 105, idEnd: 109, baseURI: "b" }); // 105 overlaps
        vm.prank(factory);
        vm.expectRevert(TokenTierBandResolver.RangesNotAscending.selector);
        band.initBands(address(inst), bs);
    }

    function test_initBands_rejectsDescending() public {
        TokenTierBandResolver.Band[] memory bs = new TokenTierBandResolver.Band[](2);
        bs[0] = TokenTierBandResolver.Band({ idStart: 106, idEnd: 109, baseURI: "a" });
        bs[1] = TokenTierBandResolver.Band({ idStart: 101, idEnd: 105, baseURI: "b" });
        vm.prank(factory);
        vm.expectRevert(TokenTierBandResolver.RangesNotAscending.selector);
        band.initBands(address(inst), bs);
    }

    /// @dev Adjacent (idStart == prev.idEnd + 1) ranges are valid; both boundaries are inclusive.
    function test_initBands_adjacentRangesSealOk_boundariesInclusive() public {
        TokenTierBandResolver.Band[] memory bs = new TokenTierBandResolver.Band[](2);
        bs[0] = TokenTierBandResolver.Band({ idStart: 101, idEnd: 105, baseURI: "a-" });
        bs[1] = TokenTierBandResolver.Band({ idStart: 106, idEnd: 109, baseURI: "b-" });
        _seal(bs);
        assertEq(band.bandCount(address(inst)), 2);
        assertEq(band.resolve(address(inst), 105, holder), "a-105"); // idEnd inclusive
        assertEq(band.resolve(address(inst), 106, holder), "b-106"); // idStart inclusive
    }

    // ── Resolution ──────────────────────────────────────────────────────────────

    function test_resolve_inBand_servesBandArt() public {
        _seal(_oneBand());
        assertEq(band.resolve(address(inst), 102, holder), "tier2-102");
    }

    function test_resolve_idOutsideAnyBand_returnsEmpty() public {
        _seal(_oneBand());
        assertEq(band.resolve(address(inst), 99, holder), ""); // below the band
        assertEq(band.resolve(address(inst), 104, holder), ""); // above the band
    }

    /// @dev Blank baseURI → fall through to collection base (""), NOT a bare id string. Without the
    ///      guard, string.concat("", id) would serve "102" — a broken non-URI (noesis-136).
    function test_resolve_blankBaseURI_fallsThrough() public {
        TokenTierBandResolver.Band[] memory bs = new TokenTierBandResolver.Band[](1);
        bs[0] = TokenTierBandResolver.Band({ idStart: 101, idEnd: 103, baseURI: "" });
        _seal(bs);
        assertEq(band.resolve(address(inst), 102, holder), "");
    }

    function test_resolve_unsealedInstance_returnsEmpty() public view {
        assertEq(band.resolve(address(inst), 102, holder), "");
    }

    /// @dev A ladder of denomination bands: each band serves its OWN art, selected purely by id.
    function test_resolve_bandLadder_selectsCorrectBand() public {
        TokenTierBandResolver.Band[] memory bs = new TokenTierBandResolver.Band[](3);
        bs[0] = TokenTierBandResolver.Band({ idStart: 101, idEnd: 110, baseURI: "ten-" });
        bs[1] = TokenTierBandResolver.Band({ idStart: 201, idEnd: 210, baseURI: "hundred-" });
        bs[2] = TokenTierBandResolver.Band({ idStart: 301, idEnd: 301, baseURI: "thousand-" });
        _seal(bs);
        assertEq(band.bandCount(address(inst)), 3);
        assertEq(band.resolve(address(inst), 105, holder), "ten-105");
        assertEq(band.resolve(address(inst), 205, holder), "hundred-205");
        assertEq(band.resolve(address(inst), 301, holder), "thousand-301");
        assertEq(band.resolve(address(inst), 150, holder), ""); // in the gap between bands
    }

    // ── THE POINT: art is invariant to the holder ───────────────────────────────

    /// @dev The whole reason this module replaces TierRevealModule. Same id, same URI: before any
    ///      holder exists, while a rich holder holds it, after their balance goes to zero, and for a
    ///      completely different holder. Nothing about ownership can move the art.
    function test_resolve_invariantToHolderBalance() public {
        _seal(_oneBand());

        // Unminted — holder address(0), zero balance.
        assertEq(band.resolve(address(inst), 102, address(0)), "tier2-102");

        // Holder with a large balance.
        inst.setBalance(holder, 1_000_000 * UNIT);
        assertEq(band.resolve(address(inst), 102, holder), "tier2-102");

        // Same holder, balance drained to zero — the old module would have flipped to lockedURI here.
        inst.setBalance(holder, 0);
        assertEq(band.resolve(address(inst), 102, holder), "tier2-102");

        // A different holder entirely.
        assertEq(band.resolve(address(inst), 102, other), "tier2-102");
    }

    /// @dev Fuzz the same invariant over arbitrary holders and balances.
    function testFuzz_resolve_ignoresHolder(address anyHolder, uint256 anyBalance) public {
        _seal(_oneBand());
        inst.setBalance(anyHolder, anyBalance);
        assertEq(band.resolve(address(inst), 102, anyHolder), "tier2-102");
    }

    /// @dev The resolver must not read the instance at all — an instance with NO balanceOf/staking
    ///      surface still resolves. (A raw address with no code stands in for that.)
    function test_resolve_doesNotCallTheInstance() public {
        address bare = address(0xDEADBEEF);
        registry.setInstanceFactory(bare, factory);
        vm.prank(factory);
        band.initBands(bare, _oneBand());
        assertEq(band.resolve(bare, 102, holder), "tier2-102");
    }

    // ── Per-instance isolation + module self-description ────────────────────────

    function test_bands_arePerInstance() public {
        _seal(_oneBand());
        MockBandInstance other_ = new MockBandInstance();
        registry.setInstanceFactory(address(other_), factory);
        assertEq(band.bandCount(address(other_)), 0);
        assertEq(band.resolve(address(other_), 102, holder), "");
        assertFalse(band.sealed_(address(other_)));
    }

    function test_setMetadataURI_onlyModuleOwner() public {
        vm.prank(attacker);
        vm.expectRevert(Ownable.Unauthorized.selector);
        band.setMetadataURI("x");
        band.setMetadataURI("data:application/json,{}"); // owner = this test contract
        assertEq(band.metadataURI(), "data:application/json,{}");
    }
}
