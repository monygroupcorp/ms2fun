// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice The external protocol addresses that are fixed about Ethereum mainnet, stated once.
///
///         Two scripts deploy against these: `DeployMainnet` and `DeployAnvil` (the rehearsal, which
///         runs on a mainnet fork). An address that is a fact about mainnet is written here and both
///         read it, so the rehearsal cannot disagree with the deploy it rehearses. A family with no
///         address is silently omitted by `DeployCore`, so a stray second copy would not fail loudly.
///
///         What does not belong here: anything a network chooses rather than inherits. Salts are
///         bound to a broadcasting address, pool fees and oracle windows are chosen parameters, and
///         the alignment roster is a curation decision; those stay in the config that makes the
///         choice.
library MainnetAddresses {
    // ── Wrapped ether and the Uniswap venues ──────────────────────────────────────────────────
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant V4_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address internal constant V2_FACTORY = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;

    // ── Aave V3 endowment rail ────────────────────────────────────────────────────────────────
    /// @dev Aave WETH StataTokenV2 (`waEthWETH`) = `AaveV3Ethereum.WETH_STATA_TOKEN` in the vendored
    ///      aave-dao/aave-address-book (`lib/aave-address-book/src/AaveV3Ethereum.sol`). Pinned here
    ///      rather than imported to keep the whole Aave protocol out of this compilation for one
    ///      address. Its `asset()` is `WETH` above, the pair `DeployCore.deploy` asserts before it
    ///      wires the family, so a wrong value reverts the deploy. Distinct from
    ///      `WETH_STATIC_A_TOKEN` (0x2522…), the legacy StaticATokenLM.
    address internal constant WETH_STATA_TOKEN = 0x0bfc9d54Fc184518A81162F8fB99c2eACa081202;

    // ── ZAMM ──────────────────────────────────────────────────────────────────────────────────
    /// @dev ZAMM singleton, canonical CREATE2 deployment, V1. This is the version answering the
    ///      `IZAMM.addLiquidity` surface `ZAMMLiquidityDeployerModule` compiles against (verified on
    ///      a mainnet fork by `test/fork/LaunchDeployerGraduationFork.t.sol`). V0, which does not, is
    ///      0x00000000000008882D72EfA6cCE4B6a40b24C860.
    address internal constant ZAMM_V1 = 0x000000000000040470635EB91b7CE4D132D616eD;

    // ── zRouter / zQuoter ─────────────────────────────────────────────────────────────────────
    /// @dev The canonical zRouter aggregator singleton, so `DeployCore` reuses it instead of
    ///      deploying its own.
    address internal constant ZROUTER = 0x000000000000FB114709235f1ccBFfb925F600e4;
    /// @dev The canonical zQuoter best-route lens every vault factory is wired against, so an
    ///      alignment buy takes the deepest venue instead of its fixed family pool. This is the
    ///      Ethereum deployment of `lib/zRouter/src/zQuoter.sol`, whose nine-member AMM enum is the
    ///      one `BestRouteAcquirer` range-checks the returned source word against. The Base
    ///      deployment (`lib/zRouter/base/zQuoter.sol`, 0x772E2810A471dB2CC7ADA0d37D6395476535889a)
    ///      answers a different six-member enum and is not interchangeable with it.
    address internal constant ZQUOTER = 0x0180Fe9Ae92Cd04dA670F974DE9d928EA69CfA66;
}
