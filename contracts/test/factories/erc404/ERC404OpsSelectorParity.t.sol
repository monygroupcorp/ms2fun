// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "../../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../../src/factories/erc404/ERC404BondingOps.sol";

/**
 * @title ERC404OpsSelectorParityTest
 * @notice The externalization diet (noesis-091 reroll, -142 tier ops, -148 value paths, -149 config
 *         paths) rests on ONE unstated assumption: every `ERC404BondingInstance` trampoline forwards raw
 *         `msg.data` to `ERC404BondingOps`, so the two declarations of each function must have a
 *         BYTE-IDENTICAL selector. If a parameter type ever drifts on one side, the delegatecall lands on
 *         a selector Ops does not implement — Ops has no fallback, so the call reverts and the entry point
 *         becomes permanently dead, surfacing only as that trampoline's generic error. The compiler cannot
 *         catch it (the two contracts are compiled independently) and the storage-layout gate cannot
 *         either (selectors are not layout).
 *
 * @dev This is the guard. It is cheap, exhaustive over every externalized entry point, and it is the ONLY
 *      thing standing between `ERC404BondingOps.ProtocolParams` and `ERC404BondingInstance.ProtocolParams`
 *      — two separately-declared structs that MUST stay field-for-field identical. They are deliberately
 *      not hoisted into the shared `ERC404BondingStorage` base: Solidity does not expose an inherited
 *      struct through a derived contract's name, so hoisting would break every
 *      `ERC404BondingInstance.ProtocolParams` reference in `ERC404Factory` and the test tree.
 */
contract ERC404OpsSelectorParityTest is Test {
    function _assertParity(bytes4 instanceSel, bytes4 opsSel, string memory what) internal pure {
        assertEq(instanceSel, opsSel, what);
    }

    // ── noesis-149: the thirteen config paths ────────────────────────────────────────────────────

    function test_configSelectorsMatchAcrossTheDelegatecallSeam() public pure {
        _assertParity(
            ERC404BondingInstance.initializeProtocol.selector,
            ERC404BondingOps.initializeProtocol.selector,
            "initializeProtocol: the ProtocolParams tuple must stay field-for-field identical"
        );
        _assertParity(
            ERC404BondingInstance.setMetadataURI.selector, ERC404BondingOps.setMetadataURI.selector, "setMetadataURI"
        );
        _assertParity(
            ERC404BondingInstance.initializeFreeMint.selector,
            ERC404BondingOps.initializeFreeMint.selector,
            "initializeFreeMint"
        );
        _assertParity(
            ERC404BondingInstance.initTierBands.selector, ERC404BondingOps.initTierBands.selector, "initTierBands"
        );
        _assertParity(
            ERC404BondingInstance.initializeStaking.selector,
            ERC404BondingOps.initializeStaking.selector,
            "initializeStaking"
        );
        _assertParity(ERC404BondingInstance.initModule.selector, ERC404BondingOps.initModule.selector, "initModule");
        _assertParity(
            ERC404BondingInstance.setAgentDelegation.selector,
            ERC404BondingOps.setAgentDelegation.selector,
            "setAgentDelegation"
        );
        _assertParity(
            ERC404BondingInstance.setAgentDelegationFromFactory.selector,
            ERC404BondingOps.setAgentDelegationFromFactory.selector,
            "setAgentDelegationFromFactory"
        );
        _assertParity(
            ERC404BondingInstance.setBondingOpenTime.selector,
            ERC404BondingOps.setBondingOpenTime.selector,
            "setBondingOpenTime"
        );
        _assertParity(
            ERC404BondingInstance.setBondingMaturityTime.selector,
            ERC404BondingOps.setBondingMaturityTime.selector,
            "setBondingMaturityTime"
        );
        _assertParity(
            ERC404BondingInstance.setBondingActive.selector,
            ERC404BondingOps.setBondingActive.selector,
            "setBondingActive"
        );
        _assertParity(ERC404BondingInstance.setStyle.selector, ERC404BondingOps.setStyle.selector, "setStyle");
        _assertParity(
            ERC404BondingInstance.activateStaking.selector, ERC404BondingOps.activateStaking.selector, "activateStaking"
        );
    }

    /// @dev Pinned literal, independent of both declarations: if BOTH sides drifted the same way the
    ///      pairwise check above would still pass, but the on-chain ABI would have silently changed.
    ///      `initializeProtocol((address,address,address,uint256,address))`.
    function test_initializeProtocolSelectorIsTheHistoricOne() public pure {
        bytes4 pinned = bytes4(keccak256("initializeProtocol((address,address,address,uint256,address))"));
        assertEq(ERC404BondingInstance.initializeProtocol.selector, pinned, "instance ABI moved");
        assertEq(ERC404BondingOps.initializeProtocol.selector, pinned, "ops ABI moved");
    }

    // ── noesis-091 / -142 / -148: everything externalized before this item ───────────────────────

    function test_priorDietSelectorsMatchAcrossTheDelegatecallSeam() public pure {
        _assertParity(
            ERC404BondingInstance.rerollSelectedNFTs.selector,
            ERC404BondingOps.rerollSelectedNFTs.selector,
            "rerollSelectedNFTs"
        );
        _assertParity(ERC404BondingInstance.mintUp.selector, ERC404BondingOps.mintUp.selector, "mintUp");
        _assertParity(ERC404BondingInstance.mintDown.selector, ERC404BondingOps.mintDown.selector, "mintDown");
        _assertParity(
            ERC404BondingInstance.claimFreeMint.selector, ERC404BondingOps.claimFreeMint.selector, "claimFreeMint"
        );
        _assertParity(
            ERC404BondingInstance.claimAllFees.selector, ERC404BondingOps.claimAllFees.selector, "claimAllFees"
        );
        _assertParity(
            ERC404BondingInstance.withdrawDust.selector, ERC404BondingOps.withdrawDust.selector, "withdrawDust"
        );
        _assertParity(ERC404BondingInstance.stake.selector, ERC404BondingOps.stake.selector, "stake");
        _assertParity(ERC404BondingInstance.unstake.selector, ERC404BondingOps.unstake.selector, "unstake");
        _assertParity(
            ERC404BondingInstance.claimStakingRewards.selector,
            ERC404BondingOps.claimStakingRewards.selector,
            "claimStakingRewards"
        );
    }

    /// @notice The three bodies that deliberately did NOT move must have NO counterpart on Ops — if one
    ///         ever appears there, the "value-extracting fns stay in the instance" boundary has moved
    ///         without anyone deciding to move it.
    /// @dev `migrateVault` is also noesis-148's CONTROL for the error-collapse argument, so its staying
    ///      put is load-bearing for the auth-boundary suites, not just for the boundary itself.
    function test_valueAndInitBodiesHaveNoOpsCounterpart() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        bytes4[] memory mustBeAbsent = new bytes4[](3);
        mustBeAbsent[0] = bytes4(keccak256("migrateVault(address)"));
        mustBeAbsent[1] = bytes4(
            keccak256(
                "initialize(address,address,(uint256,uint256,uint256,uint16,(uint256,uint256,uint256,uint256,uint256)),address,address,address)"
            )
        );
        mustBeAbsent[2] = bytes4(keccak256("initializeMetadata(string,string,string,string)"));

        for (uint256 i = 0; i < mustBeAbsent.length; i++) {
            (bool ok,) = address(ops).call(abi.encodeWithSelector(mustBeAbsent[i]));
            // Ops declares no fallback and no receive, so an unimplemented selector always reverts.
            assertFalse(ok, "Ops implements a selector that must have stayed in the instance");
        }
    }
}
