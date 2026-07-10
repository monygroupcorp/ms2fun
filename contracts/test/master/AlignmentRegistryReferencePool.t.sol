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

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
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

    function setUp() public {
        AlignmentRegistryV1 impl = new AlignmentRegistryV1(weth);
        address proxy = LibClone.deployERC1967(address(impl));
        registry = AlignmentRegistryV1(proxy);
        registry.initialize(daoOwner);
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
        MockUniV3RefPool pool = new MockUniV3RefPool(cultToken, weth); // {token, weth}, order token-first

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
        MockUniV3RefPool pool = new MockUniV3RefPool(weth, cultToken); // {weth, token}, reversed order

        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
        assertEq(registry.getReferencePool(targetId, cultToken).pool, address(pool));
    }

    /// The CYPH-on-Algebra case: a real target whose deep price authority lives on an Algebra pool.
    function test_SetReferencePool_Algebra_StoresAndEmits() public {
        uint256 targetId = _registerTarget();
        MockVolatilityOracle oracle = new MockVolatilityOracle();
        MockAlgebraRefPool pool = new MockAlgebraRefPool(cultToken, weth, address(oracle));

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
        MockUniV3RefPool pool = new MockUniV3RefPool(cultToken, weth);
        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
        // stored struct keeps the raw 0 (consumers resolve 0 => default); the setter still probed with 1800.
        assertEq(uint256(registry.getReferencePool(targetId, cultToken).twapWindow), 0);
    }

    function test_SetReferencePool_Update() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool uni = new MockUniV3RefPool(cultToken, weth);
        vm.prank(daoOwner);
        registry.setReferencePool(targetId, cultToken, _ref(address(uni), KIND_UNI, 0));

        MockVolatilityOracle oracle = new MockVolatilityOracle();
        MockAlgebraRefPool algebra = new MockAlgebraRefPool(weth, cultToken, address(oracle));
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
        MockUniV3RefPool pool = new MockUniV3RefPool(cultToken, weth);
        vm.prank(alice);
        vm.expectRevert(Ownable.Unauthorized.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
    }

    function test_SetReferencePool_RevertOnUnknownTarget() public {
        MockUniV3RefPool pool = new MockUniV3RefPool(cultToken, weth);
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        registry.setReferencePool(999, cultToken, _ref(address(pool), KIND_UNI, 0));
    }

    function test_SetReferencePool_RevertOnInactiveTarget() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = new MockUniV3RefPool(cultToken, weth);
        vm.prank(daoOwner);
        registry.deactivateAlignmentTarget(targetId);
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
    }

    function test_SetReferencePool_RevertOnTokenNotInTarget() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = new MockUniV3RefPool(otherToken, weth);
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
        MockUniV3RefPool pool = new MockUniV3RefPool(cultToken, weth);
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.InvalidReferenceKind.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), 2, 0));
    }

    function test_SetReferencePool_RevertUniV3WrongPair() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = new MockUniV3RefPool(cultToken, otherToken); // no WETH side
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolTokenMismatch.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
    }

    function test_SetReferencePool_RevertUniV3NoHistory() public {
        uint256 targetId = _registerTarget();
        MockUniV3RefPool pool = new MockUniV3RefPool(cultToken, weth);
        pool.setObserveReverts(true);
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolUnusable.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_UNI, 0));
    }

    function test_SetReferencePool_RevertAlgebraWrongPair() public {
        uint256 targetId = _registerTarget();
        MockVolatilityOracle oracle = new MockVolatilityOracle();
        MockAlgebraRefPool pool = new MockAlgebraRefPool(cultToken, otherToken, address(oracle));
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolTokenMismatch.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_ALGEBRA, 0));
    }

    function test_SetReferencePool_RevertAlgebraNoPlugin() public {
        uint256 targetId = _registerTarget();
        MockAlgebraRefPool pool = new MockAlgebraRefPool(cultToken, weth, address(0)); // plugin() == 0
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolUnusable.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_ALGEBRA, 0));
    }

    function test_SetReferencePool_RevertAlgebraOracleNoHistory() public {
        uint256 targetId = _registerTarget();
        MockVolatilityOracle oracle = new MockVolatilityOracle();
        oracle.setReverts(true);
        MockAlgebraRefPool pool = new MockAlgebraRefPool(cultToken, weth, address(oracle));
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolUnusable.selector);
        registry.setReferencePool(targetId, cultToken, _ref(address(pool), KIND_ALGEBRA, 0));
    }
}
