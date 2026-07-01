// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MetadataResolverRouter} from "../../src/metadata/MetadataResolverRouter.sol";
import {IMetadataResolver} from "../../src/metadata/IMetadataResolver.sol";
import {Ownable} from "solady/auth/Ownable.sol";
import {IMasterRegistry} from "../../src/master/interfaces/IMasterRegistry.sol";

/// @dev Registry mock with a togglable per-address isFactoryRegistered (the real one in the
///      shared mock always returns true, which can't exercise the seal-front-run guard).
contract ToggleRegistry {
    mapping(address => bool) public factories;
    function setFactory(address a, bool v) external { factories[a] = v; }
    function isFactoryRegistered(address a) external view returns (bool) { return factories[a]; }

    mapping(address => address) public instFactory;
    function setInstanceFactory(address inst_, address f) external { instFactory[inst_] = f; }
    function getInstanceInfo(address inst_) external view returns (IMasterRegistry.InstanceInfo memory info) {
        info.instance = inst_;
        info.factory = instFactory[inst_];
    }
}

/// @dev A child resolver returning a fixed string, or reverting (defensive-path coverage).
contract StubResolver is IMetadataResolver {
    string internal ret;
    bool internal boom;
    constructor(string memory r, bool b) { ret = r; boom = b; }
    function resolve(address, uint256, address) external view override returns (string memory) {
        if (boom) revert("boom");
        return ret;
    }
    function metadataURI() external pure override returns (string memory) { return ""; }
    function setMetadataURI(string calldata) external override {}
}

contract MetadataResolverRouterTest is Test {
    MetadataResolverRouter router;
    ToggleRegistry registry;

    address factory = address(0xF1);
    address attacker = address(0xBAD);
    address inst = address(0x1111);

    function setUp() public {
        registry = new ToggleRegistry();
        router = new MetadataResolverRouter(address(registry));
        registry.setFactory(factory, true);
        registry.setInstanceFactory(inst, factory);
    }

    function _children(address a, address b) internal pure returns (address[] memory rs) {
        rs = new address[](2);
        rs[0] = a;
        rs[1] = b;
    }

    function test_initResolvers_onlyRegisteredFactory() public {
        address[] memory rs = new address[](0);
        vm.prank(attacker);
        vm.expectRevert(MetadataResolverRouter.NotRegisteredFactory.selector);
        router.initResolvers(inst, rs);
    }

    function test_initResolvers_sealOnce() public {
        address[] memory rs = new address[](0);
        vm.prank(factory);
        router.initResolvers(inst, rs);
        vm.prank(factory);
        vm.expectRevert(MetadataResolverRouter.AlreadySealed.selector);
        router.initResolvers(inst, rs);
    }

    /// @dev Seal-front-run: deterministic CREATE3 addresses are public, but only a *registered factory*
    ///      may seal a (future) instance — an attacker cannot pre-seal it.
    function test_sealFrontRun_blocked() public {
        address[] memory rs = new address[](0);
        vm.prank(attacker);
        vm.expectRevert(MetadataResolverRouter.NotRegisteredFactory.selector);
        router.initResolvers(inst, rs);
        // After the attacker fails, the legit factory can still seal it.
        vm.prank(factory);
        router.initResolvers(inst, rs);
        assertTrue(router.sealed_(inst));
    }

    function test_resolve_firstNonEmptyWins() public {
        StubResolver empty = new StubResolver("", false);
        StubResolver b = new StubResolver("B", false);
        StubResolver c = new StubResolver("C", false);
        address[] memory rs = new address[](3);
        rs[0] = address(empty);
        rs[1] = address(b);
        rs[2] = address(c);
        vm.prank(factory);
        router.initResolvers(inst, rs);
        assertEq(router.resolve(inst, 1, address(0)), "B");
    }

    /// @dev A reverting child is skipped (defensive try/catch), not propagated.
    function test_resolve_defensiveOnRevertingChild() public {
        StubResolver bad = new StubResolver("X", true);   // reverts
        StubResolver good = new StubResolver("GOOD", false);
        vm.prank(factory);
        router.initResolvers(inst, _children(address(bad), address(good)));
        assertEq(router.resolve(inst, 7, address(0)), "GOOD");
    }

    function test_resolve_allEmpty_returnsEmpty() public {
        StubResolver e1 = new StubResolver("", false);
        StubResolver e2 = new StubResolver("", false);
        vm.prank(factory);
        router.initResolvers(inst, _children(address(e1), address(e2)));
        assertEq(router.resolve(inst, 1, address(0)), "");
    }

    function test_resolve_unsealedInstance_returnsEmpty() public view {
        assertEq(router.resolve(address(0xDEAD), 1, address(0)), "");
    }

    /// @dev A code-less child (e.g. address(0)) makes the high-level resolve call revert on the
    ///      no-code check; the router's explicit code-length guard skips it and continues.
    function test_resolve_codelessChildIsDefensive() public {
        StubResolver good = new StubResolver("GOOD", false);
        vm.prank(factory);
        router.initResolvers(inst, _children(address(0), address(good)));
        assertEq(router.resolve(inst, 1, address(0)), "GOOD");
    }

    /// @dev Sealed with an empty list resolves to "" (feature inert but sealed).
    function test_resolve_sealedEmptyList_returnsEmpty() public {
        address[] memory rs = new address[](0);
        vm.prank(factory);
        router.initResolvers(inst, rs);
        assertTrue(router.sealed_(inst));
        assertEq(router.resolverCount(inst), 0);
        assertEq(router.resolve(inst, 1, address(0)), "");
    }

    function test_setMetadataURI_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(Ownable.Unauthorized.selector);
        router.setMetadataURI("x");
        router.setMetadataURI("data:application/json,{}"); // owner = this test contract
        assertEq(router.metadataURI(), "data:application/json,{}");
    }

    /// @dev D1 least-privilege: a registered factory that is NOT this instance's factory cannot seal it.
    function test_initResolvers_rejectsWrongFactory() public {
        address otherFactory = address(0xF2);
        vm.prank(otherFactory);
        vm.expectRevert(MetadataResolverRouter.NotRegisteredFactory.selector);
        router.initResolvers(inst, _children(address(0xA1), address(0xA2)));
    }
}
