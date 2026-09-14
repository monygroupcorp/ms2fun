// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console } from "forge-std/Test.sol";
import { QueryAggregator } from "../../src/query/QueryAggregator.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";

/// @dev A stand-in ERC404 sized by the two things that drive the lens's cost: how many ids the holder
///      owns (`coinBalanceOf` walks them) and whether the instance answers the noesis-316 symbols.
contract GasProbeInstance {
    uint256 public immutable ownedIds;
    bool public immutable tiered;

    constructor(uint256 ownedIds_, bool tiered_) {
        ownedIds = ownedIds_;
        tiered = tiered_;
    }

    function instanceType() external pure returns (bytes32) {
        return keccak256("erc404");
    }

    function balanceOf(address) external view returns (uint256) {
        return ownedIds * 1e24;
    }

    function unit() external pure returns (uint256) {
        return 1e24;
    }

    /// @dev The real `coinBalanceOf` walks the holder's owned ids and asks `_bandOf` for each. The loop
    ///      here reproduces that shape — one SLOAD-free band test per owned id — so the measurement
    ///      prices the WALK, which is what makes this read cost more than a plain `balanceOf`.
    function coinBalanceOf(address) external view returns (uint256 total) {
        total = ownedIds * 1e24;
        if (!tiered) return total;
        uint256 n = ownedIds;
        for (uint256 i = 0; i < n; i++) {
            total += 9e24;
        }
    }

    function pendingEscrowRelease(address) external view returns (uint256) {
        return tiered ? 9e24 : 0;
    }

    function stakingModule() external pure returns (address) {
        return address(0);
    }
}

contract GasProbeRegistry {
    function getInstanceInfo(address instance) external pure returns (IMasterRegistry.InstanceInfo memory info) {
        info.instance = instance;
        info.name = "P";
    }
}

contract GasProbeFQM {
    function getFeaturedInstances(uint256, uint256) external pure returns (address[] memory a, uint256 t) {
        a = new address[](0);
        t = 0;
    }
}

/**
 * @title QueryAggregatorPortfolioGas
 * @notice noesis-316 clause 12 — what a 50-instance portfolio batch costs as ONE eth_call.
 * @dev 50 is not an arbitrary round number: it is `QueryAggregator.MAX_QUERY_LIMIT`, the largest batch
 *      `getPortfolioData` will accept, so these are the worst cases the endpoint can be asked for.
 *
 *      MEASURED 2026-09-14 on this branch, and reproducible with
 *        forge test --match-path test/query/QueryAggregatorPortfolioGas.t.sol -vv
 *      Baseline is the same test with the two option-A reads deleted from `_getERC404Holding`:
 *
 *        shape                     baseline     option A     delta
 *        untiered, 1 id each      1,199,069    1,414,190    +215,121   (+18%)
 *        tiered,  10 ids each     1,192,978    1,450,849    +257,871   (+22%)
 *        tiered, 200 ids each     1,197,739    2,253,610  +1,055,871   (+88%)
 *
 *      Two things the shape of that table says. The flat cost is about 4.3k gas per instance — two
 *      guarded self-calls — and it is paid whether or not the instance has a ladder. The variable cost
 *      is `coinBalanceOf` walking the holder's owned ids, which is why only the option-A column moves
 *      with `idsEach`: a whale in 50 tiered collections pays roughly five times the flat cost. The
 *      worst case measured here is 4.5% of a node's eth_call ceiling, so the read is affordable at the
 *      cap; it is the SCALING, not today's number, that is the thing to watch if the id walk ever has
 *      to serve holders an order of magnitude fatter than this.
 *
 *      This is a MEASUREMENT, not a gate. It prints; it asserts only the one thing worth failing on,
 *      that the worst case stays under a node's default `eth_call` ceiling. The numbers it prints are
 *      what clause 12 records, and they are read off `gasleft()` around the call itself so that test
 *      setup is outside the measurement.
 */
contract QueryAggregatorPortfolioGasTest is Test {
    QueryAggregator internal agg;
    address internal user = makeAddr("holder");

    /// @dev Geth's default `--rpc.gascap`, the ceiling a public node applies to one eth_call.
    uint256 constant ETH_CALL_GAS_CAP = 50_000_000;

    function setUp() public {
        agg = new QueryAggregator();
        agg.initialize(address(new GasProbeRegistry()), address(new GasProbeFQM()), address(0), makeAddr("o"));
    }

    function _batch(uint256 n, uint256 idsEach, bool tiered) internal returns (uint256 gasUsed, uint256 rows) {
        address[] memory instances = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            instances[i] = address(new GasProbeInstance(idsEach, tiered));
        }
        address[] memory vaults = new address[](0);

        uint256 before_ = gasleft();
        (QueryAggregator.ERC404Holding[] memory got,,,,) = agg.getPortfolioData(user, instances, vaults);
        gasUsed = before_ - gasleft();
        rows = got.length;
    }

    function test_gas_50InstanceBatch() public {
        (uint256 untieredGas, uint256 rowsA) = _batch(50, 1, false);
        (uint256 tieredSmallGas, uint256 rowsB) = _batch(50, 10, true);
        (uint256 tieredFatGas, uint256 rowsC) = _batch(50, 200, true);

        assertEq(rowsA, 50, "every instance produced a row");
        assertEq(rowsB, 50, "every instance produced a row");
        assertEq(rowsC, 50, "every instance produced a row");

        console.log("noesis-316 clause 12 - getPortfolioData, 50 instances (MAX_QUERY_LIMIT), one eth_call");
        console.log("  untiered, 1 id each       gas:", untieredGas);
        console.log("  tiered,  10 ids each      gas:", tieredSmallGas);
        console.log("  tiered, 200 ids each      gas:", tieredFatGas);
        console.log("  node eth_call gas cap        :", ETH_CALL_GAS_CAP);

        assertLt(tieredFatGas, ETH_CALL_GAS_CAP, "the worst 50-instance batch fits in one eth_call");
    }
}
