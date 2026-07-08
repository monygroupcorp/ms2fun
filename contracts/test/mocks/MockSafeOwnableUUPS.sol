// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../../src/shared/SafeOwnableUUPS.sol";

/**
 * @title MockSafeOwnableUUPS
 * @notice Minimal concrete deriving of the abstract SafeOwnableUUPS base, for characterization
 *         testing the two-step ownership handover and disabled single-step ownership functions.
 */
contract MockSafeOwnableUUPS is SafeOwnableUUPS {
    constructor(address initialOwner) {
        _initializeOwner(initialOwner);
    }
}
