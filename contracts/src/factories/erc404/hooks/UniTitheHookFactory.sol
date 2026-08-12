// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IAlignmentVault } from "../../../interfaces/IAlignmentVault.sol";
import { IAlignmentHookFactory } from "./IAlignmentHookFactory.sol";
import { HookAddressMiner } from "./HookAddressMiner.sol";
import { UniAlignmentV4Hook } from "./UniAlignmentV4Hook.sol";

/**
 * @title UniTitheHookFactory
 * @notice Alignment-hook TYPE #1: deterministically deploys `UniAlignmentV4Hook` (the ETH swap-tithe
 *         hook fixed in #109) at a Uniswap v4 permission-bit-valid address, one per graduation.
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

        // On-chain mine a salt so the CREATE2 address carries EXACTLY the 0xCC permission bits. Capped at
        // HookAddressMiner.MAX_ITERATIONS; for 0xCC the expected hit is ~2^14 iters, far under the cap.
        (bytes32 salt, address predicted) =
            HookAddressMiner.mineSalt(address(this), initCodeHash, REQUIRED_FLAGS, FORBIDDEN_FLAGS);

        // Idempotent deploy: `deployHook` is callable by anyone, and its four arguments are derivable from
        // public state, so the hook for a pending graduation can be deployed ahead of that graduation. The
        // address is CREATE2-derived from (this factory, salt, initCodeHash), so ONLY this factory can
        // occupy it, and only by running this same function with an init code hashing to `initCodeHash` —
        // i.e. `type(UniAlignmentV4Hook).creationCode` with exactly the constructor arguments derived
        // above. Code already at `predicted` is therefore this hook, with this parameterization: adopt it
        // and let the graduation proceed, instead of reverting on the CREATE2 collision and leaving the
        // pool un-graduatable. This mirrors `LiquidityDeployerModule._initOrValidatePool`, which accepts a
        // pre-initialized pool rather than bricking on a benign front-run.
        if (predicted.code.length != 0) {
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

        emit AlignmentHookDeployed(hook, address(vault), benefactor, hookFeeBips, lpFeeRate);
    }

    /// @inheritdoc IAlignmentHookFactory
    function hookFlags() external pure returns (uint160 required, uint160 forbidden) {
        return (REQUIRED_FLAGS, FORBIDDEN_FLAGS);
    }
}
