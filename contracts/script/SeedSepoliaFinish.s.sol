// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";

/// @notice Replays the unsent calls of a phase-1 seed broadcast, with every timestamp recomputed
///         against the current clock.
///
///         `SeedSepolia` arms each curve at `block.timestamp + armWindow`, and forge fixes that
///         instant before the first transaction is sent. Phase 1 is 113 sequential `--slow`
///         transactions, so a window shorter than the broadcast makes the later
///         `setBondingOpenTime` calls quote a past instant and revert `TimeMustBeInFuture()`. The
///         window has to outlast the broadcast that sets it.
///
///         Input is `deployments/sepolia-seed-finish.json`: target, value and calldata of each
///         unsent call, taken verbatim from the forge broadcast artifact, in the order phase 1
///         would have sent them. A call whose `clock` marker is set carries its selector only and
///         is completed here against a live timestamp (1 = open time, otherwise maturity).
///
///         Order is preserved because instance addresses are deterministic in the sequence that
///         creates them and the featured wall rents by address. The alignment wiring, vaults and
///         pools are not replayed: they hold live state.
contract SeedSepoliaFinish is Script {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    /// @dev Seconds from now until every replayed curve opens. It must outlast the broadcast that
    ///      writes it; raising it costs wall-clock time, not money.
    uint256 internal constant DEFAULT_WINDOW = 3600;

    /// @dev Gap between a row's open time and its maturity, as spaced in phase 1.
    uint256 internal constant MATURITY_GAP = 120;

    function run() public {
        require(block.chainid == SEPOLIA_CHAIN_ID, "SeedSepoliaFinish: not running against Sepolia");

        string memory raw = vm.readFile("./deployments/sepolia-seed-finish.json");
        address[] memory to = vm.parseJsonAddressArray(raw, ".to");
        uint256[] memory value = vm.parseJsonUintArray(raw, ".value");
        bytes[] memory data = vm.parseJsonBytesArray(raw, ".data");
        uint256[] memory clock = vm.parseJsonUintArray(raw, ".clock");
        require(to.length == value.length && to.length == data.length && to.length == clock.length, "manifest: ragged");

        uint256 window = vm.envOr("SEPOLIA_ARM_WINDOW_SECONDS", DEFAULT_WINDOW);
        uint256 openAt = block.timestamp + window;
        uint256 maturityAt = openAt + MATURITY_GAP;

        uint256 spend;
        for (uint256 i = 0; i < to.length; i++) {
            spend += value[i];
        }

        console.log("--------------------------------------------------");
        console.log("ETH projection - phase 1 finish (replay of the unsent calls)");
        console.log("  calls to replay:", to.length);
        console.log("  value to spend (wei):", spend);
        console.log("  deployer balance before (wei):", msg.sender.balance);
        console.log("  gas is NOT included above - it is charged per broadcast tx by forge");
        console.log("  every replayed curve opens at (unix):", openAt);
        console.log("  arm window (seconds):", window);
        console.log("--------------------------------------------------");
        require(msg.sender.balance > spend, "finish: deployer cannot cover the replay");

        vm.startBroadcast();
        for (uint256 i = 0; i < to.length; i++) {
            bytes memory payload = data[i];
            if (clock[i] != 0) {
                payload = bytes.concat(payload, abi.encode(clock[i] == 1 ? openAt : maturityAt));
            }
            (bool ok, bytes memory ret) = to[i].call{ value: value[i] }(payload);
            if (!ok) {
                console.log("REPLAY FAILED at call index (0-based):", i);
                console.log("  target:", to[i]);
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
        vm.stopBroadcast();

        console.log("=== SeedSepolia phase 1 finish complete ===");
        console.log("  calls replayed:", to.length);
        console.log("  every curve opens at (unix):", openAt);
        console.log("  block.timestamp now:", block.timestamp);
        console.log("  NEXT: re-stamp deployments/sepolia-seed.json, then wait out the window");
    }
}
