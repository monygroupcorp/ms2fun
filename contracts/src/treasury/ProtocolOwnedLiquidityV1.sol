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
 *      (the treasury previously relied on slither-disable comments only). Owner sweeps collected
 *      funds out via `withdrawETH` / `withdrawERC20`.
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

    // ============ Events ============

    event V4PoolManagerUpdated(address indexed newPoolManager);
    event WETHUpdated(address indexed newWETH);
    event MasterRegistryUpdated(address indexed newRegistry);
    event POLPositionDeployed(address indexed instance, uint128 liquidity, bytes32 salt);
    event POLFeesCollected(address indexed instance, uint256 amount0, uint256 amount1);
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
        COLLECT_FEES
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
    // slither-disable-next-line reentrancy-benign,reentrancy-events,reentrancy-no-eth,unused-return
    function receivePOL(PoolKey calldata poolKey, int24 tickLower, int24 tickUpper, uint256 amount0, uint256 amount1)
        external
        nonReentrant
    {
        if (address(masterRegistry) == address(0)) revert RegistryNotConfigured();
        if (!masterRegistry.isRegisteredInstance(msg.sender)) revert NotRegisteredInstance();
        if (v4PoolManager == address(0)) revert V4NotConfigured();
        if (weth == address(0)) revert WETHNotConfigured();
        if (_polPositions[msg.sender].liquidity != 0) revert POLAlreadyDeployed();

        // Deterministic salt per instance
        bytes32 salt = keccak256(abi.encodePacked("POL", msg.sender));

        // Approve PoolManager for both currencies
        Currency currency0 = poolKey.currency0;
        Currency currency1 = poolKey.currency1;
        if (!currency0.isAddressZero()) {
            SafeTransferLib.safeApproveWithRetry(Currency.unwrap(currency0), v4PoolManager, amount0);
        }
        if (!currency1.isAddressZero()) {
            SafeTransferLib.safeApproveWithRetry(Currency.unwrap(currency1), v4PoolManager, amount1);
        }

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
        uint128 liquidity = abi.decode(result, (uint128));

        // Store position
        _polPositions[msg.sender] = POLPosition({
            poolKey: poolKey, tickLower: tickLower, tickUpper: tickUpper, salt: salt, liquidity: liquidity
        });
        polInstances.push(msg.sender);

        emit POLPositionDeployed(msg.sender, liquidity, salt);
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

    // ============ V4 Callback ============

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != v4PoolManager) revert Unauthorized();

        CallbackData memory cbData = abi.decode(data, (CallbackData));

        if (cbData.operation == CallbackOperation.DEPLOY_POL) {
            return _handleDeployPOL(cbData.data);
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

        return abi.encode(liquidity);
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
