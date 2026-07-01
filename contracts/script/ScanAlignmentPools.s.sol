// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {IZAMM} from "../src/vaults/zamm/ZAMMAlignmentVault.sol";

interface IERC20Decimals {
    function decimals() external view returns (uint8);
    function symbol() external view returns (string memory);
}

interface IUniV3Factory {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface IUniV3Pool {
    function liquidity() external view returns (uint128);
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool);
}

interface IAlgebraFactory {
    function poolByPair(address a, address b) external view returns (address);
}

interface IAlgebraPool {
    function liquidity() external view returns (uint128);
    function globalState() external view returns (uint160 price, int24 tick, uint16, uint16, uint8, bool);
}

/// @title ScanAlignmentPools
/// @notice **Admin tool** — scan the on-chain LP pools an alignment target's token can be wired into,
///         per venue, and recommend the deepest (which becomes the vault's pool key). Run per token
///         when bringing a new alignment target online, on a mainnet archive fork. Read-only.
///
///         Answers "which fee tier / venue has the liquidity?" with measurement instead of the
///         hardcoded tier the deploy scripts currently bake (resolves vault-flavors O3). The Uni V4
///         native-ETH pools are the wireable target for the UniswapV4LP vault; V3/ZAMM/Cypher are
///         reported so the admin sees the full LP-family picture across venues.
///
///         Run:
///           forge script script/ScanAlignmentPools.s.sol \
///             --sig "run(address)" <ALIGNMENT_TOKEN> --fork-url $MAINNET_RPC_URL
contract ScanAlignmentPools is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    // Mainnet singletons (present on a mainnet fork).
    address constant WETH        = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant V4_PM       = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address constant V3_FACTORY  = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address constant ZAMM        = 0x000000000000040470635EB91b7CE4D132D616eD;
    address constant CYPHER_FACTORY = 0xfb8Ed3485EfA29a0e4bed93351dD51B59fC4b0f0; // Algebra Integral

    uint24[4]  FEES      = [uint24(100), 500, 3000, 10000];
    int24[4]   SPACINGS  = [int24(1), 10, 60, 200];
    // Best-effort ZAMM fee/hook selectors to probe (ZAMM's fee scale is pool-defined; extend as needed).
    uint256[4] ZAMM_FEES = [uint256(1), 30, 100, 3000];

    struct Best { uint24 fee; int24 spacing; uint128 liq; bool found; }

    function run(address token) external view {
        require(token != address(0), "token required");
        string memory sym = _symbol(token);
        console.log("\n=== Alignment pool scan ===");
        console.log("token:", token, sym);
        console.log("(depth = active in-range liquidity L; higher = deeper. $TVL needs an indexer.)\n");

        Best memory best = _scanUniV4Native(token);
        _scanUniV3(token);
        _scanZamm(token);
        _scanCypher(token);

        console.log("\n--- RECOMMENDATION (UniswapV4LP vault pool key) ---");
        if (best.found) {
            console.log("  deepest native-ETH V4 pool: fee", best.fee, _bps(best.fee));
            console.log("  tickSpacing:", vm.toString(best.spacing), " hooks: 0x0 (hookless)");
            console.log("  active liquidity L:", best.liq);
            console.log("  -> wire setVaultPoolKey(vault, {currency0: ETH, currency1: token, fee, tickSpacing, hooks: 0})");
        } else {
            console.log("  NO native-ETH V4 pool found for this token across standard tiers.");
            console.log("  The UniswapV4LP vault needs a native-ETH pool - none exists yet.");
            console.log("  Options: seed/init one, choose a different venue (ZAMM/Cypher), or a different token.");
        }
        console.log("");
    }

    // ── Uni V4 (native ETH) — the wireable target ────────────────────────────
    function _scanUniV4Native(address token) internal view returns (Best memory best) {
        console.log("-- Uniswap V4 (native ETH / token) [WIREABLE] --");
        IPoolManager pm = IPoolManager(V4_PM);
        for (uint256 i = 0; i < FEES.length; i++) {
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(address(0)), // native ETH < any token
                currency1: Currency.wrap(token),
                fee: FEES[i],
                tickSpacing: SPACINGS[i],
                hooks: IHooks(address(0))
            });
            PoolId id = key.toId();
            (uint160 sqrtP,,,) = pm.getSlot0(id);
            if (sqrtP == 0) { console.log("   fee", FEES[i], "-> not initialized"); continue; }
            uint128 liq = pm.getLiquidity(id);
            console.log("   fee", FEES[i], _bps(FEES[i]));
            console.log("      liquidity L:", liq);
            console.log("      sqrtPriceX96:", sqrtP);
            if (liq > best.liq) best = Best(FEES[i], SPACINGS[i], liq, true);
        }
        if (!best.found) console.log("   (none initialized)");
    }

    // ── Uni V3 (WETH/token) — reference only (the vault LPs into V4, not V3) ──
    function _scanUniV3(address token) internal view {
        console.log("-- Uniswap V3 (WETH / token) [reference] --");
        for (uint256 i = 0; i < FEES.length; i++) {
            address pool = IUniV3Factory(V3_FACTORY).getPool(WETH, token, FEES[i]);
            if (pool == address(0)) { console.log("   fee", FEES[i], "-> no pool"); continue; }
            uint128 liq = IUniV3Pool(pool).liquidity();
            console.log("   fee", FEES[i], _bps(FEES[i]));
            console.log("      pool:", pool);
            console.log("      liquidity L:", liq);
        }
    }

    // ── ZAMM — best-effort (fee/hook selector is pool-defined) ────────────────
    function _scanZamm(address token) internal view {
        console.log("-- ZAMM (ETH / token) [ZAMMLP vault] --");
        bool any;
        for (uint256 i = 0; i < ZAMM_FEES.length; i++) {
            IZAMM.PoolKey memory key = IZAMM.PoolKey({
                id0: 0, id1: 0, token0: address(0), token1: token, feeOrHook: ZAMM_FEES[i]
            });
            uint256 poolId = uint256(keccak256(abi.encode(key)));
            IZAMM.Pool memory p = IZAMM(ZAMM).pools(poolId);
            if (p.reserve0 == 0 && p.reserve1 == 0) continue;
            any = true;
            console.log("   feeOrHook", ZAMM_FEES[i], "-> reserves:");
            console.log("      reserve0 (ETH):", uint256(p.reserve0));
            console.log("      reserve1 (token):", uint256(p.reserve1));
        }
        if (!any) console.log("   no pool found for probed feeOrHook selectors {1,30,100,3000} - check the ZAMM app for the real one.");
    }

    // ── Cypher (Algebra Integral, WETH/token) — dynamic-fee single pool ───────
    function _scanCypher(address token) internal view {
        console.log("-- Cypher / Algebra (WETH / token) [CypherLP vault] --");
        address pool = IAlgebraFactory(CYPHER_FACTORY).poolByPair(WETH, token);
        if (pool == address(0)) { console.log("   no Algebra pool for this pair."); return; }
        uint128 liq = IAlgebraPool(pool).liquidity();
        console.log("   pool:", pool);
        console.log("   liquidity L:", liq);
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    function _symbol(address token) internal view returns (string memory) {
        try IERC20Decimals(token).symbol() returns (string memory s) { return s; } catch { return "?"; }
    }

    function _bps(uint24 fee) internal pure returns (string memory) {
        if (fee == 100) return "(0.01%)";
        if (fee == 500) return "(0.05%)";
        if (fee == 3000) return "(0.30%)";
        if (fee == 10000) return "(1.00%)";
        return "";
    }
}
