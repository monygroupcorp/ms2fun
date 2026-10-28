// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable } from "solady/auth/Ownable.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IAlignmentVault } from "../../../interfaces/IAlignmentVault.sol";
import { IAlignmentHookFactory } from "./IAlignmentHookFactory.sol";
import { HookAddressMiner } from "./HookAddressMiner.sol";
import { UniAlignmentV4Hook } from "./UniAlignmentV4Hook.sol";
import { IMasterRegistry } from "../../../master/interfaces/IMasterRegistry.sol";

/**
 * @title UniTitheHookFactory
 * @notice Deploys `UniAlignmentV4Hook` (the ETH swap-tithe hook) at a Uniswap v4 permission-bit-valid
 *         address, one per graduation.
 * @dev The deploy primitive is raw CREATE2 (`new UniAlignmentV4Hook{salt}(...)`, deployer = this
 *      factory), not the CreateX/CREATE3 pattern the ERC-x factories use. Uniswap v4 encodes hook
 *      permissions in the low 14 bits of the hook address, and `HookAddressMiner.mineSalt` finds a salt
 *      by evaluating the raw CREATE2 formula `keccak256(0xff, deployer, salt, initCodeHash)`. CreateX's
 *      CREATE3 derives the address through a proxy indirection that does not fit that formula, so it
 *      cannot produce a permission-bit-constrained address.
 *
 *      PoolManager, WETH and the master registry are factory immutables (set at factory deploy by
 *      DeployCore); `deployHook` supplies only the per-graduation data (vault, benefactor, fees, pool).
 *      The hook constructor's `validateHookPermissions()` is the on-chain guard against a bad address.
 *
 *      The hook owner is not an immutable, and this factory is `Ownable`. Each deployed hook's owner
 *      holds `setLpFeeRate` and `rescueQueuedFees` on that hook for its whole life, fixed at the hook's
 *      construction. An immutable owner set to the deploying EOA would leave every hook owned by that
 *      key past the governance handover, with no path to move it. So `hookOwner` is owner-settable
 *      state, and `script/MigrateOwnership.s.sol` moves both the factory and, via `setHookOwner`, the
 *      owner of the hooks it goes on to deploy.
 *
 *      The mined address varies across attempts: the scan starts at a block-derived offset so that a
 *      mine which does not fit in one block is retryable in the next. The hook's identity is fixed:
 *      the init-code hash over the creation code and all ten constructor arguments, which
 *      `deployedHook` keys on, so one parameterization yields one hook.
 */
contract UniTitheHookFactory is IAlignmentHookFactory, Ownable {
    /// @notice Uniswap v4 PoolManager the deployed hooks bind to (immutable, factory config).
    IPoolManager public immutable poolManager;

    /// @notice WETH address passed to each deployed hook (immutable, factory config).
    address public immutable weth;

    /// @notice Master registry passed to each deployed hook (immutable, factory config).
    /// @dev The hook reads it to learn that its immutable `vault` has been retired with
    ///      `deactivateVault`, which is what lets it stop taxing and release its queued fees.
    address public immutable masterRegistry;

    /// @notice Governance owner stamped into each hook this factory deploys.
    /// @dev Owner-settable, not immutable; see the contract note. It is part of each hook's init-code
    ///      hash, so changing it changes the identity of the hooks this factory produces: a hook mined
    ///      under the old value is a different hook at a different address, adoptable under its own
    ///      `deployedHook` key. Deployed hooks are untouched: each hook's owner is written at its
    ///      construction and moves only through that hook's own Solady ownership handover.
    address public hookOwner;

    /// @notice Required permission bits (0xCC = beforeSwap|afterSwap|beforeSwapReturnDelta|afterSwapReturnDelta).
    uint160 public constant REQUIRED_FLAGS = HookAddressMiner.ULTRA_ALIGNMENT_HOOK_FLAGS;

    /// @notice Forbidden permission bits (all other hook flags, the complement of REQUIRED_FLAGS).
    uint160 public constant FORBIDDEN_FLAGS = HookAddressMiner.ULTRA_ALIGNMENT_FORBIDDEN_FLAGS;

    /// @notice The hook this factory has already deployed for a given init-code hash, if any.
    /// @dev Adoption is keyed on identity, not on a mined address. `initCodeHash` commits to the hook's
    ///      creation code and all ten constructor arguments, so an entry means "this hook, with this
    ///      parameterization, already exists", whichever salt found it. This is load-bearing because the
    ///      mine's starting offset varies per block: a second call mines a different salt and candidate
    ///      address, so an address-only check would find empty code and deploy a duplicate hook.
    mapping(bytes32 initCodeHash => address hook) public deployedHook;

    error InvalidAddress();

    /// @notice Emitted when the owner re-points the governance owner future hooks are deployed with.
    event HookOwnerUpdated(address indexed previousHookOwner, address indexed newHookOwner);

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

    constructor(IPoolManager _poolManager, address _weth, address _hookOwner, address _masterRegistry) {
        if (address(_poolManager) == address(0)) revert InvalidAddress();
        if (_weth == address(0)) revert InvalidAddress();
        if (_hookOwner == address(0)) revert InvalidAddress();
        if (_masterRegistry == address(0)) revert InvalidAddress();
        poolManager = _poolManager;
        weth = _weth;
        hookOwner = _hookOwner;
        masterRegistry = _masterRegistry;
        // Plain Solady `Ownable` like the other factories, so `MigrateOwnership` handles it in the
        // same loop.
        _initializeOwner(msg.sender);
        emit HookOwnerUpdated(address(0), _hookOwner);
    }

    /// @notice Re-point the governance owner stamped into hooks deployed from here on.
    /// @dev The reason this factory is `Ownable`. A hook's owner holds `setLpFeeRate` and
    ///      `rescueQueuedFees` on it permanently, so the stamped address has to be movable from the
    ///      deploying key to governance. Applies to later hooks only; a deployed hook keeps the owner
    ///      it was constructed with.
    /// @param newHookOwner The address to stamp into subsequently deployed hooks.
    function setHookOwner(address newHookOwner) external onlyOwner {
        if (newHookOwner == address(0)) revert InvalidAddress();
        emit HookOwnerUpdated(hookOwner, newHookOwner);
        hookOwner = newHookOwner;
    }

    /// @inheritdoc IAlignmentHookFactory
    function deployHook(
        IAlignmentVault vault,
        address benefactor,
        uint256 hookFeeBips,
        uint24 lpFeeRate,
        address poolToken,
        int24 poolTickSpacing
    ) external returns (address hook) {
        // Init code exactly as `new UniAlignmentV4Hook{salt}(...)` below assembles it: creation code ++
        // abi.encode(all ten constructor args, in order). The mine and the deploy derive their address
        // from this hash, computed by HookAddressMiner.computeInitCodeHash, the single source of truth
        // for it.
        bytes32 initCodeHash = HookAddressMiner.computeInitCodeHash(
            type(UniAlignmentV4Hook).creationCode,
            address(poolManager),
            address(vault),
            weth,
            hookOwner,
            benefactor,
            hookFeeBips,
            lpFeeRate,
            masterRegistry,
            poolToken,
            poolTickSpacing
        );

        // Idempotent deploy, checked before the mine: `deployHook` is callable by anyone, and its
        // arguments are derivable from public state, so the hook for a pending graduation can be
        // deployed ahead of it. Adopt what is there rather than revert on a CREATE2 collision and
        // leave the pool un-graduatable, as `LiquidityDeployerModule._initOrValidatePool` does for a
        // pre-initialized pool.
        //
        // The key is the init-code hash, so a hit is precisely "this hook, this parameterization,
        // already deployed by this factory". Checking first means an adoption pays no mining gas.
        //
        // The parameterization names the pool as well (`poolToken`, `poolTickSpacing`) and the hook
        // refuses every other key, so a pre-deploy for a pool the graduation is not opening is a
        // different hook at a different address. A caller who deploys ahead can hand the graduation
        // its hook, never a hook bound somewhere else.
        address adopted = deployedHook[initCodeHash];
        if (adopted != address(0)) {
            emit AlignmentHookAdopted(adopted, address(vault), benefactor, hookFeeBips, lpFeeRate);
            return adopted;
        }

        // The salt scan starts at a block-derived offset. The mine's inputs (this factory, the
        // init-code hash, the flag masks) are fixed for a given parameterization, so a scan always
        // starting at zero would walk the same salts on every call and never fit if it did not fit
        // once. A retry lands in a later block, draws a different `prevrandao` and `number`, and scans
        // a different window.
        //
        // `block.prevrandao` is influenceable at the margin by a proposer, which does not matter:
        // every salt whose address carries exactly the required bits is equally acceptable, the offset
        // changes only which valid address is found, and the hook constructor's
        // `validateHookPermissions()` remains the on-chain check on the permission bits.
        uint256 startOffset = uint256(keccak256(abi.encode(block.prevrandao, block.number, initCodeHash)));

        // Mine a salt so the CREATE2 address carries exactly the 0xCC permission bits. The scan covers
        // HookAddressMiner.SCAN_WINDOW salts, sized to fit a 30M-gas block alongside the rest of a
        // graduation; for 0xCC the expected hit is ~2^14 iterations, well inside the window. Exhausting
        // the window reverts `NoValidSaltFound`, a cheap named failure the next block can retry.
        (bytes32 salt, address predicted) =
            HookAddressMiner.mineSalt(address(this), initCodeHash, REQUIRED_FLAGS, FORBIDDEN_FLAGS, startOffset);

        // A hook that reached this address without writing the mapping: the address is
        // CREATE2-derived from (this factory, salt, initCodeHash), so only this factory can occupy it,
        // and only with an init code hashing to `initCodeHash`. Code there is this hook with this
        // parameterization. Record it so later calls adopt without mining.
        if (predicted.code.length != 0) {
            deployedHook[initCodeHash] = predicted;
            emit AlignmentHookAdopted(predicted, address(vault), benefactor, hookFeeBips, lpFeeRate);
            return predicted;
        }

        // `new C{salt}(args)` deploys at keccak256(0xff, address(this), salt, keccak256(creationCode ++
        // abi.encode(args)))[12:], which is `predicted` by construction: the mine derived it from the same
        // deployer, salt, and an init code hash built from this creation code and these ten arguments in
        // this order. An equality check could not fail, so the property is asserted in the tests (a hook
        // deployed through this function lands on the independently derived address). The hook
        // constructor's `validateHookPermissions()` is the on-chain guard on the permission bits.
        hook = address(
            new UniAlignmentV4Hook{ salt: salt }(
                poolManager,
                vault,
                weth,
                hookOwner,
                benefactor,
                hookFeeBips,
                lpFeeRate,
                IMasterRegistry(masterRegistry),
                poolToken,
                poolTickSpacing
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
