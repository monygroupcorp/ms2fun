// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { Timelock } from "solady/accounts/Timelock.sol";

contract DeployTimelock is Script {
    /// @dev The mainnet delay and the default. The delay is the window in which a proposal that
    ///      should not land can be seen and cancelled.
    uint256 public constant MIN_DELAY = 24 hours; // 86400 seconds

    function run() external {
        address safe = vm.envAddress("SAFE_ADDRESS");
        // TIMELOCK_MIN_DELAY shortens the delay on testnet, where a 24h wait between proposing the
        // ownership handover and executing it adds no safety. Unset, it is the mainnet delay, so a
        // mainnet deploy that omits the variable gets the safe value.
        uint256 minDelay = vm.envOr("TIMELOCK_MIN_DELAY", MIN_DELAY);

        // No argument: forge supplies the signer from `--account <keystore>` (or `--ledger`), so the
        // deployer key is never in this process's environment. DeploySepolia broadcasts the same way.
        vm.startBroadcast();

        // Not behind a proxy: a timelock is immutable.
        Timelock timelock = new Timelock();
        console.log("Timelock deployed at:", address(timelock));

        address[] memory proposers = new address[](1);
        proposers[0] = safe;

        address[] memory executors = new address[](1);
        executors[0] = timelock.OPEN_ROLE_HOLDER(); // Anyone can execute after delay

        address[] memory cancellers = new address[](1);
        cancellers[0] = safe;

        // Safe is admin/proposer/canceller; the executor role is open.
        timelock.initialize(minDelay, safe, proposers, executors, cancellers);
        console.log("Timelock initialized with min delay:", minDelay);
        console.log("Safe (admin/proposer/canceller):", safe);

        vm.stopBroadcast();
    }
}
