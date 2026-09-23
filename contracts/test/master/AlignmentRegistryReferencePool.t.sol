// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";

// ── Mock venues ──────────────────────────────────────────────────────────────

/// @notice Mock Uniswap V3 pool. `observe` returns two cumulatives unless configured to revert (no history).
contract MockUniV3RefPool {
    address public token0;
    address public token1;
    bool public observeReverts;
    uint256 public cumCount = 2;
    /// @dev Settable so a forgery can report a tier it is not registered under — the candidate's own word.
    uint24 public fee = 3000;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    function setFee(uint24 v) external {
        fee = v;
    }

    function setObserveReverts(bool v) external {
        observeReverts = v;
    }

    function setCumCount(uint256 n) external {
        cumCount = n;
    }

    function observe(uint32[] calldata)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        require(!observeReverts, "no history");
        tickCumulatives = new int56[](cumCount);
        secondsPerLiquidityCumulativeX128s = new uint160[](cumCount);
        for (uint256 i = 0; i < cumCount; i++) {
            tickCumulatives[i] = int56(int256(i) * 1000);
        }
    }
}

/// @notice Mock canonical Uniswap V3 factory. `getPool` answers only for pairs explicitly registered here,
///         which is what makes an unregistered look-alike distinguishable from a real pool.
contract MockUniV3RefFactory {
    mapping(bytes32 => address) private _pools;

    function _key(address a, address b, uint24 f) private pure returns (bytes32) {
        (address lo, address hi) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encode(lo, hi, f));
    }

    function register(address t0, address t1, uint24 f, address pool) external {
        _pools[_key(t0, t1, f)] = pool;
    }

    function getPool(address tokenA, address tokenB, uint24 f) external view returns (address) {
        return _pools[_key(tokenA, tokenB, f)];
    }
}

contract AlignmentRegistryReferencePoolTest is Test {
    AlignmentRegistryV1 public registry;

    address public daoOwner = makeAddr("dao");
    address public alice = makeAddr("alice");
    address public weth = makeAddr("WETH");
    address public cultToken = makeAddr("CULT");
    address public otherToken = makeAddr("OTHER");

    uint8 internal constant KIND_UNI = 0;

    MockUniV3RefFactory public uniFactory;

    function setUp() public {
        uniFactory = new MockUniV3RefFactory();
        AlignmentRegistryV1 impl = new AlignmentRegistryV1(weth, address(uniFactory));
        address proxy = LibClone.deployERC1967(address(impl));
        registry = AlignmentRegistryV1(proxy);
        registry.initialize(daoOwner);
    }

    /// @dev A pool the canonical factory names — the ordinary case every pre-existing test in this file is
    ///      about. Provenance is a property of the VENUE, not of the pool contract, so it is minted here
    ///      rather than in the mock's constructor: a pool built without this helper is a look-alike, which
    ///      is exactly the fixture the forgery tests need.
    function _uniPool(address t0, address t1) internal returns (MockUniV3RefPool p) {
        p = new MockUniV3RefPool(t0, t1);
        uniFactory.register(t0, t1, p.fee(), address(p));
    }

    function _registerTarget() internal returns (uint256) {
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({ token: cultToken, symbol: "CULT", info: "", metadataURI: "" });
        vm.prank(daoOwner);
        return registry.registerAlignmentTarget("Remilia", "", "", assets);
    }

    function _ref(address pool, uint8 kind, uint32 window)
        internal
        pure
        returns (IAlignmentRegistry.ReferencePool memory)
    {
        return IAlignmentRegistry.ReferencePool({ pool: pool, kind: kind, twapWindow: window });
    }

    // ── happy paths: BOTH venue kinds must pass ─────────────────────────────────

    function test_SetReferencePool_UniV3_StoresAndEmits() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(cultToken, weth); // {token, weth}, order token-first

        vm.prank(daoOwner);
        vm.expectEmit(true, true, false, true);
        emit IAlignmentRegistry.ReferencePoolSet(targetId, cultToken, address(pool), KIND_UNI);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 3600));

        IAlignmentRegistry.ReferencePool memory got = registry.getReferencePool(targetId, cultToken);
        assertEq(got.pool, address(pool));
        assertEq(uint256(got.kind), KIND_UNI);
        assertEq(uint256(got.twapWindow), 3600);
    }

    function test_SetReferencePool_UniV3_WethFirstOrder() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(weth, cultToken); // {weth, token}, reversed order

        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
        assertEq(registry.getReferencePool(targetId, cultToken).pool, address(pool));
    }

    /// @dev Kind 1 was the Algebra reference pool, and it left the tree with the Cypher venue. The
    ///      FIELD stays so a second oracle family can be added without migrating stored routes, but
    ///      the registry accepts only kind 0 today — a stale pin naming the retired kind is refused
    ///      rather than probed against a factory that no longer exists.
    function test_SetReferencePool_RetiredAlgebraKindIsRefused() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(cultToken, weth);

        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.InvalidReferenceKind.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), 1, 900));
    }

    /// noesis-285: a caller's 0 is RESOLVED at set time and the proved window is what is stored, so the
    /// reader is never left to resolve the same 0 against a different constant of its own. `1800` is
    /// `AlignmentRegistryV1.DEFAULT_TWAP_WINDOW`, transcribed because it is `internal`.
    function test_SetReferencePool_DefaultWindowWhenZero() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(cultToken, weth);
        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
        assertEq(uint256(registry.getReferencePool(targetId, cultToken).twapWindow), 1800);
    }

    function test_SetReferencePool_Update() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool uni = _uniPool(cultToken, weth);
        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(uni), KIND_UNI, 0));

        MockUniV3RefPool second = _uniPool(weth, cultToken);
        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(second), KIND_UNI, 0));

        IAlignmentRegistry.ReferencePool memory got = registry.getReferencePool(targetId, cultToken);
        assertEq(got.pool, address(second));
        assertEq(uint256(got.kind), KIND_UNI);
    }

    // ── getter default ──────────────────────────────────────────────────────────

    function test_GetReferencePool_UnsetReturnsZeroed() public {
        uint256 targetId = _registerTarget();
        IAlignmentRegistry.ReferencePool memory got = registry.getReferencePool(targetId, cultToken);
        assertEq(got.pool, address(0));
        assertEq(uint256(got.kind), 0);
        assertEq(uint256(got.twapWindow), 0);
    }

    // ── auth / existence reverts ─────────────────────────────────────────────────

    function test_SetReferencePool_RevertIfNotOwner() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(cultToken, weth);
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
    }

    function test_SetReferencePool_RevertOnUnknownTarget() public {
        MockUniV3RefPool pool = _uniPool(cultToken, weth);
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        registry.setReferencePool(999, cultToken, _ref(address(pool), KIND_UNI, 0));
    }

    function test_SetReferencePool_RevertOnInactiveTarget() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(cultToken, weth);
        vm.prank(daoOwner);
        registry.deactivateAlignmentTarget(targetId);
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
    }

    function test_SetReferencePool_RevertOnTokenNotInTarget() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(otherToken, weth);
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TokenNotInTarget.selector);
        registry.setReferencePool(targetId, otherToken, _ref(address(pool), KIND_UNI, 0));
    }

    // ── teeth: pool integrity reverts ────────────────────────────────────────────

    function test_SetReferencePool_RevertOnPoolNoCode() public {
        uint256 targetId = _registerTarget();
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolUnusable.selector);
        registry.setReferencePool(targetId, cultToken, _ref(makeAddr("noCodePool"), KIND_UNI, 0));
    }

    function test_SetReferencePool_RevertOnInvalidKind() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(cultToken, weth);
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.InvalidReferenceKind.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), 2, 0));
    }

    function test_SetReferencePool_RevertUniV3WrongPair() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(cultToken, otherToken); // no WETH side
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolTokenMismatch.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
    }

    function test_SetReferencePool_RevertUniV3NoHistory() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(cultToken, weth);
        pool.setObserveReverts(true);
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolUnusable.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
    }

    // ── provenance (noesis-283): shape is not origin ────────────────────────────

    /**
     * The defect this closes. Before provenance, the setter's whole test was SHAPE: answer `token0`,
     * `token1` and `observe` and you were the protocol's "price an attacker cannot move within a single
     * transaction". `MockUniV3RefPool` is a hand-written contract that passes every one of those checks —
     * which is the point: it is not a stub standing in for a pool, it IS what an attacker would deploy.
     * Built without `_uniPool`, no factory names it, and the setter must now refuse it.
     */
    function test_SetReferencePool_UniV3_RejectsLookAlikeTheFactoryDoesNotName() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool forgery = new MockUniV3RefPool(cultToken, weth); // shape-perfect, unregistered

        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolNotCanonical.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(forgery), KIND_UNI, 3600));
    }

    /// Same pair, real registered pool — the forgery cannot borrow its neighbour's provenance by reporting
    /// the tier that pool is registered under. `getPool` answers with the genuine address, not the caller's.
    function test_SetReferencePool_UniV3_ForgeryCannotBorrowARealPoolsTier() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool genuine = _uniPool(cultToken, weth);
        MockUniV3RefPool forgery = new MockUniV3RefPool(cultToken, weth);
        forgery.setFee(genuine.fee()); // claims the registered tier

        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolNotCanonical.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(forgery), KIND_UNI, 3600));

        // and the genuine one still pins, so the check rejects the impostor and not the pair.
        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(genuine), KIND_UNI, 3600));
        assertEq(registry.getReferencePool(targetId, cultToken).pool, address(genuine));
    }

    /// A registered pool reached under a tier it is NOT registered for is equally unnamed.
    function test_SetReferencePool_UniV3_RejectsWrongFeeTier() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(cultToken, weth);
        pool.setFee(500); // registered at 3000, now reports 500

        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolNotCanonical.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 3600));
    }

    /**
     * A deployment with no canonical factory for a kind cannot pin that kind AT ALL. The alternative —
     * treating `address(0)` as "skip the check" — would make the guard vanish on exactly the networks
     * where nobody configured it, which is the fail-open shape this whole change exists to remove.
     */
    function test_SetReferencePool_UnavailableKindIsRefusedNotWaved() public {
        AlignmentRegistryV1 impl = new AlignmentRegistryV1(weth, address(0));
        AlignmentRegistryV1 bare = AlignmentRegistryV1(LibClone.deployERC1967(address(impl)));
        bare.initialize(daoOwner);

        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({ token: cultToken, symbol: "CULT", info: "", metadataURI: "" });
        vm.prank(daoOwner);
        uint256 targetId = bare.registerAlignmentTarget("Remilia", "", "", assets);

        MockUniV3RefPool uni = _uniPool(cultToken, weth); // canonical on THIS suite's factory, not on `bare`
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferenceKindUnavailable.selector);
        bare.setReferencePool(targetId, cultToken, _ref(address(uni), KIND_UNI, 3600));
    }

    /// The factory is an immutable, so it is readable and fixed for the life of the implementation.
    function test_FactoriesAreExposedImmutables() public view {
        assertEq(registry.v3Factory(), address(uniFactory));
    }
}
