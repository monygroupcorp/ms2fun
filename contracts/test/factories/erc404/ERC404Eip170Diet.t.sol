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
 *         Third intervention (noesis-148, "D3"): Token Tiers T2/T3 spent all of 140's budget and the
 *         instance was back to 24,317B — 259B of headroom. The six value-path bodies (`claimFreeMint`,
 *         `claimAllFees`, `withdrawDust`, `stake`, `unstake`, `claimStakingRewards`) moved into
 *         `ERC404BondingOps` behind the same trampoline, for a measured -1,891B: 22,426B, 2,150B of
 *         headroom. Nothing observable changed — the move is byte-for-byte the same bodies.
 *
 *         THE FLOOR (rth ruling, 2026-08-06). This gate used to assert only `< EIP170_LIMIT` and treat
 *         headroom as a log line. It no longer does: the demonstrated failure mode in this contract is
 *         SILENT RE-ACCUMULATION between audits (24,902 -> 24,511 -> 21,386 -> 24,317 over four items),
 *         and a line-ball limit gives no warning until the next item is already undeployable. A
 *         MIN_HEADROOM floor fails the build while there is still room to react. Tripping it is a
 *         BLOCK — re-spec against the remaining budget or take the next diet lever (D2: externalize
 *         the 14 init/admin setters, measured -3,298B). It is NOT to be lowered to make a diff pass.
 *         The same floor is enforced by `test/factories/erc404/eip170-diet-gate.sh`; it is asserted
 *         HERE as well because `forge test` is what CI actually runs.
 *
 *         The storage-layout-equality half of the gate (proving Ops adds ZERO storage outside the shared
 *         `ERC404BondingStorage` base) is a `forge inspect` comparison — see
 *         `test/factories/erc404/eip170-diet-gate.sh`.
 */
contract ERC404Eip170DietTest is Test {
    uint256 internal constant EIP170_LIMIT = 24_576;

    /// @dev rth's D-3 ruling (noesis-148). Keep in lockstep with `MIN_HEADROOM` in eip170-diet-gate.sh.
    uint256 internal constant MIN_HEADROOM = 2_000;

    function test_Eip170_MasterInstanceUnderLimit() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        ERC404BondingInstance impl = new ERC404BondingInstance(address(ops));
        uint256 size = address(impl).code.length;
        assertLt(size, EIP170_LIMIT, "ERC404BondingInstance runtime exceeds EIP-170");
        // History: 24,902B pre-091 (over the limit) -> 24,511B after the reroll externalization ->
        // 21,386B after noesis-140 relocated the DN404Mirror initcode to ERC404Factory -> 24,317B
        // after Token Tiers T2/T3 -> 22,426B after noesis-148's D3 value-path move.
        emit log_named_uint("ERC404BondingInstance runtime bytes", size);
        emit log_named_uint("EIP-170 headroom bytes", EIP170_LIMIT - size);
    }

    /// @notice The headroom FLOOR — the durable half of the noesis-148 diet.
    function test_Eip170_MasterInstanceKeepsHeadroomFloor() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        ERC404BondingInstance impl = new ERC404BondingInstance(address(ops));
        uint256 headroom = EIP170_LIMIT - address(impl).code.length;
        emit log_named_uint("EIP-170 headroom bytes", headroom);
        assertGe(
            headroom,
            MIN_HEADROOM,
            "ERC404BondingInstance headroom below the 2,000B floor - re-spec or take the next diet lever, do NOT lower the floor"
        );
    }

    function test_Eip170_OpsUnderLimit() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        assertLt(address(ops).code.length, EIP170_LIMIT, "ERC404BondingOps runtime exceeds EIP-170");
    }
}
