// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IAlignmentVault } from "../../../interfaces/IAlignmentVault.sol";
import { IAlignmentHookFactory } from "./IAlignmentHookFactory.sol";
import { HookAddressMiner } from "./HookAddressMiner.sol";
import { UniAlignmentV4Hook } from "./UniAlignmentV4Hook.sol";

/**
 * @title UniTitheHookFactory
 * @notice Alignment-hook TYPE #1: deploys `UniAlignmentV4Hook` (the ETH swap-tithe hook fixed in #109)
 *         at a Uniswap v4 permission-bit-valid address, one per graduation.
 * @dev Deploy primitive is RAW CREATE2 (`new UniAlignmentV4Hook{salt}(...)`, deployer = this factory) —
 *      NOT the house CreateX/CREATE3 pattern the ERC-x factories use. Uniswap v4 encodes hook
 *      permissions in the low 14 bits of the hook ADDRESS, and `HookAddressMiner.mineSalt` finds a salt
 *      by evaluating the raw CREATE2 formula `keccak256(0xff, deployer, salt, initCodeHash)`. CreateX's
 *      CREATE3 derives the address from a keccak-of-proxy indirection that does not fit that formula, so
 *      it cannot produce a permission-bit-constrained address. Hence raw CREATE2 with the mined salt.
 *
 *      PoolManager, WETH and the hook owner are factory immutables (set at factory deploy by 117b /
 *      DeployCore); `deployHook` supplies only the per-graduation data (vault, benefactor, fees). The
 *      hook constructor's `validateHookPermissions()` is the on-chain guard against a bad address.
 *
 *      The mined ADDRESS is not fixed across attempts: the scan starts at a block-derived offset so that
 *      a mine which does not fit in one block is retryable in the next rather than repeating itself. What
 *      IS fixed is the hook's IDENTITY — the init-code hash over the creation code and all seven
 *      constructor arguments — and `deployedHook` keys on that, so one parameterization yields one hook.
 *
 *      RE-AUDIT BEFORE DEPLOY: this contract deploys a fee-taking v4 hook via CREATE2 + on-chain mine.
 */
contract UniTitheHookFactory is IAlignmentHookFactory {
    /// @notice Uniswap v4 PoolManager the deployed hooks bind to (immutable, factory config).
    IPoolManager public immutable poolManager;

    /// @notice WETH address passed to each deployed hook (immutable, factory config).
    address public immutable weth;

    /// @notice Governance owner set on each deployed hook (can adjust its LP fee rate).
    address public immutable hookOwner;

    /// @notice Required permission bits (0xCC = beforeSwap|afterSwap|beforeSwapReturnDelta|afterSwapReturnDelta).
    uint160 public constant REQUIRED_FLAGS = HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS;

    /// @notice Forbidden permission bits (all other hook flags — the complement of REQUIRED_FLAGS).
    uint160 public constant FORBIDDEN_FLAGS = HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS;

    /// @notice The hook this factory has already deployed for a given init-code hash, if any.
    /// @dev Adoption is keyed on IDENTITY, not on a mined address. `initCodeHash` commits to the hook's
    ///      creation code and to all seven constructor arguments, so an entry here means exactly "this
    ///      hook, with this parameterization, already exists" — whichever salt found it. That distinction
    ///      is load-bearing now that the mine's starting offset varies per block: a second call mines a
    ///      different salt and therefore a different candidate address, so an address-only check would
    ///      find empty code there and deploy a duplicate hook instead of adopting the existing one.
    mapping(bytes32 initCodeHash => address hook) public deployedHook;

    error InvalidAddress();

    /// @notice Emitted for every hook this factory deploys.
    event AlignmentHookDeployed(
        address indexed hook, address indexed vault, address indexed benefactor, uint256 hookFeeBips, uint24 lpFeeRate
    );

    /// @notice Emitted when `deployHook` returns the hook already present at the deterministic address.
    /// @dev Same shape as `AlignmentHookDeployed`, kept as a distinct topic so an adoption is
    ///      distinguishable on-chain from a fresh deploy.
    event AlignmentHookAdopted(
        address indexed hook, address indexed vault, address indexed benefactor, uint256 hookFeeBips, uint24 lpFeeRate
    );

    constructor(IPoolManager _poolManager, address _weth, address _hookOwner) {
        if (address(_poolManager) == address(0)) revert InvalidAddress();
        if (_weth == address(0)) revert InvalidAddress();
        if (_hookOwner == address(0)) revert InvalidAddress();
        poolManager = _poolManager;
        weth = _weth;
        hookOwner = _hookOwner;
    }

    /// @inheritdoc IAlignmentHookFactory
    function deployHook(IAlignmentVault vault, address benefactor, uint256 hookFeeBips, uint24 lpFeeRate)
        external
        returns (address hook)
    {
        // Init code exactly as `new UniAlignmentV4Hook{salt}(...)` below assembles it: creation code ++
        // abi.encode(ALL seven constructor args, in order). Both the mine and the deploy derive their
        // address from THIS hash, and it is computed by the shared HookAddressMiner.computeInitCodeHash
        // helper — the single source of truth for the init-code hash, so factory and helper can never
        // disagree about the deployed address.
        bytes32 initCodeHash = HookAddressMiner.computeInitCodeHash(
            type(UniAlignmentV4Hook).creationCode,
            address(poolManager),
            address(vault),
            weth,
            hookOwner,
            benefactor,
            hookFeeBips,
            lpFeeRate
        );

        // Idempotent deploy, checked BEFORE the mine: `deployHook` is callable by anyone, and its four
        // arguments are derivable from public state, so the hook for a pending graduation can be deployed
        // ahead of that graduation. Adopt what is already there and let the graduation proceed, rather
        // than reverting on a CREATE2 collision and leaving the pool un-graduatable — the same posture as
        // `LiquidityDeployerModule._initOrValidatePool`, which accepts a pre-initialized pool.
        //
        // The key is the init-code hash, which commits to the creation code and to all seven constructor
        // arguments, so a hit is precisely "this hook, this parameterization, already deployed by this
        // factory". Reading it first also means an adoption pays no mining gas at all.
        address adopted = deployedHook[initCodeHash];
        if (adopted != address(0)) {
            emit AlignmentHookAdopted(adopted, address(vault), benefactor, hookFeeBips, lpFeeRate);
            return adopted;
        }

        // Start the salt scan at a block-derived offset. The mine's inputs — this factory, the init-code
        // hash, and the flag masks — are all fixed for a given hook parameterization, so a scan that
        // always began at zero would walk the identical salts and burn the identical gas on every call:
        // if the search does not fit in one block, no retry ever would. A retry lands in a later block,
        // draws a different `prevrandao` and `number`, and therefore scans a different window.
        //
        // MANIPULABILITY: `block.prevrandao` is influenceable at the margin by a proposer, and that does
        // not matter here. Every salt whose address carries exactly the required bits is equally
        // acceptable; there is no property of the resulting address an adversary gains from steering, and
        // the offset changes only WHICH valid address is found, never WHETHER it is valid. The hook
        // constructor's `validateHookPermissions()` remains the on-chain check on the permission bits.
        uint256 startOffset = uint256(keccak256(abi.encode(block.prevrandao, block.number, initCodeHash)));

        // Mine a salt so the CREATE2 address carries EXACTLY the 0xCC permission bits. The scan covers
        // HookAddressMiner.SCAN_WINDOW salts, sized to fit in a 30M-gas block alongside the rest of a
        // graduation; for 0xCC the expected hit is ~2^14 iterations, well inside the window. Exhausting
        // the window reverts `NoValidSaltFound` — a cheap, named failure the next block can retry against
        // a fresh window — instead of running the block out of gas.
        (bytes32 salt, address predicted) =
            HookAddressMiner.mineSalt(address(this), initCodeHash, REQUIRED_FLAGS, FORBIDDEN_FLAGS, startOffset);

        // Belt and braces for a hook that reached this address by a path that did not write the mapping:
        // the address is CREATE2-derived from (this factory, salt, initCodeHash), so only this factory can
        // occupy it, and only with an init code hashing to `initCodeHash`. Code there is therefore this
        // hook with this parameterization. Record it so later calls adopt without mining.
        if (predicted.code.length != 0) {
            deployedHook[initCodeHash] = predicted;
            emit AlignmentHookAdopted(predicted, address(vault), benefactor, hookFeeBips, lpFeeRate);
            return predicted;
        }

        // `new C{salt}(args)` deploys at keccak256(0xff, address(this), salt, keccak256(creationCode ++
        // abi.encode(args)))[12:], which is `predicted` by construction: the mine derived it from the same
        // deployer, the same salt, and an init code hash built from this creation code and these seven
        // arguments in this order. An equality check here could not fail, so the property is asserted in
        // the tests (a hook deployed through this function lands on the independently derived address)
        // rather than as an unreachable runtime branch. The hook constructor's `validateHookPermissions()`
        // remains the on-chain guard that the address carries the required permission bits.
        hook = address(
            new UniAlignmentV4Hook{ salt: salt }(
                poolManager, vault, weth, hookOwner, benefactor, hookFeeBips, lpFeeRate
            )
        );

        deployedHook[initCodeHash] = hook;
        emit AlignmentHookDeployed(hook, address(vault), benefactor, hookFeeBips, lpFeeRate);
    }

    /// @inheritdoc IAlignmentHookFactory
    function hookFlags() external pure returns (uint160 required, uint160 forbidden) {
        return (REQUIRED_FLAGS, FORBIDDEN_FLAGS);
    }
}
