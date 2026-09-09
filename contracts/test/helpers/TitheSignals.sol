// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Vm } from "forge-std/Vm.sol";

/**
 * @title TitheSignals
 * @notice Log assertions for the two vault-cut redirect signals.
 * @dev A vault cut reaches the protocol treasury by two different routes: the PRIMARY path redirects
 *      it as it is earned (graduation / settle / withdraw), and the FLUSH path redirects a cut that
 *      was stashed by a failed push and whose target was revoked while it sat. Those are one payment
 *      and one re-routed payment, not two payments — a tithe report that could not tell them apart
 *      would double-count every cut that took the long way round. So each path emits its own event,
 *      and these helpers assert exactly that, from the raw log topics rather than from a single
 *      `expectEmit` that could not see the absence of the other one.
 */
library TitheSignals {
    /// @dev Count logs whose topic0 is `sig`.
    function count(Vm.Log[] memory logs, bytes32 sig) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics.length != 0 && logs[i].topics[0] == sig) n++;
        }
    }
}
