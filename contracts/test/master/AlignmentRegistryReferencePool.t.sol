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

/// @notice Mock Algebra Integral volatility-oracle plugin.
contract MockVolatilityOracle {
    bool public reverts;
    uint256 public cumCount = 2;

    function setReverts(bool v) external {
        reverts = v;
    }

    function setCumCount(uint256 n) external {
        cumCount = n;
    }

    function getTimepoints(uint32[] calldata)
        external
        view
        returns (int56[] memory tickCumulatives, uint88[] memory volatilityCumulatives)
    {
        require(!reverts, "no history");
        tickCumulatives = new int56[](cumCount);
        volatilityCumulatives = new uint88[](cumCount);
        for (uint256 i = 0; i < cumCount; i++) {
            tickCumulatives[i] = int56(int256(i) * 1000);
        }
    }
}

/// @notice Mock Algebra pool. Its oracle is `plugin()`; `address(0)` means no oracle (unusable).
contract MockAlgebraRefPool {
    address public token0;
    address public token1;
    address public plugin;

    constructor(address _token0, address _token1, address _plugin) {
        token0 = _token0;
        token1 = _token1;
        plugin = _plugin;
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

/// @notice Mock canonical Algebra factory. Algebra has one pool per pair, so no fee tier in the key.
contract MockAlgebraRefFactory {
    mapping(bytes32 => address) private _pools;

    function _key(address a, address b) private pure returns (bytes32) {
        (address lo, address hi) = a < b ? (a, b) : (b, a);
        return keccak256(abi.encode(lo, hi));
    }

    function register(address t0, address t1, address pool) external {
        _pools[_key(t0, t1)] = pool;
    }

    function poolByPair(address tokenA, address tokenB) external view returns (address) {
        return _pools[_key(tokenA, tokenB)];
    }
}

/// @notice noesis-035 — canonical reference pool (setReferencePool / getReferencePool) with setter teeth.
contract AlignmentRegistryReferencePoolTest is Test {
    AlignmentRegistryV1 public registry;

    address public daoOwner = makeAddr("dao");
    address public alice = makeAddr("alice");
    address public weth = makeAddr("WETH");
    address public cultToken = makeAddr("CULT");
    address public otherToken = makeAddr("OTHER");

    uint8 internal constant KIND_UNI = 0;
    uint8 internal constant KIND_ALGEBRA = 1;

    MockUniV3RefFactory public uniFactory;
    MockAlgebraRefFactory public algebraFactory;

    function setUp() public {
        uniFactory = new MockUniV3RefFactory();
        algebraFactory = new MockAlgebraRefFactory();
        AlignmentRegistryV1 impl = new AlignmentRegistryV1(weth, address(uniFactory), address(algebraFactory));
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

    function _algebraPool(address t0, address t1, address plugin) internal returns (MockAlgebraRefPool p) {
        p = new MockAlgebraRefPool(t0, t1, plugin);
        algebraFactory.register(t0, t1, address(p));
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

    /// The CYPH-on-Algebra case: a real target whose deep price authority lives on an Algebra pool.
    function test_SetReferencePool_Algebra_StoresAndEmits() public {
        uint256 targetId = _registerTarget();
        MockVolatilityOracle oracle = new MockVolatilityOracle();
        MockAlgebraRefPool pool = _algebraPool(cultToken, weth, address(oracle));

        vm.prank(daoOwner);
        vm.expectEmit(true, true, false, true);
        emit IAlignmentRegistry.ReferencePoolSet(targetId, cultToken, address(pool), KIND_ALGEBRA);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_ALGEBRA, 900));

        IAlignmentRegistry.ReferencePool memory got = registry.getReferencePool(targetId, cultToken);
        assertEq(got.pool, address(pool));
        assertEq(uint256(got.kind), KIND_ALGEBRA);
        assertEq(uint256(got.twapWindow), 900);
    }

    function test_SetReferencePool_DefaultWindowWhenZero() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = _uniPool(cultToken, weth);
        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
        // stored struct keeps the raw 0 (consumers resolve 0 => default); the setter still probed with 1800.
        assertEq(uint256(registry.getReferencePool(targetId, cultToken).twapWindow), 0);
    }

    function test_SetReferencePool_Update() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool uni = _uniPool(cultToken, weth);
        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(uni), KIND_UNI, 0));

        MockVolatilityOracle oracle = new MockVolatilityOracle();
        MockAlgebraRefPool algebra = _algebraPool(weth, cultToken, address(oracle));
        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(algebra), KIND_ALGEBRA, 0));

        IAlignmentRegistry.ReferencePool memory got = registry.getReferencePool(targetId, cultToken);
        assertEq(got.pool, address(algebra));
        assertEq(uint256(got.kind), KIND_ALGEBRA);
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

    function test_SetReferencePool_RevertAlgebraWrongPair() public {
        uint256 targetId = _registerTarget();
        MockVolatilityOracle oracle = new MockVolatilityOracle();
        MockAlgebraRefPool pool = _algebraPool(cultToken, otherToken, address(oracle));
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolTokenMismatch.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_ALGEBRA, 0));
    }

    function test_SetReferencePool_RevertAlgebraNoPlugin() public {
        uint256 targetId = _registerTarget();
        MockAlgebraRefPool pool = _algebraPool(cultToken, weth, address(0)); // plugin() == 0
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolUnusable.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_ALGEBRA, 0));
    }

    function test_SetReferencePool_RevertAlgebraOracleNoHistory() public {
        uint256 targetId = _registerTarget();
        MockVolatilityOracle oracle = new MockVolatilityOracle();
        oracle.setReverts(true);
        MockAlgebraRefPool pool = _algebraPool(cultToken, weth, address(oracle));
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolUnusable.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_ALGEBRA, 0));
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

    function test_SetReferencePool_Algebra_RejectsLookAlikeTheFactoryDoesNotName() public {
        uint256 targetId = _registerTarget();
        MockVolatilityOracle oracle = new MockVolatilityOracle();
        MockAlgebraRefPool forgery = new MockAlgebraRefPool(cultToken, weth, address(oracle));

        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolNotCanonical.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(forgery), KIND_ALGEBRA, 900));
    }

    /**
     * A deployment with no canonical factory for a kind cannot pin that kind AT ALL. The alternative —
     * treating `address(0)` as "skip the check" — would make the guard vanish on exactly the networks
     * where nobody configured it, which is the fail-open shape this whole change exists to remove.
     */
    function test_SetReferencePool_UnavailableKindIsRefusedNotWaved() public {
        AlignmentRegistryV1 impl = new AlignmentRegistryV1(weth, address(0), address(0));
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

        MockVolatilityOracle oracle = new MockVolatilityOracle();
        MockAlgebraRefPool algebra = _algebraPool(cultToken, weth, address(oracle));
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferenceKindUnavailable.selector);
        bare.setReferencePool(targetId, cultToken, _ref(address(algebra), KIND_ALGEBRA, 900));
    }

    /// The factories are immutables, so they are readable and fixed for the life of the implementation.
    function test_FactoriesAreExposedImmutables() public view {
        assertEq(registry.v3Factory(), address(uniFactory));
        assertEq(registry.algebraFactory(), address(algebraFactory));
    }
}
