// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Minimal CreateX interface for CREATE3 deployments
interface ICreateX {
    function deployCreate3(bytes32 salt, bytes memory initCode) external payable returns (address);
    function computeCreate3Address(bytes32 salt, address deployer) external pure returns (address);
    function computeCreate3Address(bytes32 salt) external view returns (address);
}

/// @dev CreateX canonical deployment address (same on all chains)
address constant CREATEX = 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed;

/// @title CreateXSalt
/// @notice The salt shape the factories hand CreateX, and the guarded salt CreateX derives from it.
/// @dev CreateX picks its front-run guard from the SHAPE of the salt it is given (`_parseSalt`), not
///      from an argument. A salt whose first 20 bytes are the calling address and whose 21st byte is
///      `0x00` takes the PERMISSIONED path: the guarded salt is
///      `keccak256(abi.encodePacked(uint256(uint160(msg.sender)), salt))`, whose `msg.sender` term no
///      other address can reproduce, so the resolved address belongs to that caller alone.
///
///      Every OTHER shape falls through to the Random path, guarded with `keccak256(abi.encode(salt))`
///      — no sender term at all. A `keccak256(creator, salt)` digest is one of those other shapes: its
///      pseudorandom leading bytes can never equal the caller, so hashing the creator INTO the salt is
///      what destroys the sender binding rather than establishing it. Anyone reading the salt out of a
///      pending transaction's public calldata can deploy to the address first and make the real call
///      revert.
///
///      Per-creator address separation is kept by folding the creator into the 11 bytes of entropy the
///      permissioned shape leaves free — the other 21 bytes are the deployer and the path selector.
library CreateXSalt {
    /// @notice The salt to hand `deployCreate3` so that `deployer` alone can reach the address.
    /// @param deployer The contract that calls CreateX — `address(this)` at both the deploy and the
    ///                 preview, so the two agree by construction.
    /// @param creator  The account the address is derived for; distinct creators get distinct addresses.
    /// @param salt     The caller-supplied salt.
    function permissioned(address deployer, address creator, bytes32 salt) internal pure returns (bytes32) {
        bytes11 entropy = bytes11(keccak256(abi.encodePacked(creator, salt)));
        return bytes32(abi.encodePacked(deployer, bytes1(0x00), entropy));
    }

    /// @notice The guarded salt CreateX derives internally for a `permissioned` salt.
    /// @dev `0x00` in the 21st byte selects permissioned protection WITHOUT cross-chain redeploy
    ///      protection, so `block.chainid` is not in the hash and the same (deployer, creator, salt)
    ///      resolves to the same address on every chain — which is what a deterministic deploy is for.
    function guarded(address deployer, bytes32 permissionedSalt) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(uint256(uint160(deployer)), permissionedSalt));
    }
}
