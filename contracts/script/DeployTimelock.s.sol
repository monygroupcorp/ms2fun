// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { Timelock } from "solady/accounts/Timelock.sol";

contract DeployTimelock is Script {
    /// @dev The mainnet delay, and the default everywhere. A timelock's delay is the whole of what it
    ///      buys: it is the window in which a proposal that should not land can be seen and cancelled.
    uint256 public constant MIN_DELAY = 24 hours; // 86400 seconds

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address safe = vm.envAddress("SAFE_ADDRESS");
        // TIMELOCK_MIN_DELAY exists for testnet, where a 24h wait between proposing the ownership
        // handover and executing it makes the rehearsal a two-day operation for no safety gained —
        // nothing on Sepolia is worth cancelling a proposal over. Unset, this is the mainnet delay
        // unchanged, so a mainnet deploy that forgets the variable gets the safe value rather than
        // whatever the last testnet run used.
        uint256 minDelay = vm.envOr("TIMELOCK_MIN_DELAY", MIN_DELAY);

        vm.startBroadcast(deployerPrivateKey);

        // Deploy Timelock directly (not behind a proxy — timelocks should be immutable)
        Timelock timelock = new Timelock();
        console.log("Timelock deployed at:", address(timelock));

        // Configure roles
        address[] memory proposers = new address[](1);
        proposers[0] = safe;

        address[] memory executors = new address[](1);
        executors[0] = timelock.OPEN_ROLE_HOLDER(); // Anyone can execute after delay

        address[] memory cancellers = new address[](1);
        cancellers[0] = safe;

        // Initialize: 24h delay, Safe as admin/proposer/canceller, open executor
        timelock.initialize(minDelay, safe, proposers, executors, cancellers);
        console.log("Timelock initialized with min delay:", minDelay);
        console.log("Safe (admin/proposer/canceller):", safe);

        vm.stopBroadcast();
    }
}
