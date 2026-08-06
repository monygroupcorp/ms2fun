// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MasterRegistry
 * @notice Standard ERC1967 proxy for MasterRegistryV1 (UUPS upgradeable)
 * @dev Stores the implementation address at the ERC1967 implementation slot
 *      and delegates all calls. Upgrades are handled by the UUPS implementation.
 */
contract MasterRegistry {
    error InitializationFailed();
    /// @dev The implementation address carries no code. `delegatecall` to a code-less address returns
    ///      SUCCESS and writes nothing, so such a proxy answers EMPTY SUCCESS to every call — it cannot
    ///      even fail its own `_data` init, because there is no failure for `InitializationFailed` to
    ///      catch. Every ERC404/ERC1155/ERC721 instance holds this proxy as its `masterRegistry` and
    ///      trusts its answers (`isVaultRegistered`, `isAgent`, `getInstanceVaults`), which a silently
    ///      empty registry decodes as `false`/empty across the board. `address(0)` is a subset of this
    ///      check; a non-zero EOA is exactly as broken. Constructor-only, so it costs no runtime bytes.
    error InvalidImplementation();

    /// @dev ERC1967 implementation slot: keccak256("eip1967.proxy.implementation") - 1
    bytes32 internal constant _ERC1967_IMPLEMENTATION_SLOT =
        0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    /**
     * @dev Sets the implementation and optionally initializes via delegatecall.
     * @param implementation The implementation contract address
     * @param _data Initialization calldata (e.g. abi.encodeCall(initialize, (owner)))
     * @dev Reverts `InvalidImplementation` if `implementation` carries no code (noesis-151). Without it
     *      the proxy is constructible around a code-less address and then returns empty success for
     *      every call forever — the same silent-success class as noesis-150, on the contract every
     *      instance trusts. This is the ONLY writer of the implementation slot in this contract; the
     *      upgrade path lives in the implementation (solady `UUPSUpgradeable.upgradeToAndCall`, via
     *      `SafeOwnableUUPS`) and already rejects a code-less target — its `proxiableUUID()` staticcall
     *      cannot return the slot from an address with no code, so it reverts `UpgradeFailed`.
     *      The `missing-zero-check` suppression is dropped with the guard that made it necessary:
     *      `address(0)` can no longer reach the `sstore`. `controlled-delegatecall` stays — delegating
     *      to a caller-supplied implementation is the intended design of an ERC1967 proxy.
     */
    // slither-disable-next-line controlled-delegatecall
    constructor(address implementation, bytes memory _data) {
        if (implementation.code.length == 0) revert InvalidImplementation();
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

    /**
     * @dev Delegates all calls to the implementation stored at the ERC1967 slot.
     */
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

    receive() external payable {
        assembly {
            let impl := sload(_ERC1967_IMPLEMENTATION_SLOT)
            let result := delegatecall(gas(), impl, 0, 0, 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch result
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}
