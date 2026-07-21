// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";

// ────────────────────────────────────────────────────────────────────────────
// Inline mocks (all-in-one file to avoid collision with shared mock directory)
// ────────────────────────────────────────────────────────────────────────────

/// @dev Minimal WETH9 mock: deposit/withdraw/approve/transfer/transferFrom/balanceOf/totalSupply
contract MockWETH {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;

    mapping(address => uint256) private _bal;
    mapping(address => mapping(address => uint256)) private _allowance;
    uint256 private _totalSupply;

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        _bal[msg.sender] += msg.value;
        _totalSupply += msg.value;
    }

    function withdraw(uint256 amount) external {
        require(_bal[msg.sender] >= amount, "WETH: insufficient");
        _bal[msg.sender] -= amount;
        _totalSupply -= amount;
        (bool ok,) = msg.sender.call{ value: amount }("");
        require(ok, "WETH: eth transfer failed");
    }

    function totalSupply() external view returns (uint256) {
        return _totalSupply;
    }

    function balanceOf(address account) external view returns (uint256) {
        return _bal[account];
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        _allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(_bal[msg.sender] >= amount, "WETH: insufficient");
        _bal[msg.sender] -= amount;
        _bal[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(_bal[from] >= amount, "WETH: insufficient balance");
        require(_allowance[from][msg.sender] >= amount, "WETH: insufficient allowance");
        _allowance[from][msg.sender] -= amount;
        _bal[from] -= amount;
        _bal[to] += amount;
        return true;
    }

    function allowance(address owner, address spender) external view returns (uint256) {
        return _allowance[owner][spender];
    }

    /// @dev Mint WETH to an address without ETH (test helper only)
    function mint(address to, uint256 amount) external {
        _bal[to] += amount;
        _totalSupply += amount;
    }
}

/// @dev ERC-4626-ish mock over MockWETH; tracks shares separately from assets to allow yield sim.
///      Also supports a maxWithdrawCap for testing RedeemShortfall (cap == 0 means unlimited).
contract MockStataToken {
    MockWETH public immutable wethToken;

    mapping(address => uint256) private _shares;
    uint256 public totalShares;
    uint256 public totalManaged; // total WETH under management (increases on simulateYield)

    /// @dev When non-zero, caps what maxWithdraw returns (simulates Aave liquidity crunch).
    uint256 public maxWithdrawCap;

    constructor(address _weth) {
        wethToken = MockWETH(payable(_weth));
    }

    function asset() external view returns (address) {
        return address(wethToken);
    }

    function balanceOf(address account) external view returns (uint256) {
        return _shares[account];
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        if (totalShares == 0) return 0;
        return (shares * totalManaged) / totalShares;
    }

    function maxWithdraw(address owner) external view returns (uint256) {
        uint256 full = convertToAssets(_shares[owner]);
        if (maxWithdrawCap == 0) return full;
        return full < maxWithdrawCap ? full : maxWithdrawCap;
    }

    /// @dev TEST HELPER: cap how much maxWithdraw returns (0 = no cap).
    function setMaxWithdrawCap(uint256 cap) external {
        maxWithdrawCap = cap;
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        if (totalShares == 0 || totalManaged == 0) return assets;
        return (assets * totalShares) / totalManaged;
    }

    /// @dev Pull WETH from caller, mint proportional shares to receiver.
    function deposit(uint256 assets, address receiver) external returns (uint256 shares) {
        require(assets > 0, "stata: zero assets");
        wethToken.transferFrom(msg.sender, address(this), assets);

        if (totalShares == 0 || totalManaged == 0) {
            shares = assets; // 1:1 on first deposit
        } else {
            shares = (assets * totalShares) / totalManaged;
        }

        _shares[receiver] += shares;
        totalShares += shares;
        totalManaged += assets;
        return shares;
    }

    /// @dev Withdraw `assets` worth of WETH to `receiver`, burning proportional shares from `owner`.
    function withdraw(uint256 assets, address receiver, address ownerAddr) external returns (uint256 shares) {
        require(assets > 0, "stata: zero assets");
        // ceiling division to avoid leaving dust
        shares = totalManaged == 0 ? assets : ((assets * totalShares) + totalManaged - 1) / totalManaged;
        if (shares > _shares[ownerAddr]) shares = _shares[ownerAddr]; // cap at balance

        _shares[ownerAddr] -= shares;
        totalShares -= shares;
        totalManaged -= assets;

        wethToken.transfer(receiver, assets);
        return shares;
    }

    /// @dev TEST HELPER: inject yield by transferring WETH in, raising value-per-share (no new shares).
    function simulateYield(uint256 extra) external {
        wethToken.transferFrom(msg.sender, address(this), extra);
        totalManaged += extra;
    }

    /// @dev TEST HELPER: simulate an Aave solvency impairment (e.g. bad debt) by lowering value-per-share
    ///      without burning shares — convertToAssets drops below the deposited principal. WETH backing is
    ///      reduced so redemptions still settle the (now smaller) value.
    function simulateLoss(uint256 lost) external {
        require(lost <= totalManaged, "stata: loss exceeds managed");
        totalManaged -= lost;
        wethToken.transfer(address(0xdEaD), lost); // burn the now-unbacked WETH
    }
}

/// @dev Minimal MasterRegistry mock: settable isAgent mapping.
contract MockMasterRegistry {
    mapping(address => bool) private _agents;

    function setAgent(address agent, bool flag) external {
        _agents[agent] = flag;
    }

    function isAgent(address agent) external view returns (bool) {
        return _agents[agent];
    }
}

/// @dev Stand-in benefactor: owns itself (owner=deployer), with transferable ownership.
contract MockOwnable {
    address private _owner;

    constructor(address initialOwner) {
        _owner = initialOwner;
    }

    function owner() external view returns (address) {
        return _owner;
    }

    function transferOwnership(address newOwner) external {
        require(msg.sender == _owner, "MockOwnable: not owner");
        _owner = newOwner;
    }
}

/// @dev A contract whose receive() and fallback() always revert — for testing forceSafeTransferETH.
contract RejectETH {
    receive() external payable {
        revert("RejectETH: no ETH");
    }

    fallback() external payable {
        revert("RejectETH: no ETH");
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Test contract — reworked money model (specs 2a + 2b)
// ────────────────────────────────────────────────────────────────────────────

contract AlignmentEndowmentVaultTest is Test {
    AlignmentEndowmentVault public vault;
    MockWETH public weth;
    MockStataToken public stata;
    MockMasterRegistry public masterRegistry;
    MockOwnable public benefactorContract;

    address public vaultOwner = address(0xAA01);
    address public treasury = address(0xAA02);
    address public alignmentToken = address(0xAA03);
    address public communityPayout = address(0xAA04);
    uint256 public constant TARGET_ID = 7;

    address public alice = address(0xBB01); // EOA user (owner of benefactorContract)
    address public agent = address(0xBB02);
    address public stranger = address(0xBB03);

    Currency public nativeCurrency = Currency.wrap(address(0));

    uint256 constant ONE_ETH = 1 ether;
    uint256 constant VEST = 26 weeks;

    // ── Events ───────────────────────────────────────────────────────────────
    event ContributionReceived(address indexed benefactor, uint256 amount);
    event PrincipalDeposited(address indexed benefactor, uint256 amount, uint256 indexed targetId, uint256 timestamp);
    event PrincipalVested(address indexed benefactor, uint256 amount, uint256 timestamp);
    event YieldDistributed(uint256 creatorLeg, uint256 targetLeg, uint256 protocolLeg, uint256 timestamp);
    event YieldClaimed(address indexed benefactor, address indexed recipient, uint256 amount);
    event ImpairmentRealized(uint256 shortfallBps, uint256 timestamp);
    event CommunityPayoutUpdated(address indexed payout);
    event Migrated(address indexed to, uint256 amount);

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        masterRegistry = new MockMasterRegistry();

        benefactorContract = new MockOwnable(alice);

        vault = _deployVault(communityPayout);

        vm.deal(alice, 100 ether);
        vm.deal(address(this), 100 ether);

        masterRegistry.setAgent(agent, true);

        // Deterministic base timestamp so vest math is stable.
        vm.warp(1_000_000);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _deployVault(address payout) internal returns (AlignmentEndowmentVault v) {
        address impl = address(new AlignmentEndowmentVault());
        v = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        v.initialize(
            vaultOwner,
            address(weth),
            address(stata),
            treasury,
            address(masterRegistry),
            alignmentToken,
            TARGET_ID,
            payout
        );
    }

    /// @dev Contribute ETH from alice on behalf of benefactorContract (a contract benefactor).
    function _contributeBenefactor(uint256 amount) internal {
        vm.prank(alice);
        vault.receiveContribution{ value: amount }(nativeCurrency, amount, address(benefactorContract));
    }

    /// @dev Deploy a second MockOwnable and contribute from it (distinct benefactor).
    function _contributeNewBenefactor(address owner_, uint256 amount) internal returns (MockOwnable b) {
        b = new MockOwnable(owner_);
        vm.deal(owner_, owner_.balance + amount);
        vm.prank(owner_);
        vault.receiveContribution{ value: amount }(nativeCurrency, amount, address(b));
    }

    /// @dev Simulate yield: inject ETH into MockWETH (so withdrawals are backed), mint the
    ///      corresponding WETH balance to this test contract, approve stata, and call simulateYield.
    function _simulateYield(uint256 extra) internal {
        vm.deal(address(weth), address(weth).balance + extra);
        weth.mint(address(this), extra);
        weth.approve(address(stata), extra);
        stata.simulateYield(extra);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 1. Initialization
    // ═══════════════════════════════════════════════════════════════════════

    function test_initialize_setsSlots() public view {
        assertEq(address(vault.weth()), address(weth));
        assertEq(address(vault.stataToken()), address(stata));
        assertEq(vault.protocolTreasury(), treasury);
        assertEq(address(vault.masterRegistry()), address(masterRegistry));
        assertEq(vault.alignmentToken(), alignmentToken);
        assertEq(vault.communityPayout(), communityPayout);
        assertEq(vault.targetId(), TARGET_ID);
        assertEq(vault.owner(), vaultOwner);
        assertEq(vault.VEST_DURATION(), VEST);
    }

    function test_initialize_revertsIfCalledAgain() public {
        vm.expectRevert();
        vault.initialize(
            vaultOwner,
            address(weth),
            address(stata),
            treasury,
            address(masterRegistry),
            alignmentToken,
            TARGET_ID,
            communityPayout
        );
    }

    function test_implLocked() public {
        address impl = address(new AlignmentEndowmentVault());
        vm.expectRevert();
        AlignmentEndowmentVault(payable(impl))
            .initialize(
                vaultOwner,
                address(weth),
                address(stata),
                treasury,
                address(masterRegistry),
                alignmentToken,
                TARGET_ID,
                communityPayout
            );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. receiveContribution — happy + revert
    // ═══════════════════════════════════════════════════════════════════════

    function test_contribution_creditsEscrowedPrincipal() public {
        _contributeBenefactor(ONE_ETH);
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), ONE_ETH);
        assertEq(vault.totalEscrowedPrincipal(), ONE_ETH);
        assertEq(vault.principalOf(address(benefactorContract)), ONE_ETH);
        assertEq(vault.totalPrincipalCommittedAllTime(), ONE_ETH);
        assertEq(vault.totalPrincipalLocked(), ONE_ETH);
    }

    function test_contribution_setsDepositTimeOnFirst() public {
        _contributeBenefactor(ONE_ETH);
        assertEq(vault.depositTime(address(benefactorContract)), 1_000_000);
    }

    function test_contribution_doesNotResetDepositTimeOnSecond() public {
        _contributeBenefactor(ONE_ETH);
        vm.warp(2_000_000);
        _contributeBenefactor(ONE_ETH);
        assertEq(vault.depositTime(address(benefactorContract)), 1_000_000, "depositTime must not reset");
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 2 * ONE_ETH);
        assertEq(vault.totalEscrowedPrincipal(), 2 * ONE_ETH);
        assertEq(vault.totalPrincipalCommittedAllTime(), 2 * ONE_ETH);
    }

    function test_contribution_emitsBothEvents() public {
        vm.expectEmit(true, false, false, true);
        emit ContributionReceived(address(benefactorContract), ONE_ETH);
        vm.expectEmit(true, true, false, true);
        emit PrincipalDeposited(address(benefactorContract), ONE_ETH, TARGET_ID, block.timestamp);
        vm.prank(alice);
        vault.receiveContribution{ value: ONE_ETH }(nativeCurrency, ONE_ETH, address(benefactorContract));
    }

    function test_contribution_revertsNonNativeCurrency() public {
        Currency erc20 = Currency.wrap(address(0x1234));
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.NativeOnly.selector);
        vault.receiveContribution{ value: ONE_ETH }(erc20, ONE_ETH, address(benefactorContract));
    }

    function test_contribution_revertsAmountMismatch() public {
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.AmountMismatch.selector);
        vault.receiveContribution{ value: ONE_ETH }(nativeCurrency, 2 ether, address(benefactorContract));
    }

    function test_contribution_revertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.AmountMustBePositive.selector);
        vault.receiveContribution{ value: 0 }(nativeCurrency, 0, address(benefactorContract));
    }

    function test_contribution_revertsZeroBenefactor() public {
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.InvalidAddress.selector);
        vault.receiveContribution{ value: ONE_ETH }(nativeCurrency, ONE_ETH, address(0));
    }

    function test_contribution_revertsEOABenefactor() public {
        address eoa = makeAddr("eoa_benefactor");
        assertEq(eoa.code.length, 0);
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.BenefactorNotContract.selector);
        vault.receiveContribution{ value: ONE_ETH }(nativeCurrency, ONE_ETH, eoa);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. Principal permanence — NO refund path exists
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev The old refund path is gone: calling withdrawPrincipal(address) hits no function and
    ///      no fallback (only receive() for empty calldata) → the call reverts. Principal cannot be pulled.
    function test_permanence_noWithdrawPrincipalSelector() public {
        _contributeBenefactor(ONE_ETH);
        (bool ok,) =
            address(vault).call(abi.encodeWithSignature("withdrawPrincipal(address)", address(benefactorContract)));
        assertFalse(ok, "withdrawPrincipal must not exist");
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), ONE_ETH);
    }

    /// @dev The old MATURITY_DURATION refund constant is gone.
    function test_permanence_noMaturityDuration() public {
        (bool ok,) = address(vault).staticcall(abi.encodeWithSignature("MATURITY_DURATION()"));
        assertFalse(ok, "MATURITY_DURATION must not exist");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. Vesting
    // ═══════════════════════════════════════════════════════════════════════

    function test_vest_revertsBeforeDuration() public {
        _contributeBenefactor(ONE_ETH);
        vm.warp(block.timestamp + VEST - 1);
        vm.expectRevert(AlignmentEndowmentVault.NotVested.selector);
        vault.vest(address(benefactorContract));
    }

    function test_vest_revertsNoPrincipal() public {
        vm.expectRevert(AlignmentEndowmentVault.NoPrincipal.selector);
        vault.vest(address(benefactorContract));
    }

    function test_vest_movesEscrowedToVested_permissionless() public {
        _contributeBenefactor(ONE_ETH);
        vm.warp(block.timestamp + VEST);

        vm.expectEmit(true, false, false, true);
        emit PrincipalVested(address(benefactorContract), ONE_ETH, block.timestamp);
        vm.prank(stranger); // permissionless
        vault.vest(address(benefactorContract));

        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 0, "escrow cleared");
        assertEq(vault.totalEscrowedPrincipal(), 0);
        assertEq(vault.vestedPrincipal(address(benefactorContract)), ONE_ETH, "vested set");
        assertEq(vault.vestedOf(address(benefactorContract)), ONE_ETH);
        assertEq(vault.totalVestedDeployable(), ONE_ETH);
        assertEq(vault.totalVested(), ONE_ETH);
        // Still counted as the benefactor's all-time contribution (permanent, no refund).
        assertEq(vault.getBenefactorContribution(address(benefactorContract)), ONE_ETH);
    }

    /// @dev After vest, the benefactor accrues NO creator yield on that principal.
    function test_vest_stopsCreatorAccrual() public {
        _contributeBenefactor(ONE_ETH);
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract));

        _simulateYield(ONE_ETH);
        vault.harvest();

        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0, "no creator accrual post-vest");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. harvest — two-class split (wei-exact)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Escrowed-only class: 80 creator / 19 target / 1 protocol. Two benefactors, unequal weight;
    ///      each pendingYieldOf is exact to the wei.
    function test_harvest_escrowedClass_splitAndAccumulatorExact() public {
        _contributeBenefactor(1 ether); // A = benefactorContract (weight 1)
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 3 ether); // B (weight 3)
        assertEq(vault.totalEscrowedPrincipal(), 4 ether);

        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        _simulateYield(1 ether); // Y = 1 ETH

        vm.expectEmit(false, false, false, true);
        emit YieldDistributed(0.8 ether, 0.19 ether, 0.01 ether, block.timestamp);
        vault.harvest();

        assertEq(communityPayout.balance - communityBefore, 0.19 ether, "target leg 19%");
        assertEq(treasury.balance - treasuryBefore, 0.01 ether, "protocol leg 1%");

        // creator leg 80% split by weight: A gets 1/4 = 0.2, B gets 3/4 = 0.6 — exact.
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.2 ether, "A creator yield exact");
        assertEq(vault.pendingYieldOf(address(b)), 0.6 ether, "B creator yield exact");

        assertEq(vault.totalYieldToCreators(), 0.8 ether);
        assertEq(vault.totalYieldToTarget(), 0.19 ether);
        assertEq(vault.totalProtocolFees(), 0.01 ether);
    }

    /// @dev Vested-only class: 0 creator / 99 target / 1 protocol.
    function test_harvest_vestedClass_split() public {
        _contributeBenefactor(1 ether);
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract));

        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        _simulateYield(1 ether);

        vm.expectEmit(false, false, false, true);
        emit YieldDistributed(0, 0.99 ether, 0.01 ether, block.timestamp);
        vault.harvest();

        assertEq(communityPayout.balance - communityBefore, 0.99 ether, "target leg 99% on vested");
        assertEq(treasury.balance - treasuryBefore, 0.01 ether, "protocol leg 1%");
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0, "no creator leg on vested");
    }

    /// @dev Mixed position: A vested (weight 1), B escrowed (weight 1). Yield apportioned by class.
    function test_harvest_mixedClasses_split() public {
        _contributeBenefactor(1 ether); // A
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 1 ether); // B
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract)); // A → vested; B stays escrowed

        assertEq(vault.totalEscrowedPrincipal(), 1 ether);
        assertEq(vault.totalVestedDeployable(), 1 ether);

        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        _simulateYield(1 ether); // total basis 2 ETH → escrowedYield = vestedYield = 0.5

        // escrowed 0.5 → 0.4 creator / 0.095 target / 0.005 proto
        // vested   0.5 → 0     creator / 0.495 target / 0.005 proto
        vm.expectEmit(false, false, false, true);
        emit YieldDistributed(0.4 ether, 0.59 ether, 0.01 ether, block.timestamp);
        vault.harvest();

        assertEq(communityPayout.balance - communityBefore, 0.59 ether, "target = 0.095 + 0.495");
        assertEq(treasury.balance - treasuryBefore, 0.01 ether, "protocol = 0.005 + 0.005");
        assertEq(vault.pendingYieldOf(address(b)), 0.4 ether, "B (escrowed) gets full creator leg");
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0, "A (vested) gets none");
    }

    function test_harvest_noYieldIsNoop() public {
        _contributeBenefactor(ONE_ETH);
        uint256 communityBefore = communityPayout.balance;
        vault.harvest();
        assertEq(communityPayout.balance, communityBefore);
    }

    function test_harvest_revertsIfCommunityPayoutNotSet() public {
        AlignmentEndowmentVault v2 = _deployVault(address(0));
        MockOwnable b2 = new MockOwnable(alice);
        vm.prank(alice);
        v2.receiveContribution{ value: ONE_ETH }(nativeCurrency, ONE_ETH, address(b2));
        _simulateYield(0.1 ether);
        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        v2.harvest();
    }

    /// @dev harvest still succeeds when the target sink rejects ETH (force-send).
    function test_harvest_forcesSendToRejectingCommunity() public {
        RejectETH rejecter = new RejectETH();
        vm.prank(vaultOwner);
        vault.setCommunityPayout(address(rejecter));

        _contributeBenefactor(ONE_ETH);
        _simulateYield(0.1 ether);

        uint256 rejecterBefore = address(rejecter).balance;
        vault.harvest();
        assertGt(address(rejecter).balance, rejecterBefore, "target force-sent");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6. claimYieldPurse
    // ═══════════════════════════════════════════════════════════════════════

    function test_claimYieldPurse_paysAndZeroes() public {
        _contributeBenefactor(1 ether);
        _simulateYield(1 ether);
        vault.harvest(); // A escrowed-only → creator leg 0.8 ETH

        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether);

        uint256 aliceBefore = alice.balance;
        vm.expectEmit(true, true, false, true);
        emit YieldClaimed(address(benefactorContract), alice, 0.8 ether);
        vm.prank(alice);
        uint256 got = vault.claimYieldPurse(address(benefactorContract));

        assertEq(got, 0.8 ether);
        assertEq(alice.balance - aliceBefore, 0.8 ether, "creator (owner) receives ETH");
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0, "purse zeroed");

        vm.prank(alice);
        assertEq(vault.claimYieldPurse(address(benefactorContract)), 0, "second claim zero");
    }

    function test_claimYieldPurse_revertsStranger() public {
        _contributeBenefactor(1 ether);
        _simulateYield(1 ether);
        vault.harvest();
        vm.prank(stranger);
        vm.expectRevert(AlignmentEndowmentVault.NotAuthorized.selector);
        vault.claimYieldPurse(address(benefactorContract));
    }

    function test_claimYieldPurse_agentSucceeds_paysCreator() public {
        _contributeBenefactor(1 ether);
        _simulateYield(1 ether);
        vault.harvest();

        uint256 aliceBefore = alice.balance;
        vm.prank(agent); // agent acts for the benefactor; funds still go to the creator (owner)
        vault.claimYieldPurse(address(benefactorContract));
        assertEq(alice.balance - aliceBefore, 0.8 ether, "agent claim pays creator");
    }

    function test_claimYieldPurse_newOwnerReceivesAfterTransfer() public {
        _contributeBenefactor(1 ether);
        _simulateYield(1 ether);
        vault.harvest();

        address newOwner = address(0xCC01);
        vm.prank(alice);
        benefactorContract.transferOwnership(newOwner);

        uint256 newOwnerBefore = newOwner.balance;
        vm.prank(newOwner);
        vault.claimYieldPurse(address(benefactorContract));
        assertEq(newOwner.balance - newOwnerBefore, 0.8 ether, "new owner receives creator yield");
    }

    /// @dev A creator contract that rejects ETH does not brick its own claim (force-send).
    function test_claimYieldPurse_forcesSendToRejectingCreator() public {
        RejectETH rejecter = new RejectETH();
        MockOwnable b = new MockOwnable(address(rejecter));
        vm.prank(alice);
        vault.receiveContribution{ value: 1 ether }(nativeCurrency, 1 ether, address(b));
        _simulateYield(1 ether);
        vault.harvest();

        uint256 rejecterBefore = address(rejecter).balance;
        vm.prank(address(rejecter));
        vault.claimYieldPurse(address(b));
        assertGt(address(rejecter).balance, rejecterBefore, "creator force-sent");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 7. Impairment socialization on migrate (escrow-only)
    // ═══════════════════════════════════════════════════════════════════════

    function test_migrate_impaired_socializesProRata() public {
        _contributeBenefactor(10 ether);
        _contributeNewBenefactor(address(0xCAFE), 10 ether);
        assertEq(vault.totalEscrowedPrincipal(), 20 ether);

        // 50% impairment.
        stata.simulateLoss(10 ether);
        vm.deal(address(weth), 100 ether);

        address recovery = makeAddr("recovery");
        vm.deal(recovery, 0);

        // Escrowed share = value(10) * escrowed(20)/basis(20) = 10 ETH redeemed to recovery.
        vm.prank(vaultOwner);
        vm.expectEmit(false, false, false, true);
        emit ImpairmentRealized(5000, block.timestamp);
        vault.migratePosition(recovery);

        assertApproxEqAbs(recovery.balance, 10 ether, 1e9, "escrow tranche (impaired) moved to recovery");
        // Per-benefactor accounting PRESERVED on-chain (no zero-and-forget).
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 10 ether, "ledger preserved");
        assertEq(vault.totalEscrowedPrincipal(), 20 ether, "ledger preserved");
    }

    /// @dev migrate moves only the escrowed tranche; the vested tranche stays in the position.
    function test_migrate_escrowOnly_leavesVested() public {
        _contributeBenefactor(1 ether); // A → will vest
        _contributeNewBenefactor(address(0xCAFE), 1 ether); // B → stays escrowed
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract));
        assertEq(vault.totalEscrowedPrincipal(), 1 ether);
        assertEq(vault.totalVestedDeployable(), 1 ether);

        address recovery = makeAddr("recovery");
        vm.deal(recovery, 0);

        vm.prank(vaultOwner);
        vault.migratePosition(recovery);

        // Only the escrowed 1 ETH is redeemed; vested 1 ETH remains as position value.
        assertApproxEqAbs(recovery.balance, 1 ether, 2, "only escrow tranche moved");
        assertApproxEqAbs(vault.currentPositionValue(), 1 ether, 2, "vested tranche left in position");
        assertEq(vault.totalVestedDeployable(), 1 ether, "vested accounting intact");
    }

    function test_migrate_revertsZeroRecipient() public {
        _contributeBenefactor(ONE_ETH);
        vm.prank(vaultOwner);
        vm.expectRevert(AlignmentEndowmentVault.InvalidAddress.selector);
        vault.migratePosition(address(0));
    }

    function test_migrate_revertsNonOwner() public {
        _contributeBenefactor(ONE_ETH);
        vm.prank(stranger);
        vm.expectRevert();
        vault.migratePosition(stranger);
    }

    function test_migrate_revertsNoEscrow() public {
        vm.prank(vaultOwner);
        vm.expectRevert(AlignmentEndowmentVault.NoPrincipal.selector);
        vault.migratePosition(makeAddr("recovery"));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 8. Legacy methods — revert NotSupported
    // ═══════════════════════════════════════════════════════════════════════

    function test_legacy_claimFees_reverts() public {
        vm.expectRevert(AlignmentEndowmentVault.NotSupported.selector);
        vault.claimFees();
    }

    function test_legacy_delegateBenefactor_reverts() public {
        vm.expectRevert(AlignmentEndowmentVault.NotSupported.selector);
        vault.delegateBenefactor(alice);
    }

    function test_legacy_claimFeesAsDelegate_reverts() public {
        address[] memory addrs = new address[](0);
        vm.expectRevert(AlignmentEndowmentVault.NotSupported.selector);
        vault.claimFeesAsDelegate(addrs);
    }

    function test_getBenefactorDelegate_returnsSelf() public view {
        assertEq(vault.getBenefactorDelegate(alice), alice);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 9. Admin: setCommunityPayout
    // ═══════════════════════════════════════════════════════════════════════

    function test_setCommunityPayout_ownerUpdates() public {
        address newPayout = address(0xDD01);
        vm.prank(vaultOwner);
        vm.expectEmit(true, false, false, false);
        emit CommunityPayoutUpdated(newPayout);
        vault.setCommunityPayout(newPayout);
        assertEq(vault.communityPayout(), newPayout);
    }

    function test_setCommunityPayout_revertsNonOwner() public {
        vm.prank(stranger);
        vm.expectRevert();
        vault.setCommunityPayout(address(0xDD01));
    }

    function test_setCommunityPayout_revertsZeroAddress() public {
        vm.prank(vaultOwner);
        vm.expectRevert(AlignmentEndowmentVault.InvalidAddress.selector);
        vault.setCommunityPayout(address(0));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 10. Stat surface + interface views
    // ═══════════════════════════════════════════════════════════════════════

    function test_statSurface_acrossLifecycle() public {
        _contributeBenefactor(2 ether);
        assertEq(vault.totalPrincipalLocked(), 2 ether);
        assertEq(vault.totalPrincipalCommittedAllTime(), 2 ether);
        assertEq(vault.totalVested(), 0);
        assertEq(vault.totalDeployedByTarget(), 0);
        assertApproxEqAbs(vault.currentPositionValue(), 2 ether, 2);

        _simulateYield(1 ether);
        assertApproxEqAbs(vault.accumulatedFees(), 1 ether, 2);
        vault.harvest();
        assertEq(vault.totalYieldToCreators(), 0.8 ether);
        assertEq(vault.totalYieldToTarget(), 0.19 ether);
        assertEq(vault.totalProtocolFees(), 0.01 ether);

        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract));
        assertEq(vault.totalVested(), 2 ether);
        assertEq(vault.totalPrincipalLocked(), 0);
        assertEq(vault.vestedOf(address(benefactorContract)), 2 ether);
    }

    function test_totalShares_equalsPrincipalBasis() public {
        _contributeBenefactor(1 ether);
        _contributeNewBenefactor(alice, 2 ether);
        assertEq(vault.totalShares(), 3 ether);
    }

    function test_calculateClaimableAmount_isYieldPurse() public {
        _contributeBenefactor(1 ether);
        _simulateYield(1 ether);
        vault.harvest();
        assertEq(vault.calculateClaimableAmount(address(benefactorContract)), 0.8 ether);
    }

    function test_vaultType() public view {
        assertEq(vault.vaultType(), "AaveEndowment");
    }

    function test_supportsCapability_yieldGeneration() public view {
        assertTrue(vault.supportsCapability(keccak256("YIELD_GENERATION")));
        assertFalse(vault.supportsCapability(keccak256("UNKNOWN")));
    }

    function test_accumulatedFees_zeroWithNoYield() public {
        _contributeBenefactor(ONE_ETH);
        assertEq(vault.accumulatedFees(), 0);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 11. receive() — ETH accepted without revert
    // ═══════════════════════════════════════════════════════════════════════

    function test_receiveEth_accepted() public {
        (bool ok,) = address(vault).call{ value: 0.01 ether }("");
        assertTrue(ok, "vault should accept ETH via receive()");
    }
}
