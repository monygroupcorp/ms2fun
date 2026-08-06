// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance, InvalidOps } from "src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "src/factories/erc404/ERC404BondingOps.sol";

/**
 * @title ERC404OpsCodeGuardTest
 * @notice noesis-150. `delegatecall` to an address with NO CODE returns success and writes nothing.
 *         Every externalized entry point on `ERC404BondingInstance` is a trampoline whose only failure
 *         check is that boolean:
 *
 *             (bool ok,) = _ops.delegatecall(msg.data);
 *             if (!ok) revert XFailed();
 *
 *         so a master deployed with a code-less `ops` turns every one of them into a SILENT NO-OP —
 *         the call succeeds, no state changes, nothing reverts. After noesis-091/-142/-148/-149 that is
 *         the majority of the contract's write surface, including `initTierBands` (the ladder SEAL,
 *         which T3's burn-safety hook assumes) and `initializeProtocol`/`initModule` (both called by
 *         `ERC404Factory.createInstance`, so a misconfigured master yields launches that report success
 *         and are silently broken).
 *
 *         The constructor now rejects it. These tests pin the guard, and specifically pin that it is a
 *         CODE-LENGTH check and not a zero-address check: a non-zero EOA is exactly as broken as
 *         `address(0)`, and a naive `ops == address(0)` guard would wave it through.
 *
 *         Byte budget: the guard is CONSTRUCTOR code, so the EIP-170 subject (`deployedBytecode`) is
 *         untouched. That is asserted where it belongs — `ERC404Eip170Diet.t.sol` and
 *         `eip170-diet-gate.sh`, both of which still pass — not pinned to a literal here.
 */
contract ERC404OpsCodeGuardTest is Test {
    function test_Constructor_RevertsOnZeroOps() public {
        vm.expectRevert(InvalidOps.selector);
        new ERC404BondingInstance(address(0));
    }

    /// @dev THE point of the item: a non-zero address with no code is the case a zero-check misses.
    function test_Constructor_RevertsOnCodelessEoaOps() public {
        address eoa = makeAddr("codelessOps");
        assertEq(eoa.code.length, 0, "fixture must be code-less");
        vm.expectRevert(InvalidOps.selector);
        new ERC404BondingInstance(eoa);
    }

    /// @dev A contract that is not `ERC404BondingOps` still passes — this guard is a code-length check,
    ///      not a type check. It closes the "silently successful launch" class (delegatecall to nothing),
    ///      which is the only failure mode a constructor can see; wiring the WRONG contract is a
    ///      different check (`ERC404OpsSelectorParity.t.sol`), not this one.
    function test_Constructor_AcceptsAnyContractWithCode() public {
        ERC404BondingInstance impl = new ERC404BondingInstance(address(new OpsCodeGuardStub()));
        assertGt(address(impl).code.length, 0, "master must deploy");
    }

    function test_Constructor_AcceptsRealOps() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        ERC404BondingInstance impl = new ERC404BondingInstance(address(ops));
        assertGt(address(impl).code.length, 0, "master must deploy with a real Ops");
    }
}

/// @dev Minimal contract used only to prove the guard checks CODE, not the ops type.
contract OpsCodeGuardStub {
    function ping() external pure returns (uint256) {
        return 1;
    }
}
