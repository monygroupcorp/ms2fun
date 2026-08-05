// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "src/factories/erc404/ERC404BondingOps.sol";

/**
 * @title ERC404Eip170Diet
 * @notice Durable EIP-170 gate for the reroll externalization diet (noesis-091). The master
 *         `ERC404BondingInstance` is the deployable implementation behind every EIP-1167 clone, so ITS
 *         runtime bytecode is the EIP-170 subject. Before the diet it was 24,902B (326 OVER the 24,576
 *         limit — undeployable). Externalizing the `rerollSelectedNFTs` body into `ERC404BondingOps`
 *         (reached by a discard-returndata delegatecall trampoline) brings it back under. This test
 *         fails the build the moment either contract crosses the limit again.
 *
 *         Second intervention (noesis-140): the instance had crept back to 24,511B — 65B of headroom,
 *         too thin to build anything on. `initialize` used to do `new DN404Mirror(msg.sender)`, and
 *         `new` is a CREATE: DN404Mirror's entire ~3.1KB of creation code had to be carried inline in
 *         the instance's own runtime bytecode, for a blob that executes exactly once per instance, at
 *         init. Moving that `new` into `ERC404Factory` (which had ~12KB spare) and passing the mirror
 *         into `initialize` dropped the instance to 21,386B — 3,190B of headroom — with no logic
 *         change and no storage-layout change. That is the budget the Token Tiers build spends.
 *
 *         NOTE: this gate asserts only `< EIP170_LIMIT`. There is deliberately NO minimum-headroom
 *         floor and no `--code-size-limit` gate; the logged headroom is context, not a threshold.
 *
 *         The storage-layout-equality half of the gate (proving Ops adds ZERO storage outside the shared
 *         `ERC404BondingStorage` base) is a `forge inspect` comparison — see
 *         `test/factories/erc404/eip170-diet-gate.sh`, which CI runs alongside `forge test`.
 */
contract ERC404Eip170DietTest is Test {
    uint256 internal constant EIP170_LIMIT = 24_576;

    function test_Eip170_MasterInstanceUnderLimit() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        ERC404BondingInstance impl = new ERC404BondingInstance(address(ops));
        uint256 size = address(impl).code.length;
        assertLt(size, EIP170_LIMIT, "ERC404BondingInstance runtime exceeds EIP-170");
        // Context for the log, not a threshold: 24,902B pre-091 (over the limit) -> 24,511B after the
        // reroll externalization -> 21,386B after noesis-140 relocated the DN404Mirror initcode to
        // ERC404Factory. Headroom now ~3,190B.
        emit log_named_uint("ERC404BondingInstance runtime bytes", size);
        emit log_named_uint("EIP-170 headroom bytes", EIP170_LIMIT - size);
    }

    function test_Eip170_OpsUnderLimit() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        assertLt(address(ops).code.length, EIP170_LIMIT, "ERC404BondingOps runtime exceeds EIP-170");
    }
}
