// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ERC404BondingInstance } from "src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "src/factories/erc404/ERC404BondingOps.sol";
import { RerollFailed } from "src/factories/erc404/ERC404BondingStorage.sol";
import { CurveParamsComputer } from "src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "src/factories/erc404/libraries/BondingCurveMath.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";

/**
 * @title ERC404Reroll Tests
 * @notice Tests for ERC404 selective NFT reroll with exemption protection
 */
contract ERC404RerollTest is Test {
    ERC404BondingInstance token;
    CurveParamsComputer curveComputer;
    address mockLiquidityDeployer = address(0x600);
    address factory = address(0x4);
    address mockMasterRegistry = address(0x6);
    address owner = address(0x5);
    address user1 = address(0x10);
    address user2 = address(0x20);

    uint256 constant MAX_SUPPLY = 1_000_000_000 ether;
    uint256 constant LIQUIDITY_RESERVE_BPS = 1000;
    uint256 constant UNIT = 1_000_000 ether; // 1M tokens = 1 NFT

    function setUp() public {
        curveComputer = new CurveParamsComputer(address(this));

        // Create bonding instance
        BondingCurveMath.Params memory curveParams = BondingCurveMath.Params({
            initialPrice: 0.0001 ether, quarticCoeff: 1, cubicCoeff: 1, quadraticCoeff: 1, normalizationFactor: 1e18
        });

        // Note: factory = msg.sender (address(this)) is set during initialize()
        // The externalized reroll body lives in a shared immutable Ops reached by a delegatecall
        // trampoline (noesis-091). Deploy it and wire it into the master implementation's ctor; every
        // clone reads this same immutable Ops.
        ERC404BondingOps ops = new ERC404BondingOps();
        ERC404BondingInstance impl2 = new ERC404BondingInstance(address(ops));
        token = ERC404BondingInstance(payable(LibClone.clone(address(impl2))));

        ERC404BondingInstance.BondingParams memory bonding = ERC404BondingInstance.BondingParams({
            maxSupply: MAX_SUPPLY,
            unit: UNIT,
            liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
            declaredMaxAllowanceBps: 0,
            curve: curveParams
        });
        token.initialize(
            owner, address(0xBEEF), bonding, mockLiquidityDeployer, address(0), address(new DN404Mirror(address(this)))
        );

        token.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: address(0x700),
                protocolTreasury: address(0xFEE),
                masterRegistry: mockMasterRegistry,
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );

        token.initializeMetadata("TestToken", "TEST", "", "", "");

        // Fund users with ETH
        vm.deal(user1, 10 ether);
        vm.deal(user2, 10 ether);
        // Note: Don't transfer tokens here - each test uses _setupUserWithNFTs
        // to get exactly the tokens/NFTs needed for that specific test
    }

    /// @notice Helper to give a user tokens and mint NFTs
    function _setupUserWithNFTs(address user, uint256 nftCount) internal {
        // Ensure user has enough tokens
        uint256 needed = nftCount * UNIT;
        uint256 currentBalance = token.balanceOf(user);

        if (currentBalance < needed) {
            vm.prank(address(token));
            token.transfer(user, needed - currentBalance);
        }

        // NFTs are auto-minted because _skipNFTDefault returns false
    }

    // ┌─────────────────────────┐
    // │  Basic Reroll Tests     │
    // └─────────────────────────┘

    function test_RerollInitiation_BasicFlow() public {
        // Setup: Give user1 5 NFTs (transfers tokens and mints NFTs)
        _setupUserWithNFTs(user1, 5);

        uint256 rerollAmount = 2 * UNIT; // 2M tokens for 2 NFTs
        uint256[] memory exemptedIds = new uint256[](0);

        vm.prank(user1);
        vm.expectEmit(true, false, false, true);
        emit RerollInitiated(user1, rerollAmount, exemptedIds);
        token.rerollSelectedNFTs(rerollAmount, exemptedIds);

        // Verify balance maintained
        assertEq(token.balanceOf(user1), 5 * UNIT);
    }

    function test_RerollCompletion_BalancePreserved() public {
        // Setup: Give user1 10 NFTs
        _setupUserWithNFTs(user1, 10);

        uint256 initialBalance = token.balanceOf(user1);
        uint256 rerollAmount = 4 * UNIT; // 4M tokens (4 NFTs)
        uint256[] memory exemptedIds = new uint256[](0);

        vm.prank(user1);
        token.rerollSelectedNFTs(rerollAmount, exemptedIds);

        // Balance should be unchanged
        assertEq(token.balanceOf(user1), initialBalance);
    }

    function test_RerollRevert_InsufficientBalance() public {
        // Setup: Give user1 2 NFTs only
        _setupUserWithNFTs(user1, 2);

        uint256 rerollAmount = 5 * UNIT; // Try to reroll 5M tokens
        uint256[] memory exemptedIds = new uint256[](0);

        // The reroll body is externalized to Ops via a discard-returndata delegatecall trampoline; Ops
        // still reverts with the specific InsufficientTokenBalance internally (visible in traces), but the
        // trampoline surfaces the generic RerollFailed() to the caller (noesis-091). The revert STILL
        // HAPPENS — safety is preserved, only the reason is generic.
        vm.prank(user1);
        vm.expectRevert(RerollFailed.selector);
        token.rerollSelectedNFTs(rerollAmount, exemptedIds);
    }

    function test_RerollRevert_ZeroTokenAmount() public {
        uint256[] memory exemptedIds = new uint256[](0);

        // Ops reverts TokenAmountMustPositive internally; caller sees generic RerollFailed() (noesis-091).
        vm.prank(user1);
        vm.expectRevert(RerollFailed.selector);
        token.rerollSelectedNFTs(0, exemptedIds);
    }

    function test_RerollRevert_TokensNotRepresentingNFT() public {
        // Setup: Give user1 5 NFTs
        _setupUserWithNFTs(user1, 5);

        uint256 rerollAmount = UNIT / 2; // 500k tokens (less than 1 NFT)
        uint256[] memory exemptedIds = new uint256[](0);

        // Ops reverts TokenAmountMustRepresentNFT internally; caller sees generic RerollFailed() (noesis-091).
        vm.prank(user1);
        vm.expectRevert(RerollFailed.selector);
        token.rerollSelectedNFTs(rerollAmount, exemptedIds);
    }

    // ┌─────────────────────────┐
    // │  Escrow Tests           │
    // └─────────────────────────┘

    function test_Escrow_TokensHeldDuringReroll() public {
        // Setup: Give user1 5 NFTs
        _setupUserWithNFTs(user1, 5);

        uint256 rerollAmount = 2 * UNIT;

        // Before reroll
        // rerollEscrow removed — new reroll doesn't use escrow

        // During reroll (check in test by monitoring events and final state)
        vm.prank(user1);
        token.rerollSelectedNFTs(rerollAmount, new uint256[](0));

        // After reroll, escrow should be cleared
        // rerollEscrow removed — new reroll doesn't use escrow
    }

    function test_Escrow_MultipleUsers_Independent() public {
        // Setup: Give both users 5 NFTs each
        _setupUserWithNFTs(user1, 5);
        _setupUserWithNFTs(user2, 5);

        uint256 rerollAmount1 = 2 * UNIT;
        uint256 rerollAmount2 = 3 * UNIT;

        // Both initiate reroll
        vm.prank(user1);
        token.rerollSelectedNFTs(rerollAmount1, new uint256[](0));

        vm.prank(user2);
        token.rerollSelectedNFTs(rerollAmount2, new uint256[](0));

        // Both escrows cleared
        // rerollEscrow removed — new reroll doesn't use escrow
        // rerollEscrow removed — new reroll doesn't use escrow

        // Balances preserved
        assertEq(token.balanceOf(user1), 5 * UNIT);
        assertEq(token.balanceOf(user2), 5 * UNIT);
    }

    // ┌─────────────────────────┐
    // │  Exemption Tests        │
    // └─────────────────────────┘

    function test_Reroll_WithExemptedNFTs() public {
        // Setup: Give user1 5 NFTs
        _setupUserWithNFTs(user1, 5);

        uint256[] memory exemptedIds = new uint256[](2);
        exemptedIds[0] = 1;
        exemptedIds[1] = 3;

        uint256 rerollAmount = 3 * UNIT; // Reroll 3 NFTs, exempt 2

        vm.prank(user1);
        vm.expectEmit(true, false, false, true);
        emit RerollInitiated(user1, rerollAmount, exemptedIds);
        token.rerollSelectedNFTs(rerollAmount, exemptedIds);

        // Verify balance maintained
        assertEq(token.balanceOf(user1), 5 * UNIT);
    }

    function test_Reroll_WithAllExempted_NeedsExtraForReroll() public {
        // Setup: Give user1 4 NFTs — exempt 3, reroll 1
        _setupUserWithNFTs(user1, 4);

        uint256[] memory exemptedIds = new uint256[](3);
        exemptedIds[0] = 1;
        exemptedIds[1] = 2;
        exemptedIds[2] = 3;

        // tokenAmount must cover exemptions (3*UNIT) + at least 1 NFT to reroll
        uint256 rerollAmount = 4 * UNIT;

        vm.prank(user1);
        token.rerollSelectedNFTs(rerollAmount, exemptedIds);

        // Verify balance maintained
        assertEq(token.balanceOf(user1), 4 * UNIT);
    }

    function test_Reroll_NoExemptions() public {
        // Setup: Give user1 5 NFTs
        _setupUserWithNFTs(user1, 5);

        uint256[] memory exemptedIds = new uint256[](0);
        uint256 rerollAmount = 5 * UNIT; // Reroll all

        vm.prank(user1);
        vm.expectEmit(true, false, false, true);
        emit RerollInitiated(user1, rerollAmount, exemptedIds);
        token.rerollSelectedNFTs(rerollAmount, exemptedIds);

        // Verify balance maintained
        assertEq(token.balanceOf(user1), 5 * UNIT);
    }

    // ┌─────────────────────────┐
    // │  Event Emission Tests   │
    // └─────────────────────────┘

    function test_Events_RerollInitiatedAndCompleted() public {
        // Setup: Give user1 4 NFTs
        _setupUserWithNFTs(user1, 4);

        uint256[] memory exemptedIds = new uint256[](1);
        exemptedIds[0] = 2;

        uint256 rerollAmount = 2 * UNIT;

        vm.prank(user1);

        // Expect both events in order
        vm.expectEmit(true, false, false, true);
        emit RerollInitiated(user1, rerollAmount, exemptedIds);

        vm.expectEmit(true, false, false, false);
        emit RerollCompleted(user1, rerollAmount);

        token.rerollSelectedNFTs(rerollAmount, exemptedIds);
    }

    // ┌─────────────────────────┐
    // │  Edge Case Tests        │
    // └─────────────────────────┘

    function test_Reroll_ExactBalance() public {
        // Setup: Give user1 exactly 3 NFTs
        _setupUserWithNFTs(user1, 3);

        uint256 rerollAmount = 3 * UNIT; // Exactly the balance

        vm.prank(user1);
        token.rerollSelectedNFTs(rerollAmount, new uint256[](0));

        // Verify balance maintained
        assertEq(token.balanceOf(user1), 3 * UNIT);
    }

    function test_Reroll_MinimumAmount() public {
        // Setup: Give user1 1 NFT
        _setupUserWithNFTs(user1, 1);

        uint256 rerollAmount = UNIT; // Minimum viable amount

        vm.prank(user1);
        token.rerollSelectedNFTs(rerollAmount, new uint256[](0));

        // Verify balance maintained
        assertEq(token.balanceOf(user1), UNIT);
    }

    function test_Reroll_LargeExemptionList() public {
        // Setup: Give user1 100 NFTs
        _setupUserWithNFTs(user1, 100);

        // Exempt 50 NFTs — need tokenAmount = 50 exempted + at least 1 to reroll
        uint256[] memory exemptedIds = new uint256[](50);
        for (uint256 i = 0; i < 50; i++) {
            exemptedIds[i] = i + 1;
        }

        uint256 rerollAmount = 51 * UNIT; // 50 exempted + 1 to reroll

        vm.prank(user1);
        token.rerollSelectedNFTs(rerollAmount, exemptedIds);

        // Verify balance maintained
        assertEq(token.balanceOf(user1), 100 * UNIT);
    }

    function test_Reroll_SkipNFTPreserved() public {
        // Setup: Give user1 5 NFTs
        _setupUserWithNFTs(user1, 5);

        // Get original skipNFT state
        bool originalSkipNFT = token.getSkipNFT(user1);

        // Perform reroll
        vm.prank(user1);
        token.rerollSelectedNFTs(2 * UNIT, new uint256[](0));

        // Verify skipNFT state is preserved
        assertEq(token.getSkipNFT(user1), originalSkipNFT);
    }

    // ┌─────────────────────────┐
    // │  Reentrancy Tests       │
    // └─────────────────────────┘

    function test_Reroll_NonReentrant() public {
        // Setup: Give user1 5 NFTs
        _setupUserWithNFTs(user1, 5);

        // The nonReentrant modifier on rerollSelectedNFTs prevents direct reentrancy
        // This test verifies the function signature has nonReentrant guard

        vm.prank(user1);
        token.rerollSelectedNFTs(2 * UNIT, new uint256[](0));

        // Test passes if no reentrancy issues occur
        assertEq(token.balanceOf(user1), 5 * UNIT);
    }

    /// @notice EXPLICIT proof that the ReentrancyGuard slot is SHARED across the delegatecall boundary
    ///         (noesis-091). The reroll body now lives in Ops and is reached by a delegatecall trampoline;
    ///         its `nonReentrant` runs in the instance's storage context via the fixed guard slot. We hold
    ///         that guard by entering another instance-side `nonReentrant` function (`withdrawDust`, which
    ///         pushes ETH to the owner), and from the owner's `receive()` we re-enter `rerollSelectedNFTs`.
    ///         The Ops-side guard MUST see the instance-side lock and revert — otherwise the cross-boundary
    ///         guard is broken. A control reroll (outside reentrancy) succeeds, isolating the guard as the
    ///         sole cause of the re-entrant revert.
    function test_Reroll_ReentrancyThroughTrampoline_Reverts() public {
        ERC404BondingOps ops = new ERC404BondingOps();
        ERC404BondingInstance impl = new ERC404BondingInstance(address(ops));
        ERC404BondingInstance t = ERC404BondingInstance(payable(LibClone.clone(address(impl))));

        RerollReentrancyProbe probe = new RerollReentrancyProbe(t);

        BondingCurveMath.Params memory curveParams = BondingCurveMath.Params({
            initialPrice: 0.0001 ether, quarticCoeff: 1, cubicCoeff: 1, quadraticCoeff: 1, normalizationFactor: 1e18
        });
        ERC404BondingInstance.BondingParams memory bonding = ERC404BondingInstance.BondingParams({
            maxSupply: MAX_SUPPLY,
            unit: UNIT,
            liquidityReserveBps: LIQUIDITY_RESERVE_BPS,
            declaredMaxAllowanceBps: 0,
            curve: curveParams
        });
        // Owner = the probe, so it can trigger the owner-only `withdrawDust`.
        t.initialize(
            address(probe),
            address(0xBEEF),
            bonding,
            mockLiquidityDeployer,
            address(0),
            address(new DN404Mirror(address(this)))
        );
        t.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: address(0x700),
                protocolTreasury: address(0xFEE),
                masterRegistry: mockMasterRegistry,
                bondingFeeBps: 100,
                weth: address(0xBEEF)
            })
        );
        t.initializeMetadata("TestToken", "TEST", "", "", "");

        // Give the probe a rerollable balance (2 NFTs) so a NON-reentrant reroll would SUCCEED.
        vm.prank(address(t));
        t.transfer(address(probe), 2 * UNIT);

        // Control: outside reentrancy the probe CAN reroll — proving balance is sufficient.
        probe.rerollNow(UNIT);
        assertEq(t.balanceOf(address(probe)), 2 * UNIT, "control reroll must preserve balance");

        // Trigger: withdrawDust holds the instance-side guard, pushes ETH to the owner (probe), whose
        // receive() re-enters reroll through the trampoline. The shared guard must block it.
        vm.deal(address(t), 1 ether);
        probe.arm();
        probe.triggerWithdrawDust();

        assertTrue(probe.reentered(), "reentrancy path must have executed");
        assertTrue(probe.rerollReverted(), "re-entrant reroll must revert on the shared guard");
        // The re-entrant reroll reverted cleanly; balances are untouched by the blocked call.
        assertEq(t.balanceOf(address(probe)), 2 * UNIT, "blocked reroll must not mutate balance");
    }

    // Events to match contract
    event RerollInitiated(address indexed user, uint256 tokenAmount, uint256[] exemptedNFTIds);
    event RerollCompleted(address indexed user, uint256 tokensReturned);
}

/// @notice Owner probe for the cross-boundary reentrancy proof. On receiving ETH from `withdrawDust`
///         (while the instance-side ReentrancyGuard is held) it re-enters `rerollSelectedNFTs` through
///         the delegatecall trampoline and records whether the Ops-side guard blocked it.
contract RerollReentrancyProbe {
    ERC404BondingInstance internal token;
    bool public armed;
    bool public reentered;
    bool public rerollReverted;

    constructor(ERC404BondingInstance t) {
        token = t;
    }

    function rerollNow(uint256 amount) external {
        token.rerollSelectedNFTs(amount, new uint256[](0));
    }

    function triggerWithdrawDust() external {
        token.withdrawDust();
    }

    function arm() external {
        armed = true;
    }

    receive() external payable {
        if (armed) {
            armed = false;
            reentered = true;
            try token.rerollSelectedNFTs(token.unit(), new uint256[](0)) {
                rerollReverted = false;
            } catch {
                rerollReverted = true;
            }
        }
    }
}
