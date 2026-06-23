// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {LibClone} from "solady/utils/LibClone.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {AlignmentEndowmentVault} from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";

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
        (bool ok,) = msg.sender.call{value: amount}("");
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
contract MockStataToken {
    MockWETH public immutable wethToken;

    mapping(address => uint256) private _shares;
    uint256 public totalShares;
    uint256 public totalManaged; // total WETH under management (increases on simulateYield)

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
        return convertToAssets(_shares[owner]);
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

// ────────────────────────────────────────────────────────────────────────────
// Test contract
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

    address public alice = address(0xBB01); // EOA user
    address public agent = address(0xBB02);
    address public stranger = address(0xBB03);

    Currency public nativeCurrency = Currency.wrap(address(0));

    uint256 constant ONE_ETH = 1 ether;
    uint256 constant MATURITY = 365 days;

    // ── Events ───────────────────────────────────────────────────────────────
    event ContributionReceived(address indexed benefactor, uint256 amount);
    event PrincipalWithdrawn(address indexed benefactor, uint256 amount, bool matured);
    event Harvested(uint256 yield, address indexed community);
    event CommunityPayoutUpdated(address indexed payout);

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        // Deploy core mocks
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        masterRegistry = new MockMasterRegistry();

        // benefactorContract is a contract whose "owner" alice will be
        benefactorContract = new MockOwnable(alice);

        // Clone-deploy the vault (impl constructor sets _initialized=true)
        address impl = address(new AlignmentEndowmentVault());
        vault = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        vault.initialize(
            vaultOwner,
            address(weth),
            address(stata),
            treasury,
            address(masterRegistry),
            alignmentToken,
            communityPayout
        );

        // Fund EOAs and test contract with ETH
        vm.deal(alice, 100 ether);
        vm.deal(address(this), 100 ether);

        // Allow agent in masterRegistry
        masterRegistry.setAgent(agent, true);
    }

    // ── Helper ────────────────────────────────────────────────────────────────

    /// @dev Contribute ETH from alice with alice as benefactor (simplest case).
    function _contributeAlice(uint256 amount) internal {
        vm.prank(alice);
        vault.receiveContribution{value: amount}(nativeCurrency, amount, alice);
    }

    /// @dev Contribute on behalf of benefactorContract.
    function _contributeBenefactor(uint256 amount) internal {
        vm.prank(alice);
        vault.receiveContribution{value: amount}(nativeCurrency, amount, address(benefactorContract));
    }

    /// @dev Give this test contract WETH, approve stata, call simulateYield.
    function _simulateYield(uint256 extra) internal {
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
        assertEq(vault.owner(), vaultOwner);
    }

    function test_initialize_revertsIfCalledAgain() public {
        vm.expectRevert();
        vault.initialize(vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, communityPayout);
    }

    function test_implLocked() public {
        // The implementation's constructor sets _initialized; calling initialize on it reverts.
        address impl = address(new AlignmentEndowmentVault());
        vm.expectRevert();
        AlignmentEndowmentVault(payable(impl)).initialize(
            vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, communityPayout
        );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. receiveContribution — happy paths
    // ═══════════════════════════════════════════════════════════════════════

    function test_contribution_creditsPrincipal() public {
        _contributeAlice(ONE_ETH);

        assertEq(vault.principal(alice), ONE_ETH, "principal mismatch");
        assertEq(vault.totalPrincipal(), ONE_ETH, "totalPrincipal mismatch");
    }

    function test_contribution_setsDepositTimeOnFirst() public {
        vm.warp(1_000_000);
        _contributeAlice(ONE_ETH);
        assertEq(vault.depositTime(alice), 1_000_000);
    }

    function test_contribution_doesNotResetDepositTimeOnSecond() public {
        vm.warp(1_000_000);
        _contributeAlice(ONE_ETH);
        vm.warp(2_000_000);
        _contributeAlice(ONE_ETH);

        // depositTime must still be the FIRST deposit time
        assertEq(vault.depositTime(alice), 1_000_000, "depositTime should not reset");
        assertEq(vault.principal(alice), 2 * ONE_ETH, "principal should accumulate");
        assertEq(vault.totalPrincipal(), 2 * ONE_ETH);
    }

    function test_contribution_wethInStata() public {
        _contributeAlice(ONE_ETH);
        // stata should hold WETH equal to the deposit (1:1 on first deposit)
        uint256 stataAssets = stata.convertToAssets(stata.balanceOf(address(vault)));
        assertApproxEqAbs(stataAssets, ONE_ETH, 1, "stata should hold deposited WETH");
    }

    function test_contribution_emitsEvent() public {
        vm.expectEmit(true, false, false, true);
        emit ContributionReceived(alice, ONE_ETH);
        vm.prank(alice);
        vault.receiveContribution{value: ONE_ETH}(nativeCurrency, ONE_ETH, alice);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. receiveContribution — revert cases
    // ═══════════════════════════════════════════════════════════════════════

    function test_contribution_revertsNonNativeCurrency() public {
        Currency erc20 = Currency.wrap(address(0x1234));
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.NativeOnly.selector);
        vault.receiveContribution{value: ONE_ETH}(erc20, ONE_ETH, alice);
    }

    function test_contribution_revertsAmountMismatch() public {
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.AmountMismatch.selector);
        vault.receiveContribution{value: ONE_ETH}(nativeCurrency, 2 ether, alice);
    }

    function test_contribution_revertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.AmountMustBePositive.selector);
        vault.receiveContribution{value: 0}(nativeCurrency, 0, alice);
    }

    function test_contribution_revertsZeroBenefactor() public {
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.InvalidAddress.selector);
        vault.receiveContribution{value: ONE_ETH}(nativeCurrency, ONE_ETH, address(0));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. harvest — happy path
    // ═══════════════════════════════════════════════════════════════════════

    function test_harvest_splitYield() public {
        _contributeAlice(ONE_ETH);

        uint256 yieldAmount = 0.1 ether;
        _simulateYield(yieldAmount);

        // accumulatedFees == yield
        assertApproxEqAbs(vault.accumulatedFees(), yieldAmount, 2, "accumulatedFees should equal yield");

        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        vault.harvest();

        uint256 communityGot = communityPayout.balance - communityBefore;
        uint256 treasuryGot = treasury.balance - treasuryBefore;

        // 99% community, 1% treasury (allow ≤2 wei rounding)
        assertApproxEqAbs(communityGot, (yieldAmount * 9900) / 10_000, 2, "community ~99%");
        assertApproxEqAbs(treasuryGot, (yieldAmount * 100) / 10_000, 2, "treasury ~1%");

        // Principal untouched
        assertEq(vault.totalPrincipal(), ONE_ETH, "principal must not change after harvest");
    }

    function test_harvest_noYieldIsNoop() public {
        _contributeAlice(ONE_ETH);

        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        // no revert expected
        vault.harvest();

        assertEq(communityPayout.balance, communityBefore, "no transfer if zero yield");
        assertEq(treasury.balance, treasuryBefore, "no transfer if zero yield");
    }

    function test_harvest_revertsIfCommunityPayoutNotSet() public {
        // Deploy a vault with no communityPayout
        address impl = address(new AlignmentEndowmentVault());
        AlignmentEndowmentVault v2 = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        v2.initialize(vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, address(0));

        // deposit into this new vault (need a separate stata for simplicity — use same one but contribute directly)
        // Actually, both vaults share the same stata which complicates; just contribute to v2 to give it a stata position.
        // Easier: simulate yield directly is tricky across vaults. Instead verify the revert path
        // by checking harvest reverts when communityPayout==0 and there IS yield.
        //
        // We can push WETH directly into stata, then trick v2 by depositing into v2.
        vm.prank(alice);
        v2.receiveContribution{value: ONE_ETH}(nativeCurrency, ONE_ETH, alice);

        _simulateYield(0.1 ether); // this raises stata.totalManaged, so v2's position also grows

        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        v2.harvest();
    }

    function test_harvest_emitsEvent() public {
        _contributeAlice(ONE_ETH);
        _simulateYield(0.1 ether);

        vm.expectEmit(false, true, false, false);
        emit Harvested(0, communityPayout);
        vault.harvest();
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. withdrawPrincipal — matured (80 owner / 19 community / 1 platform)
    // ═══════════════════════════════════════════════════════════════════════

    function test_withdraw_matured_splits() public {
        vm.warp(1_000_000);
        _contributeBenefactor(ONE_ETH);

        // Warp past maturity
        vm.warp(1_000_000 + MATURITY);

        uint256 aliceBefore = alice.balance;
        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        // alice is owner of benefactorContract
        vm.prank(alice);
        vault.withdrawPrincipal(address(benefactorContract));

        uint256 aliceGot = alice.balance - aliceBefore;
        uint256 communityGot = communityPayout.balance - communityBefore;
        uint256 treasuryGot = treasury.balance - treasuryBefore;

        assertApproxEqAbs(aliceGot, (ONE_ETH * 8000) / 10_000, 2, "creator ~80% on matured");
        assertApproxEqAbs(communityGot, (ONE_ETH * 1900) / 10_000, 2, "community ~19% on matured");
        assertApproxEqAbs(treasuryGot, (ONE_ETH * 100) / 10_000, 2, "treasury ~1% on matured");
    }

    function test_withdraw_matured_clearsPrincipal() public {
        vm.warp(1_000_000);
        _contributeBenefactor(ONE_ETH);
        vm.warp(1_000_000 + MATURITY);

        vm.prank(alice);
        vault.withdrawPrincipal(address(benefactorContract));

        assertEq(vault.principal(address(benefactorContract)), 0, "principal cleared");
        assertEq(vault.totalPrincipal(), 0, "totalPrincipal cleared");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 6. withdrawPrincipal — early (80 community / 19 owner / 1 platform)
    // ═══════════════════════════════════════════════════════════════════════

    function test_withdraw_early_splits() public {
        vm.warp(1_000_000);
        _contributeBenefactor(ONE_ETH);

        // Do NOT warp to maturity — early withdrawal
        uint256 aliceBefore = alice.balance;
        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(alice);
        vault.withdrawPrincipal(address(benefactorContract));

        uint256 aliceGot = alice.balance - aliceBefore;
        uint256 communityGot = communityPayout.balance - communityBefore;
        uint256 treasuryGot = treasury.balance - treasuryBefore;

        assertApproxEqAbs(communityGot, (ONE_ETH * 8000) / 10_000, 2, "community ~80% on early");
        assertApproxEqAbs(aliceGot, (ONE_ETH * 1900) / 10_000, 2, "creator ~19% on early");
        assertApproxEqAbs(treasuryGot, (ONE_ETH * 100) / 10_000, 2, "treasury ~1% on early");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 7. withdrawPrincipal — auth
    // ═══════════════════════════════════════════════════════════════════════

    function test_withdraw_revertsStranger() public {
        _contributeBenefactor(ONE_ETH);

        vm.prank(stranger);
        vm.expectRevert(AlignmentEndowmentVault.NotAuthorized.selector);
        vault.withdrawPrincipal(address(benefactorContract));
    }

    function test_withdraw_agentSucceeds() public {
        vm.warp(1_000_000);
        _contributeBenefactor(ONE_ETH);
        vm.warp(1_000_000 + MATURITY);

        // agent is allowed via masterRegistry
        vm.prank(agent);
        vault.withdrawPrincipal(address(benefactorContract)); // should not revert
    }

    function test_withdraw_newOwnerCanWithdraw() public {
        _contributeBenefactor(ONE_ETH);

        address newOwner = address(0xCC01);
        vm.deal(newOwner, 1 ether);

        // alice transfers benefactorContract ownership to newOwner
        vm.prank(alice);
        benefactorContract.transferOwnership(newOwner);

        // newOwner can withdraw
        vm.prank(newOwner);
        vault.withdrawPrincipal(address(benefactorContract)); // must not revert
    }

    function test_withdraw_oldOwnerCannotAfterTransfer() public {
        _contributeBenefactor(ONE_ETH);

        address newOwner = address(0xCC02);
        vm.prank(alice);
        benefactorContract.transferOwnership(newOwner);

        // alice (old owner) can no longer withdraw
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.NotAuthorized.selector);
        vault.withdrawPrincipal(address(benefactorContract));
    }

    function test_withdraw_revertsNoPrincipal() public {
        // alice has no principal
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.NoPrincipal.selector);
        vault.withdrawPrincipal(address(benefactorContract));
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
    // 9. Admin: setCommunityPayout, migratePosition
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

    function test_migratePosition_revertsNonOwner() public {
        _contributeAlice(ONE_ETH);

        vm.prank(stranger);
        vm.expectRevert();
        vault.migratePosition();
    }

    function test_migratePosition_pullsToOwner() public {
        _contributeAlice(ONE_ETH);

        uint256 ownerBefore = vaultOwner.balance;

        vm.prank(vaultOwner);
        vault.migratePosition();

        uint256 ownerGot = vaultOwner.balance - ownerBefore;
        assertApproxEqAbs(ownerGot, ONE_ETH, 1, "migrate should send full ETH to owner");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 10. Views
    // ═══════════════════════════════════════════════════════════════════════

    function test_vaultType() public view {
        assertEq(vault.vaultType(), "AaveEndowment");
    }

    function test_supportsCapability_yieldGeneration() public view {
        assertTrue(vault.supportsCapability(keccak256("YIELD_GENERATION")));
    }

    function test_supportsCapability_unknownFalse() public view {
        assertFalse(vault.supportsCapability(keccak256("UNKNOWN")));
    }

    function test_calculateClaimableAmount_beforeMaturity() public {
        vm.warp(1_000_000);
        _contributeAlice(ONE_ETH);

        // Just before maturity
        vm.warp(1_000_000 + MATURITY - 1);
        assertEq(vault.calculateClaimableAmount(alice), 0, "not claimable before maturity");
    }

    function test_calculateClaimableAmount_atMaturity() public {
        vm.warp(1_000_000);
        _contributeAlice(ONE_ETH);

        vm.warp(1_000_000 + MATURITY);
        assertEq(vault.calculateClaimableAmount(alice), ONE_ETH, "should be claimable at maturity");
    }

    function test_getBenefactorContribution() public {
        _contributeAlice(ONE_ETH);
        assertEq(vault.getBenefactorContribution(alice), ONE_ETH);
    }

    function test_getBenefactorShares() public {
        _contributeAlice(ONE_ETH);
        assertEq(vault.getBenefactorShares(alice), ONE_ETH);
    }

    function test_totalShares_equalsTotalPrincipal() public {
        _contributeAlice(ONE_ETH);
        _contributeBenefactor(2 ether);
        assertEq(vault.totalShares(), vault.totalPrincipal());
    }

    function test_accumulatedFees_zeroWithNoYield() public {
        _contributeAlice(ONE_ETH);
        assertEq(vault.accumulatedFees(), 0);
    }

    function test_accumulatedFees_afterYield() public {
        _contributeAlice(ONE_ETH);
        uint256 y = 0.05 ether;
        _simulateYield(y);
        assertApproxEqAbs(vault.accumulatedFees(), y, 1);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 11. receive() — ETH accepted without revert
    // ═══════════════════════════════════════════════════════════════════════

    function test_receiveEth_accepted() public {
        (bool ok,) = address(vault).call{value: 0.01 ether}("");
        assertTrue(ok, "vault should accept ETH via receive()");
    }
}
