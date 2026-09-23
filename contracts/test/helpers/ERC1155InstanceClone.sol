// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { LibClone } from "solady/utils/LibClone.sol";
import { ERC1155Instance } from "../../src/factories/erc1155/ERC1155Instance.sol";

/**
 * @notice An uninitialized ERC1155Instance clone, the shape `ERC1155Factory.create` produces.
 * @dev A test that wants an instance cannot `new ERC1155Instance(...)` any more: collections are
 *      EIP-1167 clones of one implementation, and the implementation locks itself in its own
 *      constructor so nobody can claim it. So a test stands up the same two contracts the factory
 *      does — implementation, then clone — and calls `initialize` on the clone.
 *
 *      The factory reaches its clone through CreateX so the address is deterministic; a test does
 *      not care about the address, so it clones with `LibClone` directly. Both produce the same
 *      45-byte EIP-1167 proxy, which is what is under test here.
 */
function newERC1155InstanceClone() returns (ERC1155Instance) {
    ERC1155Instance implementation = new ERC1155Instance();
    return ERC1155Instance(payable(LibClone.clone(address(implementation))));
}
