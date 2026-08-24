// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { console } from "forge-std/Script.sol";
import { SeedSepoliaShared, IShowcaseCurveState } from "./SeedSepoliaShared.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";

/// @dev The two pool parameters the graduation pool is opened with. Read off the deployed module so
///      the liquidity check below names the pool graduation actually created, not a guess at it.
interface IUniV4DeployerParams {
    function poolFee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function alignmentHookFactory() external view returns (address);
}

/// @notice Sepolia showcase seed, PHASE 2: the buys that produce the mid-curve, ready-to-graduate and
///         graduated states, and the graduation itself.
///
///         Runs after phase 1 and after the arm window has elapsed IN WALL-CLOCK TIME. It must not run
///         before that: `buyBonding` reverts `TooEarly` on an unopened curve, and because forge
///         simulates a script before broadcasting any of it, that revert kills the whole run at
///         SIMULATION and names the buy rather than the missing wait. The guard below fails earlier
///         still, with the seconds remaining, so the operator is never left reading a `TooEarly`.
///
///         Rows are resolved BY NAME from `deployments/sepolia-seed.json`, which phase 1 wrote.
///
///         Run with:
///           forge script script/SeedSepoliaBuys.s.sol --account <keystore> --sender <deployer> \
///             --rpc-url <sepolia-rpc> --broadcast
contract SeedSepoliaBuys is SeedSepoliaShared {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function run() public {
        deployer = msg.sender;

        Deployed memory d = _readDeployed();
        ShowcaseLeg[] memory legs = _showcaseRoster();
        (address[] memory instances, SeedHandoff memory h) = _readSeedState(legs);

        // Written as an `if`/`revert` rather than a `require`, because Solidity evaluates a require's
        // message eagerly: the subtraction that reports the remaining wait underflows on exactly the
        // runs that are supposed to pass.
        if (block.timestamp < h.phase2NotBefore) {
            revert(
                string.concat(
                    "phase 2: the arm window has not elapsed yet - wait ",
                    vm.toString(h.phase2NotBefore - block.timestamp),
                    " more seconds"
                )
            );
        }

        // ── The projection, printed BEFORE anything is broadcast ──
        //
        // Every buy's cost is computed against the supply the curve will actually be at when that buy
        // lands, walking the rows in the same order they are bought. On a public testnet this ETH is a
        // human's faucet balance, so the total has to be visible at simulation time — which is before
        // `--broadcast` sends the first transaction.
        uint256[] memory amounts = new uint256[](legs.length);
        uint256 projected;
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].fillBps == 0) continue;
            ERC404BondingInstance b = ERC404BondingInstance(payable(instances[i]));
            amounts[i] = _fillAmount(b, legs[i].fillBps);
            projected += _buyCost(b, amounts[i]);
        }
        _reportSpend("phase 2 (buys + graduation)", projected, deployer.balance);
        require(deployer.balance > projected, "phase 2: deployer balance does not cover the projected curve spend");

        // ── The buys ──
        uint256 spent;
        for (uint256 i = 0; i < legs.length; i++) {
            if (amounts[i] == 0) continue;
            ERC404BondingInstance b = ERC404BondingInstance(payable(instances[i]));
            // mintNFT: the pieces are half of what a DN404 collection is, and a showcase row whose
            // gallery is empty demonstrates the coin only. The fill is sized in whole units precisely
            // so this mints a countable number of ids rather than a wall of them.
            uint256 cost = _buyBondingMint(b, amounts[i]);
            spent += cost;
            console.log(string.concat("BOUGHT ", legs[i].slug), amounts[i], cost);
        }

        // ── The graduation ──
        uint128 poolLiquidity = _graduate(d, legs, instances);

        _assertShowcaseStates(_states(instances), legs, block.timestamp, poolLiquidity);

        console.log("=== SeedSepoliaBuys (phase 2: buys + graduation) complete ===");
        console.log("  curve ETH spent (wei):", spent);
        console.log("  graduated pool liquidity:", poolLiquidity);
        console.log("  block.timestamp now:", block.timestamp);
        console.log("POST-CONDITIONS OK: pre-open / mid-curve / ready-to-graduate / graduated");
    }

    // ─────────────────────── Fills ───────────────────────

    /// @dev The tokens to buy for a given fill, rounded DOWN to a whole DN404 unit. Whole units are
    ///      what mint pieces; a fill that is not a unit multiple buys coin that shows up in no gallery.
    function _fillAmount(ERC404BondingInstance b, uint256 fillBps) internal view returns (uint256 amount) {
        uint256 unit = b.unit();
        uint256 target = (_bondableRemaining(b) * fillBps) / 10_000;
        amount = (target / unit) * unit;
        require(amount >= unit, "fill: rounds below one whole unit (raise the fill bps)");
    }

    // ─────────────────────── Graduation ───────────────────────

    /// @dev Graduate the row that claims the graduated state and read back the venue pool's liquidity.
    ///
    ///      `deployLiquidity(0)` — no carve. The carve is its own surface with its own disclosure, and
    ///      the row that carries a declared allowance here is the READY row, which is left uncrossed
    ///      so a visitor can perform the graduation (and the carve) themselves. Taking the carve on
    ///      this row would spend the demonstration to reach it.
    function _graduate(Deployed memory d, ShowcaseLeg[] memory legs, address[] memory instances)
        internal
        returns (uint128 liquidity)
    {
        for (uint256 i = 0; i < legs.length; i++) {
            if (legs[i].state != STATE_GRADUATED) continue;
            ERC404BondingInstance b = ERC404BondingInstance(payable(instances[i]));
            require(b.reserve() > 0, string.concat("graduate: ", legs[i].slug, " holds no raise"));

            vm.startBroadcast();
            b.deployLiquidity(0);
            vm.stopBroadcast();

            liquidity = _poolLiquidity(d, instances[i]);
            console.log(string.concat("GRADUATED ", legs[i].slug), instances[i], liquidity);
        }
    }

    /// @dev Live liquidity in the pool graduation opened. The key is rebuilt from the deployer
    ///      module's own immutables — the fee tier, the tick spacing and the hook selection are the
    ///      module's, so reading them back is the only way to name the same pool it created.
    function _poolLiquidity(Deployed memory d, address instance) internal view returns (uint128) {
        IUniV4DeployerParams mod = IUniV4DeployerParams(d.uniDeployer);
        // The hook is only non-zero when an alignment-hook factory has been selected on the module,
        // which ships OFF. Reading it keeps this check correct if that lever is ever turned on.
        require(mod.alignmentHookFactory() == address(0), "pool: an alignment hook is wired - key unknown to the seed");
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(0)), // native ETH sorts below every token
            currency1: Currency.wrap(instance),
            fee: mod.poolFee(),
            tickSpacing: mod.tickSpacing(),
            hooks: IHooks(address(0))
        });
        return IPoolManager(d.v4PoolManager).getLiquidity(key.toId());
    }

    function _states(address[] memory instances) internal pure returns (IShowcaseCurveState[] memory states) {
        states = new IShowcaseCurveState[](instances.length);
        for (uint256 i = 0; i < instances.length; i++) {
            states[i] = IShowcaseCurveState(instances[i]);
        }
    }
}
