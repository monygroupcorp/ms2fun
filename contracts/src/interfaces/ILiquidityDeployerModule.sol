// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { IComponentModule } from "./IComponentModule.sol";

/// @notice Uniform interface for all ERC404 liquidity deployer modules.
///         Each deployer is pre-configured with its AMM-specific params at construction —
///         the instance only sends the base assets and graduation metadata.
interface ILiquidityDeployerModule is IComponentModule {
    struct DeployParams {
        uint256 ethReserve; // ETH to deploy (also sent as msg.value)
        uint256 tokenReserve; // ERC404 tokens to deploy (pre-transferred to deployer)
        address protocolTreasury;
        address vault; // alignment vault (receives 19% of raise + 19% of carve)
        address token; // ERC404 token address
        address instance; // same as token; benefactor to register with vault
        address creator; // receives 80% of the carve (instance passes owner())
        uint256 carveEth; // effective creator carve, resolved by the instance (0 = no carve)
        uint256 excessEth; // LP-share ETH the caller's parity clamp could not place at the pool price
    }

    /// @notice Deploy AMM liquidity. Caller must pre-transfer tokenReserve to this address.
    ///         ETH must equal p.ethReserve exactly via msg.value.
    /// @dev TWO LEGS, ONE RAIL. `carveEth` and `excessEth` are both diverted out of the LP 80 and are
    ///      both tithed 80/19/1 by the module — the arithmetic sees their sum and nothing else. They
    ///      are carried apart so the module can REPORT them apart: `carveEth` is what the creator
    ///      asked for and is the figure measured against the creator's declared allowance, while
    ///      `excessEth` is an output of the caller's own pool sizing and says nothing about the
    ///      creator. A caller with no clamp of its own passes `excessEth = 0`.
    function deployLiquidity(DeployParams calldata p) external payable;
}

/// @notice The graduating instance's side of the deployer handshake: a deployer module names its
///         venue's coin counterparties so the instance can flag them NFT-skipping before any coin
///         reaches them.
/// @dev WHY A CALLBACK AND NOT AN ACCESSOR. An ERC404 bonding instance mints one NFT id per `unit`
///      to any recipient that has not set the skip flag, so a graduation pool takes delivery of one
///      id per unit of the pool's coin side and the deployer module takes delivery of the same count
///      on the way through. Only the module knows which address that is, and for at least one venue
///      (Algebra/Cypher) the pool is created DURING graduation — there is no address to read before
///      the call, so no getter on the module can name it. The module therefore tells the instance,
///      at the moment it knows, and every venue is covered by the same mechanism.
/// @dev The instance IMPLEMENTS this interface rather than being probed for it: a rename is then a
///      compile error instead of a silently unflagged pool. Implementations must authorize the call
///      to the wired deployer module and nothing else, and must NOT take a reentrancy guard — the
///      graduation frame that calls into the module already holds the instance's shared lock.
interface IGraduationSkipNFTTarget {
    /// @dev The caller is not this instance's wired liquidity deployer module.
    error NotLiquidityDeployer();

    /// @notice Flag `counterparty` as NFT-skipping, permanently.
    /// @dev Called by the wired deployer module during graduation, BEFORE any coin reaches
    ///      `counterparty`. Permanent rather than saved-and-restored: a graduation pool goes on
    ///      receiving coin on the sell side of every later swap, and a restored flag would re-mint
    ///      the pool's worth of ids on the next one.
    /// @param counterparty A coin recipient of this graduation — the venue's pool, or a periphery
    ///        contract that takes custody of the coin on the way to it.
    function markGraduationSkipNFT(address counterparty) external;
}
