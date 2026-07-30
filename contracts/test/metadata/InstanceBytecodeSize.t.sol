// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";

/// @notice EIP-170 runtime-bytecode size guard for the instance types noesis-084 adds bytes to.
/// @dev Reads the BUILT artifact via `vm.getDeployedCode` rather than deploying on the fork: the
///      fork config raises `--code-size-limit` to 30000, which would MASK an over-limit contract if
///      we deployed and measured on-chain. Reading the compiled deployed bytecode measures the real
///      mainnet-relevant size (EIP-170 = 24_576 bytes).
///
///      Scope is deliberately ERC1155Instance + ERC721AuctionInstance ONLY — the two types 084 grows
///      (contractURI/setContractURI/event + ERC1155 symbol). ERC404BondingInstance is intentionally
///      EXCLUDED: it is a pre-existing EIP-170 overflow untouched by 084 (deferred to noesis-085), so
///      guarding it here would fail for a reason this item does not own.
contract InstanceBytecodeSizeTest is Test {
    uint256 internal constant EIP170_LIMIT = 24_576;

    function test_ERC1155Instance_underEip170() public view {
        uint256 size = vm.getDeployedCode("ERC1155Instance.sol:ERC1155Instance").length;
        assertLt(size, EIP170_LIMIT, "ERC1155Instance runtime bytecode exceeds EIP-170");
    }

    function test_ERC721AuctionInstance_underEip170() public view {
        uint256 size = vm.getDeployedCode("ERC721AuctionInstance.sol:ERC721AuctionInstance").length;
        assertLt(size, EIP170_LIMIT, "ERC721AuctionInstance runtime bytecode exceeds EIP-170");
    }
}
