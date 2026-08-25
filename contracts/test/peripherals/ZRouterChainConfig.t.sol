// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { zRouter, ChainConfig, mainnetChainConfig } from "../../src/peripherals/zRouter.sol";

/// @notice Chain bindings are constructor input, so a router deployed for a network that lacks a
///         venue must refuse that leg rather than route at an address which means nothing there.
///
///         Two properties are pinned here:
///
///         1. `mainnetChainConfig()` reproduces, member for member, the addresses the router held as
///            compile-time constants. Every mainnet and anvil-fork caller deploys with it, so this is
///            what keeps their behaviour identical across the move to deploy-time binding.
///         2. Each leg reached through raw assembly or a low-level `call` — Lido and zAMM — reverts
///            `LegUnavailable()` when its binding is zero. Those calls succeed against a codeless
///            address, so without the guard `exactETHToSTETH` would forward `msg.value` to
///            `address(0)`; the assertions below fail if the guard is removed.
contract ZRouterChainConfigTest is Test {
    // The mainnet set, restated independently of `mainnetChainConfig()` so the comparison below is a
    // real one rather than a tautology.
    address internal constant MAINNET_WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant MAINNET_V4_POOL_MANAGER = 0x000000000004444c5dc75cB358380D2e3dE08A90;
    address internal constant MAINNET_V3_FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    bytes32 internal constant MAINNET_V3_POOL_INIT_CODE_HASH =
        0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;
    address internal constant MAINNET_V2_FACTORY = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;
    bytes32 internal constant MAINNET_V2_POOL_INIT_CODE_HASH =
        0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f;
    address internal constant MAINNET_SUSHI_FACTORY = 0xC0AEe478e3658e2610c5F7A4A2E1777cE9e4f2Ac;
    bytes32 internal constant MAINNET_SUSHI_POOL_INIT_CODE_HASH =
        0xe18a34eb0e04b04f7a0ac29a6e80748dca96319b42c54d679cb821dca90c6303;
    address internal constant MAINNET_ZAMM = 0x000000000000040470635EB91b7CE4D132D616eD;
    address internal constant MAINNET_ZAMM_0 = 0x00000000000008882D72EfA6cCE4B6a40b24C860;
    address internal constant MAINNET_STETH = 0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84;
    address internal constant MAINNET_WSTETH = 0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0;
    address internal constant MAINNET_DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address internal constant MAINNET_PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant MAINNET_NAME_NFT = 0x0000000000696760E15f265e828DB644A0c242EB;

    /// @dev WETH is the one binding that may not be zero, so a router built to exercise the dark
    ///      legs still needs a stand-in here.
    address internal constant STAND_IN_WETH = address(uint160(0xAAA1));
    address internal constant STAND_IN_TOKEN = address(uint160(0xAAA2));
    address internal constant STAND_IN_WSTETH = address(uint160(0xAAA3));
    address internal constant STAND_IN_ZAMM = address(uint160(0xAAA4));

    address internal user = address(uint160(0xBEEF));

    /// @dev Router with every venue unbound except WETH — the shape of a network that has none of
    ///      the legs asserted below.
    zRouter internal dark;

    function setUp() public {
        ChainConfig memory c;
        c.weth = STAND_IN_WETH;
        dark = new zRouter(c);
        vm.deal(user, 100 ether);
    }

    // ── 1. The mainnet defaults are the former compile-time constants ─────────────────────────

    function test_mainnetDefaultsMatchTheFormerConstants() public {
        zRouter r = new zRouter(mainnetChainConfig());

        assertEq(r.WETH(), MAINNET_WETH, "weth");
        assertEq(r.V4_POOL_MANAGER(), MAINNET_V4_POOL_MANAGER, "v4PoolManager");
        assertEq(r.V3_FACTORY(), MAINNET_V3_FACTORY, "v3Factory");
        assertEq(r.V3_POOL_INIT_CODE_HASH(), MAINNET_V3_POOL_INIT_CODE_HASH, "v3InitCodeHash");
        assertEq(r.V2_FACTORY(), MAINNET_V2_FACTORY, "v2Factory");
        assertEq(r.V2_POOL_INIT_CODE_HASH(), MAINNET_V2_POOL_INIT_CODE_HASH, "v2InitCodeHash");
        assertEq(r.SUSHI_FACTORY(), MAINNET_SUSHI_FACTORY, "sushiFactory");
        assertEq(r.SUSHI_POOL_INIT_CODE_HASH(), MAINNET_SUSHI_POOL_INIT_CODE_HASH, "sushiInitCodeHash");
        assertEq(r.ZAMM(), MAINNET_ZAMM, "zamm");
        assertEq(r.ZAMM_0(), MAINNET_ZAMM_0, "zamm0");
        assertEq(r.STETH(), MAINNET_STETH, "steth");
        assertEq(r.WSTETH(), MAINNET_WSTETH, "wsteth");
        assertEq(r.DAI(), MAINNET_DAI, "dai");
        assertEq(r.PERMIT2(), MAINNET_PERMIT2, "permit2");
        assertEq(r.NAME_NFT(), MAINNET_NAME_NFT, "nameNft");
    }

    // ── 2. WETH may not be unbound ────────────────────────────────────────────────────────────

    function test_constructorRejectsUnboundWeth() public {
        ChainConfig memory c = mainnetChainConfig();
        c.weth = address(0);
        vm.expectRevert(zRouter.LegUnavailable.selector);
        new zRouter(c);
    }

    // ── 3. Dark Lido legs revert loudly instead of forwarding ETH to address(0) ────────────────

    function test_darkLido_exactETHToSTETH_reverts() public {
        vm.prank(user);
        vm.expectRevert(zRouter.LegUnavailable.selector);
        dark.exactETHToSTETH{ value: 1 ether }(user);
    }

    function test_darkLido_ethToExactSTETH_reverts() public {
        vm.prank(user);
        vm.expectRevert(zRouter.LegUnavailable.selector);
        dark.ethToExactSTETH{ value: 1 ether }(user, 0.5 ether);
    }

    function test_darkLido_exactETHToWSTETH_reverts() public {
        vm.prank(user);
        vm.expectRevert(zRouter.LegUnavailable.selector);
        dark.exactETHToWSTETH{ value: 1 ether }(user);
    }

    function test_darkLido_ethToExactWSTETH_reverts() public {
        vm.prank(user);
        vm.expectRevert(zRouter.LegUnavailable.selector);
        dark.ethToExactWSTETH{ value: 1 ether }(user, 0.5 ether);
    }

    /// @dev Without the guard the dark call would SUCCEED and take the ETH with it: this is what the
    ///      four assertions above are protecting against, shown directly.
    function test_darkLido_wouldOtherwiseBurnTheEth() public {
        uint256 before = address(0).balance;
        vm.prank(user);
        (bool ok,) = address(0).call{ value: 1 ether }(abi.encodeWithSignature("submit(address)", user));
        assertTrue(ok, "a raw call to a codeless address succeeds");
        assertEq(address(0).balance, before + 1 ether, "and carries the value with it");
    }

    /// @dev A router that DOES bind Lido reaches the venue — the guard is about the binding, not a
    ///      blanket disable.
    function test_boundLidoLegReachesTheVenue() public {
        StubSteth steth = new StubSteth();
        ChainConfig memory c;
        c.weth = STAND_IN_WETH;
        c.steth = address(steth);
        c.wsteth = STAND_IN_WSTETH;
        zRouter r = new zRouter(c);

        vm.prank(user);
        uint256 shares = r.exactETHToSTETH{ value: 1 ether }(user);
        assertEq(shares, steth.SHARES(), "bound leg must reach the venue");
        assertEq(address(steth).balance, 1 ether, "and forward the stake to it");
    }

    // ── 4. Dark zAMM legs revert loudly ───────────────────────────────────────────────────────

    function test_darkZamm_swapVZ_reverts() public {
        vm.prank(user);
        vm.expectRevert(zRouter.LegUnavailable.selector);
        dark.swapVZ{ value: 1 ether }(user, false, 30, address(0), STAND_IN_TOKEN, 0, 0, 1 ether, 0, _deadline());
    }

    /// @dev `deadline == type(uint256).max` selects the hookless predecessor, a distinct binding, so
    ///      a network carrying zAMM V1 but not its predecessor still refuses that branch.
    function test_darkZamm0_swapVZ_reverts() public {
        ChainConfig memory c;
        c.weth = STAND_IN_WETH;
        c.zamm = STAND_IN_ZAMM; // V1 bound, predecessor dark
        zRouter r = new zRouter(c);

        vm.prank(user);
        vm.expectRevert(zRouter.LegUnavailable.selector);
        r.swapVZ{ value: 1 ether }(user, false, 30, address(0), STAND_IN_TOKEN, 0, 0, 1 ether, 0, type(uint256).max);
    }

    // ── 5. Non-vacuity: an unbound V4 manager reverts, it does not misroute ───────────────────

    function test_darkV4_swap_reverts() public {
        vm.prank(user);
        vm.expectRevert();
        dark.swapV4{ value: 1 ether }(user, false, 500, 10, address(0), STAND_IN_TOKEN, 1 ether, 0, _deadline());
        assertEq(address(dark).balance, 0, "an unbound V4 manager must not strand ETH in the router");
    }

    /// @dev The same call against a router whose V4 manager IS bound gets past the routing point and
    ///      fails inside the venue instead — so the assertion above is about the binding, not about
    ///      `swapV4` reverting for every input.
    function test_darkV4_probeIsNotVacuous() public {
        ChainConfig memory c;
        c.weth = STAND_IN_WETH;
        c.v4PoolManager = address(new StubPoolManager());
        zRouter r = new zRouter(c);

        vm.prank(user);
        vm.expectRevert(StubPoolManager.Reached.selector);
        r.swapV4{ value: 1 ether }(user, false, 500, 10, address(0), STAND_IN_TOKEN, 1 ether, 0, _deadline());
    }

    // ── 6. Dark Uniswap-family legs revert through the venue call's own codesize check ────────

    function test_darkSushi_swap_reverts() public {
        vm.prank(user);
        vm.expectRevert();
        // `deadline == type(uint256).max` selects the Sushi factory binding.
        dark.swapV2{ value: 1 ether }(user, false, address(0), STAND_IN_TOKEN, 1 ether, 0, type(uint256).max);
    }

    function test_darkV2_swap_reverts() public {
        vm.prank(user);
        vm.expectRevert();
        dark.swapV2{ value: 1 ether }(user, false, address(0), STAND_IN_TOKEN, 1 ether, 0, _deadline());
    }

    function test_darkV3_swap_reverts() public {
        vm.prank(user);
        vm.expectRevert();
        dark.swapV3{ value: 1 ether }(user, false, 500, address(0), STAND_IN_TOKEN, 1 ether, 0, _deadline());
    }

    function test_darkDai_permit_reverts() public {
        vm.prank(user);
        vm.expectRevert();
        dark.permitDAI(0, 0, 0, bytes32(0), bytes32(0));
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }
}

/// @dev Minimal Lido stand-in: answers `approve` and `submit(address)` and accepts the follow-up
///      `transferShares`, so a bound leg can be observed reaching its venue without a fork.
contract StubSteth {
    uint256 public constant SHARES = 123;

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }

    fallback() external payable {
        uint256 s = SHARES;
        assembly {
            mstore(0x00, s)
            return(0x00, 0x20)
        }
    }

    receive() external payable { }
}

/// @dev V4 PoolManager stand-in that reverts with a distinguishable error the moment it is reached.
contract StubPoolManager {
    error Reached();

    fallback() external payable {
        revert Reached();
    }
}
