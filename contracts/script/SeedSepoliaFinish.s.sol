// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Script, console } from "forge-std/Script.sol";

/// @notice Completes a phase-1 seed broadcast that stopped partway, by replaying the calls it never
///         sent — with every timestamp recomputed against the clock the chain will actually judge
///         them by.
///
///         ── WHY THIS EXISTS ──
///         `SeedSepolia` arms each curve at `block.timestamp + armWindow`. Forge evaluates a whole
///         script at ONE timestamp and only then broadcasts it, so that instant is fixed before the
///         first transaction is sent. Phase 1 is 113 sequential `--slow` transactions, which at one
///         block apiece takes longer than a 20-minute window: the later `setBondingOpenTime` calls
///         arrive quoting an instant that has already passed, and `TimeMustBeInFuture()` refuses
///         them. The window has to outlast the broadcast that sets it. The default below is sized
///         for that, not for how long a curve should stay shut.
///
///         ── WHAT IT REPLAYS ──
///         `deployments/sepolia-seed-finish.json`: the target, value and calldata of each unsent
///         call, in the order phase 1 would have sent them. Taken verbatim from the broadcast
///         artifact forge itself wrote, so the calls are the ones the seed composed rather than a
///         reconstruction of them. A call whose `clock` marker is set carries its selector only and
///         is completed here against a live timestamp.
///
///         Replay is only sound because ORDER is preserved: instance addresses are deterministic in
///         the sequence that creates them, and the featured wall rents by address.
///
///         ── WHAT IT DOES NOT DO ──
///         It does not re-run the alignment wiring, the vaults or the pools. Those landed, they hold
///         real liquidity, and running them again would deploy over live state.
contract SeedSepoliaFinish is Script {
    uint256 internal constant SEPOLIA_CHAIN_ID = 11155111;

    /// @dev Seconds from now until every replayed curve opens. Deliberately far longer than the
    ///      20 minutes phase 1 used: this value must outlast the broadcast that writes it, and the
    ///      original did not. Phase 2 waits it out, so raising it costs wall-clock, not money.
    uint256 internal constant DEFAULT_WINDOW = 3600;

    /// @dev Gap between a row's open time and its maturity, preserved from phase 1's own spacing.
    uint256 internal constant MATURITY_GAP = 120;

    function run() public {
        require(block.chainid == SEPOLIA_CHAIN_ID, "SeedSepoliaFinish: not running against Sepolia");

        string memory raw = vm.readFile("./deployments/sepolia-seed-finish.json");
        address[] memory to = vm.parseJsonAddressArray(raw, ".to");
        uint256[] memory value = vm.parseJsonUintArray(raw, ".value");
        bytes[] memory data = vm.parseJsonBytesArray(raw, ".data");
        uint256[] memory clock = vm.parseJsonUintArray(raw, ".clock");
        require(
            to.length == value.length && to.length == data.length && to.length == clock.length, "manifest: ragged"
        );

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
