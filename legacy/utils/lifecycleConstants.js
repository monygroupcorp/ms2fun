/**
 * IInstanceLifecycle Constants
 *
 * JavaScript equivalents of the Solidity lifecycle constants.
 * These must match the keccak256 hashes in IInstanceLifecycle.sol
 */

import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';

// Instance Types (bytes32)
export const TYPE_ERC404 = ethers.utils.id("erc404");
export const TYPE_ERC1155 = ethers.utils.id("erc1155");
export const TYPE_ERC721 = ethers.utils.id("erc721");

// Lifecycle States (bytes32)
export const STATE_NOT_STARTED = ethers.utils.id("not-started");
export const STATE_MINTING = ethers.utils.id("minting");
export const STATE_BONDING = ethers.utils.id("bonding");
export const STATE_ACTIVE = ethers.utils.id("active");
export const STATE_GRADUATED = ethers.utils.id("graduated");
export const STATE_PAUSED = ethers.utils.id("paused");
export const STATE_ENDED = ethers.utils.id("ended");

// Human-readable labels
export const TYPE_LABELS = {
    [TYPE_ERC404]: 'ERC404',
    [TYPE_ERC1155]: 'ERC1155',
    [TYPE_ERC721]: 'ERC721'
};

export const STATE_LABELS = {
    [STATE_NOT_STARTED]: 'Not Started',
    [STATE_MINTING]: 'Minting',
    [STATE_BONDING]: 'Bonding',
    [STATE_ACTIVE]: 'Active',
    [STATE_GRADUATED]: 'Graduated',
    [STATE_PAUSED]: 'Paused',
    [STATE_ENDED]: 'Ended'
};

// Helper functions
export function getTypeLabel(instanceType) {
    return TYPE_LABELS[instanceType] || 'Unknown';
}

export function getStateLabel(currentState) {
    return STATE_LABELS[currentState] || 'Unknown';
}
