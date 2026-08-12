// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { UUPSUpgradeable } from "solady/utils/UUPSUpgradeable.sol";
import { MasterRegistry } from "../../src/master/MasterRegistry.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";

/**
 * @title MasterRegistryImplGuardTest
 * @notice noesis-151. `delegatecall` to an address with NO CODE returns SUCCESS and writes nothing.
 *         `MasterRegistry` is the ERC1967 proxy used for every protocol registry (and, via
 *         `DeployCore._deployProxyCreate3`, for the treasury/queue/alignment/component proxies too),
 *         and its constructor used to write the caller-supplied implementation straight to the slot
 *         with no precondition. A proxy built around a code-less implementation therefore:
 *
 *           - answers EMPTY SUCCESS to every call through `fallback()`/`receive()` — no revert, ever;
 *           - cannot even fail its own init, because the `_data` path only bubbles a FAILED
 *             delegatecall and there is no failure to bubble, so `InitializationFailed()` never fires.
 *
 *         Every ERC404/ERC1155/ERC721 instance holds this proxy as `masterRegistry` and trusts its
 *         answers (`isVaultRegistered`, `isAgent`, `getInstanceVaults`, `registerInstance`), all of
 *         which decode empty returndata as `false`/zero/empty. noesis-149 showed what a wrong registry
 *         answer buys an attacker on the config setters gated by `_requireOwnerOrAgent`.
 *
 *         The constructor now rejects it. These tests pin that the guard is a CODE-LENGTH check and
 *         not a zero-address check (a non-zero EOA is exactly as broken, and a naive
 *         `implementation == address(0)` branch would wave it through), and — so the rejection tests
 *         cannot pass vacuously — `test_Unguarded_*` proves the rejection tests are falsifiable by exhibiting the state the
 *         guard removes: a byte-for-byte copy of the pre-noesis-151 constructor that deploys happily
 *         around `address(0)` and then reports success for everything.
 *
 *         Byte budget: the guard is CONSTRUCTOR code, so the proxy's deployed runtime is untouched.
 */
contract MasterRegistryImplGuardTest is Test {
    /// @dev ERC1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
    bytes32 internal constant _IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    address internal owner = makeAddr("registryOwner");

    function _initData() internal view returns (bytes memory) {
        return abi.encodeWithSignature("initialize(address)", owner);
    }

    // ─────────────────────── constructor: the guard ───────────────────────

    function test_Constructor_RevertsOnZeroImplementation() public {
        vm.expectRevert(MasterRegistry.InvalidImplementation.selector);
        new MasterRegistry(address(0), _initData());
    }

    /// @dev The no-init-data shape too: without `_data` there is not even a delegatecall to notice.
    function test_Constructor_RevertsOnZeroImplementationWithoutInitData() public {
        vm.expectRevert(MasterRegistry.InvalidImplementation.selector);
        new MasterRegistry(address(0), "");
    }

    /// @dev THE point of the item: a non-zero address with no code is the case a zero-check misses.
    function test_Constructor_RevertsOnCodelessEoaImplementation() public {
        address eoa = makeAddr("codelessImplementation");
        assertEq(eoa.code.length, 0, "fixture must be code-less");
        assertTrue(eoa != address(0), "fixture must be non-zero: that is what a zero-check misses");
        vm.expectRevert(MasterRegistry.InvalidImplementation.selector);
        new MasterRegistry(eoa, _initData());
    }

    // ────────────────── falsifiability control ──────────────────

    /// @dev The rejection tests above are only meaningful if an UNGUARDED constructor would visibly
    ///      SUCCEED on the same arguments. `UnguardedERC1967Proxy` is the pre-noesis-151 constructor
    ///      verbatim: it deploys around `address(0)`, does not fire `InitializationFailed` despite
    ///      non-empty init data, and then returns success-with-no-data for the very calls instances
    ///      make. That is the state the guard removes.
    function test_Unguarded_CodelessImplementationIsSilentlySuccessful() public {
        UnguardedERC1967Proxy unguarded = new UnguardedERC1967Proxy(address(0), _initData());
        assertGt(address(unguarded).code.length, 0, "unguarded proxy deploys around a code-less impl");
        assertEq(vm.load(address(unguarded), _IMPL_SLOT), bytes32(0), "and stores the code-less impl");

        // Silent success on the registry surface every instance depends on.
        (bool ok, bytes memory ret) = address(unguarded).call(abi.encodeWithSignature("owner()"));
        assertTrue(ok, "code-less delegatecall returns SUCCESS");
        assertEq(ret.length, 0, "...having written and returned nothing");

        (ok, ret) = address(unguarded).call(abi.encodeWithSignature("isAgent(address)", owner));
        assertTrue(ok, "isAgent() does not revert either");
        assertEq(ret.length, 0, "it just answers nothing, which ABI-decodes as false");

        // Identical arguments, guarded constructor: rejected.
        vm.expectRevert(MasterRegistry.InvalidImplementation.selector);
        new MasterRegistry(address(0), _initData());
    }

    // ─────────────────────── constructor: positive control ───────────────────────

    /// @dev The happy path must be untouched: a real implementation still constructs, still runs its
    ///      init through the delegatecall, and calls through the proxy still REACH the implementation.
    function test_Constructor_AcceptsRealImplementationAndDelegatesToIt() public {
        MasterRegistryV1 impl = new MasterRegistryV1();
        MasterRegistry proxy = new MasterRegistry(address(impl), _initData());

        assertEq(vm.load(address(proxy), _IMPL_SLOT), bytes32(uint256(uint160(address(impl)))), "impl slot written");
        // Reaches the implementation AND the init delegatecall actually ran.
        assertEq(MasterRegistryV1(address(proxy)).owner(), owner, "call through the proxy reaches the impl");
        assertEq(MasterRegistryV1(address(proxy)).getTotalFactories(), 0, "and a fresh read decodes normally");
    }

    /// @dev A contract that is not `MasterRegistryV1` still passes: this is a code-length check, not a
    ///      type check. It closes the silently-empty-proxy class — the only failure mode a constructor
    ///      can see — not "you wired the wrong implementation".
    function test_Constructor_AcceptsAnyContractWithCode() public {
        MasterRegistry proxy = new MasterRegistry(address(new ImplCodeStub()), "");
        assertGt(address(proxy).code.length, 0, "proxy must deploy");
        assertEq(ImplCodeStub(address(proxy)).ping(), 1, "and delegate to the stub");
    }

    // ─────────────────────── the upgrade path ───────────────────────
    // `MasterRegistry`'s constructor is the ONLY writer of the implementation slot in this contract.
    // The upgrade path lives in the implementation — solady `UUPSUpgradeable.upgradeToAndCall`, reached
    // through `SafeOwnableUUPS` — and already rejects a code-less target: it staticcalls
    // `proxiableUUID()` and requires the ERC1967 slot back, which an address with no code cannot
    // return, so it reverts `UpgradeFailed`. Nothing to add there (and it is out of this item's scope);
    // these pin that it stays true, since an upgrade to a code-less impl would brick the proxy
    // PERMANENTLY — no constructor guard can help after deployment.

    function _liveProxy() internal returns (MasterRegistryV1) {
        MasterRegistryV1 impl = new MasterRegistryV1();
        return MasterRegistryV1(address(new MasterRegistry(address(impl), _initData())));
    }

    function test_Upgrade_RevertsOnZeroImplementation() public {
        MasterRegistryV1 registry = _liveProxy();
        vm.prank(owner);
        vm.expectRevert(UUPSUpgradeable.UpgradeFailed.selector);
        registry.upgradeToAndCall(address(0), "");
    }

    function test_Upgrade_RevertsOnCodelessEoaImplementation() public {
        MasterRegistryV1 registry = _liveProxy();
        address eoa = makeAddr("codelessUpgradeTarget");
        assertEq(eoa.code.length, 0, "fixture must be code-less");
        vm.prank(owner);
        vm.expectRevert(UUPSUpgradeable.UpgradeFailed.selector);
        registry.upgradeToAndCall(eoa, "");
    }

    /// @dev Positive control for the two above: the same call shape with a real implementation
    ///      succeeds, so those reverts are the code check and not an auth/call-context failure.
    function test_Upgrade_AcceptsRealImplementationAndDelegatesToIt() public {
        MasterRegistryV1 registry = _liveProxy();
        MasterRegistryV1 newImpl = new MasterRegistryV1();

        vm.prank(owner);
        registry.upgradeToAndCall(address(newImpl), "");

        assertEq(
            vm.load(address(registry), _IMPL_SLOT),
            bytes32(uint256(uint160(address(newImpl)))),
            "slot points at the new impl"
        );
        assertEq(registry.owner(), owner, "state and delegation survive the upgrade");
    }
}

/**
 * @dev The pre-noesis-151 `MasterRegistry` constructor + `fallback`, copied verbatim, used ONLY to
 *      prove the guard tests are falsifiable: without the code-length precondition this deploys
 *      around any address and reports success forever. Never used outside this test.
 */
contract UnguardedERC1967Proxy {
    error InitializationFailed();

    bytes32 internal constant _ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address implementation, bytes memory _data) {
        assembly {
            sstore(_ERC1967_IMPLEMENTATION_SLOT, implementation)
        }
        if (_data.length > 0) {
            (bool success, bytes memory returndata) = implementation.delegatecall(_data);
            if (!success) {
                if (returndata.length > 0) {
                    assembly {
                        revert(add(32, returndata), mload(returndata))
                    }
                } else {
                    revert InitializationFailed();
                }
            }
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(_ERC1967_IMPLEMENTATION_SLOT)
            calldatacopy(0, 0, calldatasize())
            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}

/// @dev Minimal implementation used only to prove the guard checks CODE, not the implementation type.
contract ImplCodeStub {
    function ping() external pure returns (uint256) {
        return 1;
    }
}
