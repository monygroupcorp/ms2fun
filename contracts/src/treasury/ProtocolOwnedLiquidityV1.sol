// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { SafeOwnableUUPS } from "../shared/SafeOwnableUUPS.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { IPoolManager } from "v4-core/interfaces/IPoolManager.sol";
import { IUnlockCallback } from "v4-core/interfaces/callback/IUnlockCallback.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "v4-core/types/PoolId.sol";
import { Currency, CurrencyLibrary } from "v4-core/types/Currency.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "v4-core/types/BalanceDelta.sol";
import { CurrencySettler } from "../libraries/v4/CurrencySettler.sol";
import { LiquidityAmounts } from "../libraries/v4/LiquidityAmounts.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { StateLibrary } from "v4-core/libraries/StateLibrary.sol";
import { IMasterRegistry } from "../master/interfaces/IMasterRegistry.sol";

/**
 * @title ProtocolOwnedLiquidityV1
 * @notice UUPS upgradeable holder of protocol-owned Uniswap V4 liquidity (POL), carved out of
 *         ProtocolTreasuryV1 (noesis-066) so the always-live treasury carries no V4 `unlock`
 *         reentrancy surface. This contract owns its POL positions and the fees it collects.
 * @dev `receivePOL` is gated to registered instances (moved verbatim from the treasury). It is the
 *      party a registered instance calls at graduation to stand up treasury-owned LP — but no caller
 *      is wired yet; wiring POL-at-graduation is a separate follow-up. `claimPOLFees` stays
 *      permissionless (censorship-resistant fee collection). The V4 `unlock`/callback is this
 *      contract's only external interaction surface, so it is guarded explicitly with `nonReentrant`
 *      (the treasury previously relied on slither-disable comments only). `withdrawPOL` is the
 *      owner-gated exit for the LP principal: it routes a negative `liquidityDelta` through the same
 *      `unlock` callback the deposit uses, returning principal (plus anything accrued on it) to this
 *      contract. Owner sweeps recovered principal and collected fees out via `withdrawETH` /
 *      `withdrawERC20`.
 */
// slither-disable-next-line missing-inheritance
contract ProtocolOwnedLiquidityV1 is SafeOwnableUUPS, ReentrancyGuard, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using CurrencyLibrary for Currency;
    using CurrencySettler for Currency;
    using StateLibrary for IPoolManager;

    // ============ Custom Errors ============
    // Note: AlreadyInitialized() and Unauthorized() are inherited from Ownable

    error InvalidAddress();
    error RegistryNotConfigured();
    error NotRegisteredInstance();
    error V4NotConfigured();
    error WETHNotConfigured();
    error POLAlreadyDeployed();
    error NoPOLPosition();
    error InvalidRecipient();
    error InsufficientBalance();
    /// @notice `withdrawPOL` was asked for zero liquidity, or for more than the position holds.
    error InvalidLiquidityAmount();
    /// @notice `msg.value` did not equal the native-currency leg the caller must escrow for this deploy.
    error NativeValueMismatch();

    // ============ Events ============

    event V4PoolManagerUpdated(address indexed newPoolManager);
    event WETHUpdated(address indexed newWETH);
    event MasterRegistryUpdated(address indexed newRegistry);
    event POLPositionDeployed(address indexed instance, uint128 liquidity, bytes32 salt);
    event POLFeesCollected(address indexed instance, uint256 amount0, uint256 amount1);
    event POLPositionWithdrawn(address indexed instance, uint128 liquidity, uint256 amount0, uint256 amount1);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event ERC20Withdrawn(address indexed token, address indexed to, uint256 amount);

    // ============ Initialization ============

    bool private _initialized;

    // ============ Configuration ============

    address public v4PoolManager;
    address public weth;
    IMasterRegistry public masterRegistry;

    // ============ POL Position Tracking ============

    struct POLPosition {
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        bytes32 salt;
        uint128 liquidity;
    }

    mapping(address => POLPosition) internal _polPositions; // instance => position
    address[] public polInstances;

    /// @notice Cumulative POL fees collected (in wei-equivalents summed across both currencies).
    uint256 public totalPOLFeesCollected;

    // ============ V4 Callback Routing (mirrors UniAlignmentVault pattern) ============

    enum CallbackOperation {
        DEPLOY_POL,
        COLLECT_FEES,
        WITHDRAW_POL
    }

    struct CallbackData {
        CallbackOperation operation;
        bytes data;
    }

    struct DeployPOLCallbackData {
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        bytes32 salt;
        uint256 amount0;
        uint256 amount1;
    }

    struct CollectFeesCallbackData {
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        bytes32 salt;
    }

    struct WithdrawPOLCallbackData {
        PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        bytes32 salt;
        uint128 liquidity;
    }

    function initialize(address _owner) external {
        if (_initialized) revert AlreadyInitialized();
        if (_owner == address(0)) revert InvalidAddress();
        _initialized = true;
        _setOwner(_owner);
    }

    /// @notice Accept native ETH taken from the PoolManager during settlement.
    receive() external payable { }

    // ============ Configuration ============

    function setV4PoolManager(address _pm) external onlyOwner {
        if (_pm == address(0)) revert InvalidAddress();
        v4PoolManager = _pm;
        emit V4PoolManagerUpdated(_pm);
    }

    function setWETH(address _weth) external onlyOwner {
        if (_weth == address(0)) revert InvalidAddress();
        weth = _weth;
        emit WETHUpdated(_weth);
    }

    function setMasterRegistry(address _registry) external onlyOwner {
        if (_registry == address(0)) revert InvalidAddress();
        masterRegistry = IMasterRegistry(_registry);
        emit MasterRegistryUpdated(_registry);
    }

    // ============ Protocol-Owned Liquidity ============

    /// @notice Called by a registered instance during graduation to deploy protocol-owned LP.
    /// @dev The caller must escrow ALL capital for the position IN THIS CALL: the native-currency leg as
    ///      `msg.value` (which must equal the native amount exactly) and every ERC20/WETH leg pulled from
    ///      the caller via `transferFrom`. The V4 position is funded strictly from that escrow — never from
    ///      this contract's shared balance (pooled fees, treasury seeding, or other instances' funds). Any
    ///      escrow the position does not consume is refunded to the caller, so a `receivePOL` caller can
    ///      neither drain the shared balance nor leave dust stranded here. (noesis-111: closes the §2f
    ///      latent-HIGH where the native leg was settled from `address(this).balance`.)
    // slither-disable-next-line reentrancy-benign,reentrancy-events,reentrancy-no-eth,unused-return
    function receivePOL(PoolKey calldata poolKey, int24 tickLower, int24 tickUpper, uint256 amount0, uint256 amount1)
        external
        payable
        nonReentrant
    {
        if (address(masterRegistry) == address(0)) revert RegistryNotConfigured();
        if (!masterRegistry.isRegisteredInstance(msg.sender)) revert NotRegisteredInstance();
        if (v4PoolManager == address(0)) revert V4NotConfigured();
        if (weth == address(0)) revert WETHNotConfigured();
        if (_polPositions[msg.sender].liquidity != 0) revert POLAlreadyDeployed();

        // Deterministic salt per instance
        bytes32 salt = keccak256(abi.encodePacked("POL", msg.sender));

        Currency currency0 = poolKey.currency0;
        Currency currency1 = poolKey.currency1;

        // Escrow the caller's capital for THIS deploy. The native leg (address(0)) must arrive as
        // `msg.value`; each ERC20/WETH leg is pulled from the caller now (not assumed already pooled
        // here) and approved to the PoolManager. `msg.value` must equal the native leg exactly — for a
        // token-only pool the native leg is 0, so any `msg.value` is rejected.
        uint256 nativeAmount;
        if (currency0.isAddressZero()) {
            nativeAmount = amount0;
        } else {
            SafeTransferLib.safeTransferFrom(Currency.unwrap(currency0), msg.sender, address(this), amount0);
            SafeTransferLib.safeApproveWithRetry(Currency.unwrap(currency0), v4PoolManager, amount0);
        }
        if (currency1.isAddressZero()) {
            nativeAmount = amount1;
        } else {
            SafeTransferLib.safeTransferFrom(Currency.unwrap(currency1), msg.sender, address(this), amount1);
            SafeTransferLib.safeApproveWithRetry(Currency.unwrap(currency1), v4PoolManager, amount1);
        }
        if (msg.value != nativeAmount) revert NativeValueMismatch();

        // Deploy via unlock callback
        CallbackData memory cbData = CallbackData({
            operation: CallbackOperation.DEPLOY_POL,
            data: abi.encode(
                DeployPOLCallbackData({
                    poolKey: poolKey,
                    tickLower: tickLower,
                    tickUpper: tickUpper,
                    salt: salt,
                    amount0: amount0,
                    amount1: amount1
                })
            )
        });

        bytes memory result = IPoolManager(v4PoolManager).unlock(abi.encode(cbData));
        (uint128 liquidity, uint256 used0, uint256 used1) = abi.decode(result, (uint128, uint256, uint256));

        // Store position
        _polPositions[msg.sender] = POLPosition({
            poolKey: poolKey, tickLower: tickLower, tickUpper: tickUpper, salt: salt, liquidity: liquidity
        });
        polInstances.push(msg.sender);

        emit POLPositionDeployed(msg.sender, liquidity, salt);

        // Refund escrow the position did not consume back to the caller, so nothing the caller sent is
        // left in the shared balance (and, conversely, the shared balance never subsidised the position).
        _refundUnusedEscrow(currency0, amount0, used0);
        _refundUnusedEscrow(currency1, amount1, used1);
    }

    /// @dev Return `provided - used` of `currency` to the caller (native via ETH transfer, ERC20 via
    ///      token transfer). `used` is the amount the V4 position actually pulled and is always
    ///      `<= provided` (liquidity is sized within the provided amounts), so the subtraction is a
    ///      no-op when the whole escrow was consumed.
    function _refundUnusedEscrow(Currency currency, uint256 provided, uint256 used) internal {
        if (provided <= used) return;
        uint256 refund;
        unchecked {
            refund = provided - used;
        }
        if (currency.isAddressZero()) {
            SafeTransferLib.safeTransferETH(msg.sender, refund);
        } else {
            SafeTransferLib.safeTransfer(Currency.unwrap(currency), msg.sender, refund);
        }
    }

    /// @notice Permissionless fee collection for a protocol-owned POL position.
    // slither-disable-next-line reentrancy-benign,reentrancy-events
    function claimPOLFees(address instance) external nonReentrant returns (uint256 amount0, uint256 amount1) {
        POLPosition storage pos = _polPositions[instance];
        if (pos.liquidity == 0) revert NoPOLPosition();

        CollectFeesCallbackData memory feeParams = CollectFeesCallbackData({
            poolKey: pos.poolKey, tickLower: pos.tickLower, tickUpper: pos.tickUpper, salt: pos.salt
        });

        CallbackData memory cbData =
            CallbackData({ operation: CallbackOperation.COLLECT_FEES, data: abi.encode(feeParams) });

        bytes memory result = IPoolManager(v4PoolManager).unlock(abi.encode(cbData));
        BalanceDelta delta = abi.decode(result, (BalanceDelta));

        amount0 = delta.amount0() > 0 ? uint256(int256(delta.amount0())) : 0;
        amount1 = delta.amount1() > 0 ? uint256(int256(delta.amount1())) : 0;

        totalPOLFeesCollected += amount0 + amount1;

        emit POLFeesCollected(instance, amount0, amount1);
    }

    /// @notice Owner-gated exit for a protocol-owned LP position: burn `liquidity` from the position and
    ///         bring the underlying principal back to this contract.
    /// @dev Mirrors the deposit seam exactly — the same `unlock` callback, the same `_settleDelta`, with a
    ///      NEGATIVE `liquidityDelta`. The amounts credited by the burn (principal, plus any fees the
    ///      position had accrued on the burnt share) are `take`n to this contract, where the existing
    ///      `withdrawETH` / `withdrawERC20` sweeps move them on. Partial withdrawal is supported: the
    ///      tracked liquidity is reduced by `liquidity` and the position stays readable via
    ///      `getPolPosition`. `receivePOL`'s guards are untouched.
    /// @param instance The registered instance whose position is being exited.
    /// @param liquidity Amount of position liquidity to burn; must be non-zero and at most the tracked amount.
    // slither-disable-next-line reentrancy-benign,reentrancy-events
    function withdrawPOL(address instance, uint128 liquidity)
        external
        onlyOwner
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        POLPosition storage pos = _polPositions[instance];
        if (pos.liquidity == 0) revert NoPOLPosition();
        if (liquidity == 0 || liquidity > pos.liquidity) revert InvalidLiquidityAmount();

        CallbackData memory cbData = CallbackData({
            operation: CallbackOperation.WITHDRAW_POL,
            data: abi.encode(
                WithdrawPOLCallbackData({
                    poolKey: pos.poolKey,
                    tickLower: pos.tickLower,
                    tickUpper: pos.tickUpper,
                    salt: pos.salt,
                    liquidity: liquidity
                })
            )
        });

        // Reduce the tracked position before the external call (the callback never reads it).
        unchecked {
            pos.liquidity -= liquidity;
        }

        bytes memory result = IPoolManager(v4PoolManager).unlock(abi.encode(cbData));
        BalanceDelta delta = abi.decode(result, (BalanceDelta));

        amount0 = delta.amount0() > 0 ? uint256(int256(delta.amount0())) : 0;
        amount1 = delta.amount1() > 0 ? uint256(int256(delta.amount1())) : 0;

        emit POLPositionWithdrawn(instance, liquidity, amount0, amount1);
    }

    // ============ V4 Callback ============

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != v4PoolManager) revert Unauthorized();

        CallbackData memory cbData = abi.decode(data, (CallbackData));

        if (cbData.operation == CallbackOperation.DEPLOY_POL) {
            return _handleDeployPOL(cbData.data);
        } else if (cbData.operation == CallbackOperation.WITHDRAW_POL) {
            return _handleWithdrawPOL(cbData.data);
        } else {
            return _handleCollectFees(cbData.data);
        }
    }

    // slither-disable-next-line unused-return
    function _handleDeployPOL(bytes memory data) internal returns (bytes memory) {
        DeployPOLCallbackData memory params = abi.decode(data, (DeployPOLCallbackData));

        PoolId poolId = params.poolKey.toId();
        (uint160 sqrtPriceX96,,,) = IPoolManager(v4PoolManager).getSlot0(poolId);
        uint160 sqrtPriceAX96 = TickMath.getSqrtPriceAtTick(params.tickLower);
        uint160 sqrtPriceBX96 = TickMath.getSqrtPriceAtTick(params.tickUpper);

        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96, sqrtPriceAX96, sqrtPriceBX96, params.amount0, params.amount1
        );

        IPoolManager.ModifyLiquidityParams memory modifyParams = IPoolManager.ModifyLiquidityParams({
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidityDelta: int256(uint256(liquidity)),
            salt: params.salt
        });

        (BalanceDelta delta,) = IPoolManager(v4PoolManager).modifyLiquidity(params.poolKey, modifyParams, "");
        _settleDelta(params.poolKey, delta);

        // Report the amounts the position actually pulled (negative deltas are debts we settled) so
        // `receivePOL` can refund any unconsumed escrow to the caller.
        int128 d0 = delta.amount0();
        int128 d1 = delta.amount1();
        uint256 used0 = d0 < 0 ? uint256(uint128(-d0)) : 0;
        uint256 used1 = d1 < 0 ? uint256(uint128(-d1)) : 0;

        return abi.encode(liquidity, used0, used1);
    }

    // slither-disable-next-line unused-return
    function _handleWithdrawPOL(bytes memory data) internal returns (bytes memory) {
        WithdrawPOLCallbackData memory params = abi.decode(data, (WithdrawPOLCallbackData));

        IPoolManager.ModifyLiquidityParams memory modifyParams = IPoolManager.ModifyLiquidityParams({
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidityDelta: -int256(uint256(params.liquidity)),
            salt: params.salt
        });

        (BalanceDelta delta,) = IPoolManager(v4PoolManager).modifyLiquidity(params.poolKey, modifyParams, "");
        _settleDelta(params.poolKey, delta);

        return abi.encode(delta);
    }

    // slither-disable-next-line unused-return
    function _handleCollectFees(bytes memory data) internal returns (bytes memory) {
        CollectFeesCallbackData memory params = abi.decode(data, (CollectFeesCallbackData));

        IPoolManager.ModifyLiquidityParams memory modifyParams = IPoolManager.ModifyLiquidityParams({
            tickLower: params.tickLower, tickUpper: params.tickUpper, liquidityDelta: 0, salt: params.salt
        });

        (BalanceDelta delta,) = IPoolManager(v4PoolManager).modifyLiquidity(params.poolKey, modifyParams, "");
        _settleDelta(params.poolKey, delta);

        return abi.encode(delta);
    }

    function _settleDelta(PoolKey memory poolKey, BalanceDelta delta) internal {
        IPoolManager pm = IPoolManager(v4PoolManager);
        int128 delta0 = delta.amount0();
        int128 delta1 = delta.amount1();

        if (delta0 < 0) {
            poolKey.currency0.settle(pm, address(this), uint128(-delta0), false);
        } else if (delta0 > 0) {
            poolKey.currency0.take(pm, address(this), uint128(delta0), false);
        }
        if (delta1 < 0) {
            poolKey.currency1.settle(pm, address(this), uint128(-delta1), false);
        } else if (delta1 > 0) {
            poolKey.currency1.take(pm, address(this), uint128(delta1), false);
        }
    }

    // ============ Owner Sweeps ============

    function withdrawETH(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        if (amount > address(this).balance) revert InsufficientBalance();
        SafeTransferLib.safeTransferETH(to, amount);
        emit ETHWithdrawn(to, amount);
    }

    function withdrawERC20(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidRecipient();
        SafeTransferLib.safeTransfer(token, to, amount);
        emit ERC20Withdrawn(token, to, amount);
    }

    // ============ Views ============

    function getPolPosition(address instance)
        external
        view
        returns (int24 tickLower, int24 tickUpper, bytes32 salt, uint128 liquidity)
    {
        POLPosition storage pos = _polPositions[instance];
        return (pos.tickLower, pos.tickUpper, pos.salt, pos.liquidity);
    }

    function polInstanceCount() external view returns (uint256) {
        return polInstances.length;
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
