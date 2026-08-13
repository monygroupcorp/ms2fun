// test/factories/erc404cypher/CypherLiquidityDeployerModule.t.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import "forge-std/Test.sol";
// Named imports (not wildcard): the module now imports the shared `IERC20` while CypherAlignmentVault
// imports OpenZeppelin's — a wildcard import of both would pull two `IERC20` declarations into this
// file's global scope and clash. We only need the two contract symbols here.
import { CypherLiquidityDeployerModule } from "../../../src/factories/erc404cypher/CypherLiquidityDeployerModule.sol";
import { ILiquidityDeployerModule } from "../../../src/interfaces/ILiquidityDeployerModule.sol";
import { CypherAlignmentVault } from "../../../src/vaults/cypher/CypherAlignmentVault.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
import { MockWETH } from "../../mocks/MockWETH.sol";
import {
    MockAlgebraFactory,
    MockAlgebraPositionManager,
    MockAlgebraSwapRouter,
    MockAlgebraPool
} from "../../mocks/MockCypherAlgebra.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockAlignmentRegistry } from "../../mocks/MockAlignmentRegistry.sol";
import { TickMath } from "v4-core/libraries/TickMath.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";

contract CypherLiquidityDeployerModuleTest is Test {
    /// @dev This contract stands in for the graduating ERC404 instance, so it must answer the
    ///      deployer module's `IGraduationSkipNFTTarget` handshake. The real instance flags the
    ///      counterparty NFT-skipping; nothing here holds ids, so recording is enough.
    function markGraduationSkipNFT(address) external { }

    CypherLiquidityDeployerModule deployer;
    CypherAlignmentVault vault;
    MockAlgebraFactory algebraFactory;
    MockAlgebraPositionManager positionManager;
    MockAlgebraSwapRouter swapRouter;
    MockERC20 token;
    MockWETH weth;
    MockMasterRegistry registry;
    MockAlignmentRegistry alignmentRegistry;

    address protocolTreasury = makeAddr("treasury");
    // The graduating instance is the caller (msg.sender) — the strict guard requires
    // msg.sender == p.instance && registered. This test contract stands in for that instance.
    address instance;

    uint256 constant TARGET_ID = 1;

    function setUp() public {
        algebraFactory = new MockAlgebraFactory();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
        token = new MockERC20("Token", "TKN");
        weth = new MockWETH();
        registry = new MockMasterRegistry();
        alignmentRegistry = new MockAlignmentRegistry();
        alignmentRegistry.setTargetActive(TARGET_ID, true);
        alignmentRegistry.setTokenInTarget(TARGET_ID, address(token), true);
        instance = address(this);

        deployer = new CypherLiquidityDeployerModule(
            address(algebraFactory), address(positionManager), address(weth), address(registry)
        );

        CypherAlignmentVault impl = new CypherAlignmentVault();
        vault = CypherAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            address(positionManager),
            address(swapRouter),
            address(algebraFactory),
            address(weth),
            address(token),
            protocolTreasury,
            address(0), // zRouter
            address(0), // zQuoter
            address(0), // priceValidator inert
            alignmentRegistry,
            TARGET_ID
        );
    }

    function test_deployLiquidity_createsPoolAndMintsLP() public {
        uint256 ethReserve = 1 ether;
        uint256 tokenReserve = 1000e18;

        // Mint tokens to deployer module (simulating transfer from bonding instance)
        token.mint(address(deployer), tokenReserve);

        vm.deal(address(this), ethReserve);
        deployer.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: protocolTreasury,
                token: address(token),
                vault: address(vault),
                instance: instance,
                creator: address(0),
                carveEth: 0,
                excessEth: 0
            })
        );

        // D2 — decoupled launch LP: the graduation position is minted to the INSTANCE, not the vault.
        // The mock NFPM assigns tokenId 1 to the first mint; the instance (this test contract) owns it.
        assertEq(positionManager.ownerOf(1), instance, "launch LP owned by the instance, not the vault");
        assertNotEq(algebraFactory.poolByPair(address(token), address(weth)), address(0), "pool created");
        // The vault is NOT coupled to the launch position: it registers no launch tokenId/pool.
        assertEq(vault.lpTokenId(), 0, "vault holds no launch position (registerPosition dropped)");
        // The 19% tithe still lands on the vault via receiveContribution, crediting the instance.
        assertGt(vault.benefactorContribution(instance), 0);
    }

    /// @dev noesis-119 sqrtPrice clamp (Uni parity): an extreme reserve ratio drives the derived
    ///      sqrtPriceX96 below MIN_SQRT_PRICE. Pre-fix that sub-range value is fed straight to
    ///      `IAlgebraPool.initialize`, which on a real Algebra pool reverts (price below the valid tick
    ///      range) — a graduation DoS. The clamp pins it to MIN_SQRT_PRICE+1 so init is always valid.
    ///      Uses a token that sorts below WETH (token0), so a tiny ETH-LP leg over a huge token reserve
    ///      makes amount1/amount0 ≈ 0 and the sqrt underflow the MIN bound.
    function test_setupPool_clampsExtremeReserveRatio() public {
        // Deploy a token deterministically ordered below WETH so token == token0 (tokenIsZero).
        MockERC20 lowTok = new MockERC20("Low", "LOW");
        uint256 salt;
        while (address(lowTok) >= address(weth)) {
            lowTok = new MockERC20(string(abi.encodePacked("Low", salt)), "LOW");
            salt++;
            require(salt < 256, "could not sort token below weth");
        }

        uint256 ethReserve = 1000; // wei — ethForPool (80%) = 800 wei, a near-zero LP-eth leg
        uint256 tokenReserve = 1e48; // huge token side → amount1/amount0 underflows MIN_SQRT_PRICE

        lowTok.mint(address(deployer), tokenReserve);
        vm.deal(address(this), ethReserve);
        deployer.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: protocolTreasury,
                token: address(lowTok),
                vault: address(vault),
                instance: instance,
                creator: address(0),
                carveEth: 0,
                excessEth: 0
            })
        );

        address pool = algebraFactory.poolByPair(address(lowTok), address(weth));
        assertNotEq(pool, address(0), "pool created");
        uint160 seeded = MockAlgebraPool(pool).sqrtPriceX96();

        assertEq(seeded, TickMath.MIN_SQRT_PRICE + 1, "extreme-ratio sqrtPrice clamped up to MIN bound");
        // A valid (clamped) init price sits within the inclusive tick range.
        assertGe(seeded, TickMath.MIN_SQRT_PRICE);
        assertLe(seeded, TickMath.MAX_SQRT_PRICE);
    }

    /// @dev The clamp is inert for a normal reserve ratio: the seeded price equals the exact derived
    ///      sqrtPriceX96 and is strictly inside the tick bounds (no clamp applied).
    function test_setupPool_normalRatioUnclamped() public {
        uint256 ethReserve = 1 ether;
        uint256 tokenReserve = 1000e18;

        token.mint(address(deployer), tokenReserve);
        vm.deal(address(this), ethReserve);
        deployer.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: tokenReserve,
                protocolTreasury: protocolTreasury,
                token: address(token),
                vault: address(vault),
                instance: instance,
                creator: address(0),
                carveEth: 0,
                excessEth: 0
            })
        );

        address pool = algebraFactory.poolByPair(address(token), address(weth));
        uint160 seeded = MockAlgebraPool(pool).sqrtPriceX96();

        uint256 ethForPool = 0.8 ether; // 80% LP leg, no carve
        (uint256 amount0, uint256 amount1) =
            address(token) < address(weth) ? (tokenReserve, ethForPool) : (ethForPool, tokenReserve);
        uint160 expected = uint160(FixedPointMathLib.sqrt(FixedPointMathLib.fullMulDiv(amount1, 1 << 192, amount0)));

        assertEq(seeded, expected, "normal ratio: seeded price equals the exact derived sqrtPrice");
        assertGt(seeded, TickMath.MIN_SQRT_PRICE + 1, "strictly above MIN bound (not clamped)");
        assertLt(seeded, TickMath.MAX_SQRT_PRICE - 1, "strictly below MAX bound (not clamped)");
    }

    function test_implementsUniformInterface() public view {
        ILiquidityDeployerModule d = ILiquidityDeployerModule(address(deployer));
        assertTrue(address(d) != address(0));
    }

    function test_deployLiquidity_pays119_80_split() public {
        token.mint(address(deployer), 1000e18);
        uint256 ethReserve = 1 ether;

        vm.deal(address(this), ethReserve);
        uint256 treasuryBefore = protocolTreasury.balance;
        uint256 vaultBefore = address(vault).balance;

        deployer.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: 1000e18,
                protocolTreasury: protocolTreasury,
                token: address(token),
                vault: address(vault),
                instance: instance,
                creator: address(0),
                carveEth: 0,
                excessEth: 0
            })
        );

        // Protocol gets 1% = 0.01 ETH
        assertEq(protocolTreasury.balance - treasuryBefore, 0.01 ether, "Protocol should get 1%");
        // Vault gets 19% = 0.19 ETH via receiveContribution
        assertEq(address(vault).balance - vaultBefore, 0.19 ether, "Vault should get 19%");
    }

    // ── Creator carve ─────────────────────────────────────────────────────────

    /// @notice Tithed carve deltas: creator 80% of carve; vault 19% raise + 19% carve; protocol
    ///         1% raise + 1% carve; the LP leg loses exactly the carve.
    function test_deployLiquidity_carve_paysCreatorVaultProtocol() public {
        address creator = makeAddr("creator");
        token.mint(address(deployer), 1000e18);
        uint256 ethReserve = 1 ether;
        uint256 carve = 0.1 ether;

        vm.deal(address(this), ethReserve);
        uint256 treasuryBefore = protocolTreasury.balance;
        uint256 vaultBefore = address(vault).balance;

        vm.expectEmit(true, true, false, true);
        emit CypherLiquidityDeployerModule.CreatorCarvePaid(instance, creator, carve, carve);

        deployer.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: 1000e18,
                protocolTreasury: protocolTreasury,
                token: address(token),
                vault: address(vault),
                instance: instance,
                creator: creator,
                carveEth: carve,
                excessEth: 0
            })
        );

        assertEq(protocolTreasury.balance - treasuryBefore, 0.01 ether + 0.001 ether, "protocol = 1% raise + 1% carve");
        assertEq(address(vault).balance - vaultBefore, 0.19 ether + 0.019 ether, "vault = 19% raise + 19% carve");
        assertEq(creator.balance, 0.08 ether, "creator = 80% of carve");
        // The LP leg = LP80 - carve = 0.8 - 0.1 = 0.7 (WETH deposited for the position). The vault
        // credits the benefactor BOTH the LP registration (0.7) and the receiveContribution
        // (0.209), so the tracked contribution is their sum.
        assertEq(weth.balanceOf(address(positionManager)), 0.7 ether, "LP leg loses exactly the carve");
        // D2: the launch position is no longer registered on the vault, so the LP leg (0.7) is NOT
        // credited as a vault contribution — only the 19% raise + 19% carve tithe (0.209) is.
        assertEq(vault.benefactorContribution(instance), 0.209 ether, "contribution = vault cut only");
    }

    /// @notice The clamp residue rides the SAME rail as the carve and is reported apart from it. The
    ///         payout literals are character-for-character those of
    ///         `test_deployLiquidity_carve_paysCreatorVaultProtocol` above, whose single carve leg is
    ///         this test's two legs summed: the split changes the reporting and nothing else.
    /// @dev Must fail if the two legs are re-merged — `requested` would then be the sum, which is what
    ///      the creator's declared allowance is measured against.
    function test_deployLiquidity_carveAndExcess_titheTogetherReportApart() public {
        address creator = makeAddr("creator");
        token.mint(address(deployer), 1000e18);
        uint256 ethReserve = 1 ether;
        uint256 carve = 0.06 ether;
        uint256 excess = 0.04 ether;

        vm.deal(address(this), ethReserve);
        uint256 treasuryBefore = protocolTreasury.balance;
        uint256 vaultBefore = address(vault).balance;

        vm.expectEmit(true, true, false, true);
        emit CypherLiquidityDeployerModule.CreatorCarvePaid(instance, creator, carve, carve);
        vm.expectEmit(true, false, false, true);
        emit CypherLiquidityDeployerModule.GraduationExcessTithed(instance, excess);

        deployer.deployLiquidity{ value: ethReserve }(
            ILiquidityDeployerModule.DeployParams({
                ethReserve: ethReserve,
                tokenReserve: 1000e18,
                protocolTreasury: protocolTreasury,
                token: address(token),
                vault: address(vault),
                instance: instance,
                creator: creator,
                carveEth: carve,
                excessEth: excess
            })
        );

        assertEq(
            protocolTreasury.balance - treasuryBefore, 0.01 ether + 0.001 ether, "protocol = 1% raise + 1% both legs"
        );
        assertEq(address(vault).balance - vaultBefore, 0.19 ether + 0.019 ether, "vault = 19% raise + 19% both legs");
        assertEq(creator.balance, 0.08 ether, "creator = 80% of both legs");
        assertEq(weth.balanceOf(address(positionManager)), 0.7 ether, "LP leg loses exactly the two legs");
        assertEq(vault.benefactorContribution(instance), 0.209 ether, "contribution = vault cut only");
    }

    // ── Caller guard (strict, registry-checked) ───────────────────────────────

    function _guardParams() internal view returns (ILiquidityDeployerModule.DeployParams memory p) {
        p = ILiquidityDeployerModule.DeployParams({
            ethReserve: 1 ether,
            tokenReserve: 1000e18,
            protocolTreasury: protocolTreasury,
            token: address(token),
            vault: address(vault),
            instance: address(this),
            creator: address(0),
            carveEth: 0,
            excessEth: 0
        });
    }

    /// @notice An unregistered caller acting as its own instance reverts: the registry check fails.
    function test_deployLiquidity_revertsForUnregisteredInstance() public {
        registry.setRegisteredInstance(address(this), false);
        token.mint(address(deployer), 1000e18);
        vm.deal(address(this), 1 ether);
        vm.expectRevert(CypherLiquidityDeployerModule.UnauthorizedCaller.selector);
        deployer.deployLiquidity{ value: 1 ether }(_guardParams());
    }

    /// @notice A caller passing a crafted p.instance it does not control reverts (no impersonation).
    function test_deployLiquidity_revertsWhenSenderNotInstance() public {
        token.mint(address(deployer), 1000e18);
        vm.deal(address(this), 1 ether);
        ILiquidityDeployerModule.DeployParams memory p = _guardParams();
        p.instance = makeAddr("victimInstance"); // registered per mock default, but != msg.sender
        vm.expectRevert(CypherLiquidityDeployerModule.UnauthorizedCaller.selector);
        deployer.deployLiquidity{ value: 1 ether }(p);
    }
}
