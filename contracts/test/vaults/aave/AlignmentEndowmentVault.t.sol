// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { IAlignmentRegistry } from "../../../src/master/interfaces/IAlignmentRegistry.sol";

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

/// @dev Minimal MasterRegistry mock: settable isAgent mapping + a live-readable alignmentRegistry handle
///      (the vault's `execute` resolves ambassador auth via `masterRegistry.alignmentRegistry()`).
contract MockMasterRegistry {
    mapping(address => bool) private _agents;
    IAlignmentRegistry private _alignmentRegistry;

    function setAgent(address agent, bool flag) external {
        _agents[agent] = flag;
    }

    function isAgent(address agent) external view returns (bool) {
        return _agents[agent];
    }

    function setAlignmentRegistry(address registry) external {
        _alignmentRegistry = IAlignmentRegistry(registry);
    }

    function alignmentRegistry() external view returns (IAlignmentRegistry) {
        return _alignmentRegistry;
    }
}

/// @dev Alignment-registry mock with a settable ambassador set, so `execute` auth can be driven and the
///      `removeAmbassador` backstop exercised, plus the canonical community payout the vault resolves its
///      target sink from. The vault reads `isAmbassador` and `getCommunityPayout`.
contract MockAmbassadorRegistry {
    mapping(uint256 => mapping(address => bool)) private _amb;
    mapping(uint256 => address) private _communityPayout;

    function setAmbassador(uint256 targetId, address account, bool flag) external {
        _amb[targetId][account] = flag;
    }

    /// @dev Mirrors AlignmentRegistryV1.setCommunityPayout, minus the owner gate — the canonical sink the
    ///      vault prefers over its own stored fallback.
    function setCommunityPayout(uint256 targetId, address payout) external {
        _communityPayout[targetId] = payout;
    }

    function getCommunityPayout(uint256 targetId) external view returns (address) {
        return _communityPayout[targetId];
    }

    /// @dev Mirrors AlignmentRegistryV1.removeAmbassador (the sole `execute` backstop).
    function removeAmbassador(uint256 targetId, address account) external {
        _amb[targetId][account] = false;
    }

    function isAmbassador(uint256 targetId, address account) external view returns (bool) {
        return _amb[targetId][account];
    }
}

/// @dev A trivial "DEX" a target might deploy vested capital through: takes ETH, credits an aligned-token
///      balance to the recipient. Used to prove an aligned-token buy routes through `execute`.
contract MockDeployDEX {
    mapping(address => uint256) public tokenBalanceOf;
    uint256 public totalEthIn;

    /// @notice Buy aligned tokens for `recipient`, 1 token-unit per wei (deterministic for assertions).
    function buy(address recipient) external payable {
        totalEthIn += msg.value;
        tokenBalanceOf[recipient] += msg.value;
    }
}

/// @dev Malicious deployment target that re-enters `execute` on receiving ETH. The `nonReentrant` guard
///      must make the re-entry fail; this mock records whether it did, and does NOT bubble the failure so
///      the outer call still settles — proving a single spend, not a double one.
contract ReentrantDeployer {
    AlignmentEndowmentVault public immutable vault;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(AlignmentEndowmentVault _vault) {
        vault = _vault;
    }

    receive() external payable {
        if (reentryAttempted) return; // only attempt once, avoid infinite recursion on any path
        reentryAttempted = true;
        // Attempt to re-enter and drain the corpus a second time. Swallow the result so the outer
        // `execute` interaction still returns success — the corpus must have moved exactly once.
        (bool ok,) =
            address(vault).call(abi.encodeWithSelector(vault.execute.selector, address(this), 1 wei, bytes("")));
        reentrySucceeded = ok;
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
    MockAmbassadorRegistry public ambassadorRegistry;
    MockOwnable public benefactorContract;

    address public vaultOwner = address(0xAA01);
    address public treasury = address(0xAA02);
    address public alignmentToken = address(0xAA03);
    address public communityPayout = address(0xAA04);
    uint256 public constant TARGET_ID = 7;

    address public alice = address(0xBB01); // EOA user (owner of benefactorContract)
    address public agent = address(0xBB02);
    address public stranger = address(0xBB03);
    address public ambassador = address(0xBB04); // authorized to deploy vested corpus via execute

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
    event CapitalDeployed(
        address indexed ambassador, address indexed to, uint256 value, bytes4 selector, uint256 timestamp
    );

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        weth = new MockWETH();
        stata = new MockStataToken(address(weth));
        masterRegistry = new MockMasterRegistry();
        ambassadorRegistry = new MockAmbassadorRegistry();
        masterRegistry.setAlignmentRegistry(address(ambassadorRegistry));
        ambassadorRegistry.setAmbassador(TARGET_ID, ambassador, true);

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
    // 4b. Paginated vest — the tranche array is unbounded and openly appendable
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev `receiveContribution` is permissionless, so ANY address can append tranches to ANY benefactor's
    ///      escrow array. These build that array from a third party at the minimum deposit size.
    function _grindTranches(uint256 n) internal {
        vm.deal(stranger, stranger.balance + n);
        for (uint256 k; k < n; ++k) {
            vm.prank(stranger);
            vault.receiveContribution{ value: 1 }(nativeCurrency, 1, address(benefactorContract));
        }
    }

    /// @dev Two batches with independent clocks: the first is matured at vest time, the second is not.
    function _mixedMaturityTranches(uint256 maturedCount, uint256 unmaturedCount, uint256 unit) internal {
        for (uint256 k; k < maturedCount; ++k) {
            _contributeBenefactor(unit);
        }
        vm.warp(block.timestamp + VEST / 2);
        for (uint256 k; k < unmaturedCount; ++k) {
            _contributeBenefactor(unit);
        }
        vm.warp(block.timestamp + VEST / 2 + 1);
    }

    function test_vest_paginated_zeroMaxReverts() public {
        _contributeBenefactor(ONE_ETH);
        vm.warp(block.timestamp + VEST);
        vm.expectRevert(AlignmentEndowmentVault.AmountMustBePositive.selector);
        vault.vest(address(benefactorContract), 0);
    }

    /// @dev A page wide enough to cover the whole array is a full sweep and keeps the one-argument semantics.
    function test_vest_paginated_fullPageMatchesUnbounded() public {
        _contributeBenefactor(ONE_ETH);
        vm.warp(block.timestamp + VEST);

        vm.prank(stranger);
        vault.vest(address(benefactorContract), 100);

        assertEq(vault.vestedPrincipal(address(benefactorContract)), ONE_ETH, "vested");
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 0, "escrow cleared");
    }

    /// @dev Coverage decides `NotVested`: a full sweep with nothing matured reverts; a bounded page that
    ///      has only seen a window of the array succeeds, moves no principal, and lets the caller page on.
    function test_vest_paginated_pageWithoutMaturedTranche_doesNotRevert() public {
        for (uint256 k; k < 6; ++k) {
            _contributeBenefactor(0.1 ether);
        }

        vm.expectRevert(AlignmentEndowmentVault.NotVested.selector);
        vault.vest(address(benefactorContract), 6); // covers the array → full-sweep semantics

        vault.vest(address(benefactorContract), 2); // a window only → succeeds
        assertEq(vault.vestedPrincipal(address(benefactorContract)), 0, "nothing vested by that page");
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 0.6 ether, "escrow untouched");
    }

    /// @dev The core of the bounded walk. Matured tranches are removed by swap-and-pop, which leaves
    ///      unmatured entries sitting in the slots a page has already passed. With the narrowest possible
    ///      page (one tranche per call) the walk must still reach every matured tranche.
    function test_vest_paginated_narrowestPageReachesEveryMaturedTranche() public {
        _mixedMaturityTranches(3, 3, ONE_ETH);

        for (uint256 call; call < 12; ++call) {
            vault.vest(address(benefactorContract), 1);
        }

        assertEq(vault.vestedPrincipal(address(benefactorContract)), 3 * ONE_ETH, "all matured principal vested");
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 3 * ONE_ETH, "unmatured principal untouched");
        assertEq(vault.totalVestedDeployable(), 3 * ONE_ETH);
    }

    /// @dev N bounded calls must vest exactly what one unbounded call would have, over a mixed array.
    function test_vest_paginated_multiCallEqualsUnbounded() public {
        _mixedMaturityTranches(10, 10, 0.1 ether);

        uint256 snap = vm.snapshotState();
        vault.vest(address(benefactorContract));
        uint256 vestedOnce = vault.vestedPrincipal(address(benefactorContract));
        uint256 escrowOnce = vault.escrowedPrincipal(address(benefactorContract));
        uint256 deployableOnce = vault.totalVestedDeployable();
        uint256 totalEscrowOnce = vault.totalEscrowedPrincipal();
        vm.revertToState(snap);

        for (uint256 call; call < 30; ++call) {
            vault.vest(address(benefactorContract), 3);
        }

        assertEq(vault.vestedPrincipal(address(benefactorContract)), vestedOnce, "vested total matches");
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), escrowOnce, "escrow remainder matches");
        assertEq(vault.totalVestedDeployable(), deployableOnce, "deployable corpus matches");
        assertEq(vault.totalEscrowedPrincipal(), totalEscrowOnce, "total escrow matches");
    }

    /// @dev The griefing case: a third party lengthens the array until a full walk no longer fits a block.
    ///      The vest stays reachable because the caller chooses the walk length, and the cost of a page does
    ///      not scale with the array — the walk a page performs is what the caller paid for, nothing more.
    function test_vest_paginated_staysBoundedAsArrayGrows() public {
        _contributeBenefactor(ONE_ETH);
        vm.warp(block.timestamp + VEST);
        uint256 base = vm.snapshotState();

        _grindTranches(200);
        uint256 small = vm.snapshotState();
        uint256 unboundedSmall = _gasOfUnboundedVest();
        vm.revertToState(small);
        uint256 pagedSmall = _gasOfPagedVest(4);

        vm.revertToState(base);

        _grindTranches(800);
        uint256 large = vm.snapshotState();
        uint256 unboundedLarge = _gasOfUnboundedVest();
        vm.revertToState(large);
        uint256 pagedLarge = _gasOfPagedVest(4);

        assertEq(vault.vestedPrincipal(address(benefactorContract)), ONE_ETH, "paged call vested the matured tranche");
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 800, "third-party tranches stay escrowed");
        assertGt(unboundedLarge - unboundedSmall, 300_000, "a full walk's cost scales with third-party appends");
        assertApproxEqAbs(pagedLarge, pagedSmall, 5000, "a page's cost does not");
    }

    function _gasOfUnboundedVest() internal returns (uint256 used) {
        uint256 g = gasleft();
        vault.vest(address(benefactorContract));
        used = g - gasleft();
    }

    function _gasOfPagedVest(uint256 maxTranches) internal returns (uint256 used) {
        uint256 g = gasleft();
        vault.vest(address(benefactorContract), maxTranches);
        used = g - gasleft();
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

    /// @dev An unset community sink no longer stops a harvest: the target leg is held in
    ///      `accumulatedTargetFees` and nothing is pushed. (Retargeted from the earlier
    ///      revert-on-unset-sink assertion — the vault now accrues instead of reverting.)
    function test_harvest_accruesTargetLegWhenCommunityPayoutNotSet() public {
        AlignmentEndowmentVault v2 = _deployVault(address(0));
        MockOwnable b2 = new MockOwnable(alice);
        vm.prank(alice);
        v2.receiveContribution{ value: ONE_ETH }(nativeCurrency, ONE_ETH, address(b2));
        _simulateYield(0.1 ether);

        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        v2.harvest(); // escrowed class → 0.08 creator / 0.019 target / 0.001 protocol

        assertEq(v2.accumulatedTargetFees(), 0.019 ether, "target leg accrued in the vault");
        assertEq(v2.totalYieldToTarget(), 0.019 ether, "target counter booked at accrual");
        assertEq(v2.pendingYieldOf(address(b2)), 0.08 ether, "creator leg unaffected");
        assertEq(treasury.balance - treasuryBefore, 0.001 ether, "protocol leg still pushed");
        assertEq(communityPayout.balance, communityBefore, "no sink was paid");
    }

    /// @dev Round trip of the accrued target leg: flush reverts while the sink is unset, pays the full
    ///      accrued balance exactly once after `setCommunityPayout`, and moves nothing on a second call.
    function test_flushTargetFees_paysOnceAfterSinkIsSet() public {
        AlignmentEndowmentVault v2 = _deployVault(address(0));
        MockOwnable b2 = new MockOwnable(alice);
        vm.prank(alice);
        v2.receiveContribution{ value: ONE_ETH }(nativeCurrency, ONE_ETH, address(b2));
        _simulateYield(0.1 ether);
        v2.harvest();
        assertEq(v2.accumulatedTargetFees(), 0.019 ether);

        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        v2.flushTargetFees();

        vm.prank(vaultOwner);
        v2.setCommunityPayout(communityPayout);

        uint256 communityBefore = communityPayout.balance;
        assertEq(v2.flushTargetFees(), 0.019 ether, "full accrued balance delivered");
        assertEq(communityPayout.balance - communityBefore, 0.019 ether, "sink received the accrued leg");
        assertEq(v2.accumulatedTargetFees(), 0, "accumulator zeroed");

        assertEq(v2.flushTargetFees(), 0, "second flush moves nothing");
        assertEq(communityPayout.balance - communityBefore, 0.019 ether, "sink unchanged by the second flush");
    }

    /// @dev Once the sink is set, the target leg is pushed directly again — accrual is the unset-sink
    ///      branch only, never the happy path.
    function test_harvest_pushesDirectlyOnceSinkIsSet() public {
        AlignmentEndowmentVault v2 = _deployVault(address(0));
        vm.prank(vaultOwner);
        v2.setCommunityPayout(communityPayout);

        MockOwnable b2 = new MockOwnable(alice);
        vm.prank(alice);
        v2.receiveContribution{ value: ONE_ETH }(nativeCurrency, ONE_ETH, address(b2));
        _simulateYield(0.1 ether);

        uint256 communityBefore = communityPayout.balance;
        v2.harvest();

        assertEq(communityPayout.balance - communityBefore, 0.019 ether, "target leg pushed on harvest");
        assertEq(v2.accumulatedTargetFees(), 0, "nothing accrued when the sink is set");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2b. The target sink is resolved from the registry at send time
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev A registry re-point reaches a vault that was already deployed. The stored `communityPayout`
    ///      is a fallback, not a pin: were it read first, every clone deployed before the re-point would
    ///      keep force-sending to the superseded address with nothing to claw back.
    function test_targetSink_registryRepointReachesADeployedVault() public {
        address canonical = makeAddr("canonicalSink");
        ambassadorRegistry.setCommunityPayout(TARGET_ID, canonical);

        _contributeBenefactor(ONE_ETH);
        _simulateYield(0.1 ether);

        uint256 staleBefore = communityPayout.balance;
        uint256 canonicalBefore = canonical.balance;
        vault.harvest();

        assertEq(canonical.balance - canonicalBefore, 0.019 ether, "the registry's sink was paid");
        assertEq(communityPayout.balance, staleBefore, "the pinned deploy-time address was not");
        assertEq(vault.communityPayout(), communityPayout, "the fallback slot is untouched");
    }

    /// @dev The flush leg resolves the same way — a fix that touched only `_crystallizeYield` would
    ///      leave the accrued balance going to the stale address.
    function test_flushTargetFees_resolvesFromRegistry() public {
        // Strand a leg with no sink on either side, then wire the registry alone and flush.
        AlignmentEndowmentVault v2 = _deployVault(address(0));
        MockOwnable b2 = new MockOwnable(alice);
        vm.prank(alice);
        v2.receiveContribution{ value: ONE_ETH }(nativeCurrency, ONE_ETH, address(b2));
        _simulateYield(0.1 ether);
        v2.harvest();
        assertEq(v2.accumulatedTargetFees(), 0.019 ether, "accrued with no sink");

        address canonical = makeAddr("canonicalFlushSink");
        ambassadorRegistry.setCommunityPayout(TARGET_ID, canonical);

        uint256 before = canonical.balance;
        assertEq(v2.flushTargetFees(), 0.019 ether);
        assertEq(canonical.balance - before, 0.019 ether, "flush paid the registry's sink");
        assertEq(v2.communityPayout(), address(0), "with no stored fallback of its own");
    }

    /// @dev With the registry returning zero and no stored payout, `_crystallizeYield` still ACCRUES the
    ///      target leg (never reverts, never drops it) and `flushTargetFees()` still reverts.
    function test_targetSink_zeroOnBothSidesAccruesAndFlushReverts() public {
        AlignmentEndowmentVault v2 = _deployVault(address(0));
        assertEq(ambassadorRegistry.getCommunityPayout(TARGET_ID), address(0), "registry unset too");

        MockOwnable b2 = new MockOwnable(alice);
        vm.prank(alice);
        v2.receiveContribution{ value: ONE_ETH }(nativeCurrency, ONE_ETH, address(b2));
        _simulateYield(0.1 ether);

        v2.harvest();
        assertEq(v2.accumulatedTargetFees(), 0.019 ether, "accrued, not reverted, not dropped");
        assertEq(v2.pendingYieldOf(address(b2)), 0.08 ether, "creator leg unaffected");

        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        v2.flushTargetFees();
    }

    /// @dev The stored slot is the fallback, and it is used whenever the registry has no answer.
    function test_targetSink_fallsBackToStoredWhenRegistryIsUnset() public {
        assertEq(ambassadorRegistry.getCommunityPayout(TARGET_ID), address(0));

        _contributeBenefactor(ONE_ETH);
        _simulateYield(0.1 ether);

        uint256 before = communityPayout.balance;
        vault.harvest();

        assertEq(communityPayout.balance - before, 0.019 ether, "stored fallback paid");
        assertEq(vault.accumulatedTargetFees(), 0, "nothing accrued");
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
        // RE-B2: the escrow BASIS is zeroed and the vault is decommissioned (migrated) — the escrow tranche
        // has left the position, so keeping a live basis would brick harvest/vest/execute. Per-benefactor
        // escrow entries are frozen-inert (a mapping cannot be iterated); the on-chain ledger + `Migrated`
        // event remain the record for reconstructing each benefactor's stake at the new venue.
        assertEq(vault.totalEscrowedPrincipal(), 0, "escrow basis zeroed on migrate");
        assertTrue(vault.migrated(), "vault decommissioned");
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 10 ether, "per-benefactor entry frozen-inert");
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

    // ═══════════════════════════════════════════════════════════════════════
    // 12. execute — target-sovereign deployment of vested corpus (spec 2c)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Contribute `amount` from benefactorContract and vest it into the deployable corpus.
    function _vest(uint256 amount) internal {
        _contributeBenefactor(amount);
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract));
    }

    function test_execute_ambassadorDeploysUpToCorpus() public {
        _vest(2 ether);
        assertEq(vault.deployableCorpus(), 2 ether, "corpus == vested principal");

        address sink = makeAddr("sink");
        vm.prank(ambassador);
        vault.execute(sink, 2 ether, "");

        assertEq(sink.balance, 2 ether, "full corpus deployed");
        assertEq(vault.deployableCorpus(), 0, "corpus emptied");
        assertEq(vault.totalVestedDeployable(), 0);
        assertEq(vault.totalDeployedByTarget(), 2 ether, "deploy counter updated");
    }

    function test_execute_revertsNonAmbassador() public {
        _vest(1 ether);
        vm.prank(stranger);
        vm.expectRevert(AlignmentEndowmentVault.NotAuthorized.selector);
        vault.execute(makeAddr("sink"), 1 ether, "");
    }

    function test_execute_revertsOverCorpus() public {
        _vest(1 ether);
        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ExceedsDeployableCorpus.selector);
        vault.execute(makeAddr("sink"), 1 ether + 1, "");
    }

    /// @dev The escrowed (unvested) tranche is UNTOUCHABLE by execute even for an ambassador: the corpus
    ///      bound is the vested principal only, and a full-corpus deploy leaves escrowed accounting and the
    ///      remaining position value intact.
    function test_execute_cannotReachEscrowedPrincipal() public {
        _contributeBenefactor(1 ether); // A → will vest
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 1 ether); // B → stays escrowed
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract)); // A vested; B escrowed
        assertEq(vault.deployableCorpus(), 1 ether, "corpus is the vested tranche only");
        assertEq(vault.totalEscrowedPrincipal(), 1 ether);

        // Cannot reach beyond the vested 1 ETH even though 2 ETH sits in the shared position.
        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ExceedsDeployableCorpus.selector);
        vault.execute(makeAddr("sink"), 1 ether + 1, "");

        // Deploying the full vested corpus leaves B's escrowed principal + the position untouched.
        address sink = makeAddr("sink");
        vm.prank(ambassador);
        vault.execute(sink, 1 ether, "");

        assertEq(sink.balance, 1 ether);
        assertEq(vault.totalVestedDeployable(), 0);
        assertEq(vault.escrowedPrincipal(address(b)), 1 ether, "escrowed principal untouched");
        assertEq(vault.totalEscrowedPrincipal(), 1 ether, "escrowed total untouched");
        assertApproxEqAbs(vault.currentPositionValue(), 1 ether, 2, "only the vested tranche left");
    }

    function test_execute_withdrawToEOA() public {
        _vest(1 ether);
        address eoa = makeAddr("eoa_sink");
        assertEq(eoa.code.length, 0);

        vm.prank(ambassador);
        bytes memory ret = vault.execute(eoa, 1 ether, "");

        assertEq(ret.length, 0, "plain transfer returns no data");
        assertEq(eoa.balance, 1 ether, "withdraw-to-EOA works");
        assertEq(vault.totalDeployedByTarget(), 1 ether);
    }

    /// @dev An aligned-token buy routed through a mock DEX: ETH deploys, tokens credit the recipient, the
    ///      deploy counter + corpus update, and CapitalDeployed carries the call selector.
    function test_execute_alignedTokenBuyThroughDex() public {
        _vest(3 ether);
        MockDeployDEX dex = new MockDeployDEX();
        address recipient = makeAddr("token_recipient");
        bytes memory data = abi.encodeWithSelector(MockDeployDEX.buy.selector, recipient);

        vm.expectEmit(true, true, false, true);
        emit CapitalDeployed(ambassador, address(dex), 2 ether, MockDeployDEX.buy.selector, block.timestamp);
        vm.prank(ambassador);
        vault.execute(address(dex), 2 ether, data);

        assertEq(dex.totalEthIn(), 2 ether, "DEX received the deployed ETH");
        assertEq(dex.tokenBalanceOf(recipient), 2 ether, "aligned tokens credited to recipient");
        assertEq(vault.totalDeployedByTarget(), 2 ether, "deploy counter updated");
        assertEq(vault.totalVestedDeployable(), 1 ether, "corpus decremented by the deploy");
    }

    /// @dev The sole backstop: owner `removeAmbassador` on the alignment registry revokes execute rights.
    function test_execute_removeAmbassadorRevokes() public {
        _vest(1 ether);
        ambassadorRegistry.removeAmbassador(TARGET_ID, ambassador);
        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.NotAuthorized.selector);
        vault.execute(makeAddr("sink"), 1 ether, "");
    }

    /// @dev Auth resolves LIVE through `masterRegistry.alignmentRegistry()`: a re-point of the alignment
    ///      registry is honored immediately (no cache), and a grant on the live registry enables execute.
    function test_execute_authResolvesLiveThroughMasterRegistry() public {
        _vest(1 ether);

        // Re-point to a fresh registry where `ambassador` is not (yet) authorized → auth fails live.
        MockAmbassadorRegistry fresh = new MockAmbassadorRegistry();
        masterRegistry.setAlignmentRegistry(address(fresh));
        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.NotAuthorized.selector);
        vault.execute(makeAddr("sink"), 1 ether, "");

        // Granting on the live registry is honored on the very next call.
        fresh.setAmbassador(TARGET_ID, ambassador, true);
        address sink = makeAddr("sink2");
        vm.prank(ambassador);
        vault.execute(sink, 1 ether, "");
        assertEq(sink.balance, 1 ether, "live re-point honored");
    }

    /// @dev A malicious deployment target that re-enters execute cannot double-spend: nonReentrant blocks
    ///      the re-entry, and CEI means the corpus was already decremented exactly once before the call.
    function test_execute_reentrancyCannotDoubleSpend() public {
        _vest(2 ether);
        ReentrantDeployer attacker = new ReentrantDeployer(vault);
        // The attacker must pass auth for the re-entry to actually exercise the nonReentrant guard.
        ambassadorRegistry.setAmbassador(TARGET_ID, address(attacker), true);

        vm.prank(ambassador);
        vault.execute(address(attacker), 1 ether, "");

        assertTrue(attacker.reentryAttempted(), "attacker attempted re-entry");
        assertFalse(attacker.reentrySucceeded(), "re-entry blocked by nonReentrant");
        assertEq(address(attacker).balance, 1 ether, "attacker received exactly one deployment");
        assertEq(vault.totalDeployedByTarget(), 1 ether, "single spend recorded");
        assertEq(vault.totalVestedDeployable(), 1 ether, "corpus decremented once (2 - 1)");
    }

    /// @dev A callee that reverts bubbles its revert and rolls back the whole deploy (no partial spend).
    function test_execute_bubblesCalleeRevertAndRollsBack() public {
        _vest(1 ether);
        RejectETH r = new RejectETH();
        vm.prank(ambassador);
        vm.expectRevert();
        vault.execute(address(r), 1 ether, "");

        // Effects rolled back with the revert.
        assertEq(vault.totalVestedDeployable(), 1 ether, "corpus intact after failed deploy");
        assertEq(vault.totalDeployedByTarget(), 0, "counter intact after failed deploy");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 13. RE-B1 — execute cannot reach ESCROWED principal via calldata
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Set up a mixed position: A vested (1 ETH deployable corpus), B escrowed (1 ETH permanent), so
    ///      the shared stataToken position holds 2 ETH and the escrowed tranche is the drain target.
    function _mixedPosition() internal returns (MockOwnable b) {
        _contributeBenefactor(1 ether); // A → will vest
        b = _contributeNewBenefactor(address(0xCAFE), 1 ether); // B → stays escrowed (permanent)
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract)); // A vested; B escrowed
    }

    /// @dev THE RE-B1 drain: an authorized ambassador passes `value = 0` (trivially ≤ corpus) and routes an
    ///      ERC-20 `transfer` of the vault's ENTIRE stataToken share balance through `data`. Pre-fix this
    ///      moved all shares (escrowed + vested) to an attacker in one tx. It must now revert and leave the
    ///      position — and B's escrowed principal — completely intact.
    function test_execute_revertsDrainViaStataTokenCalldata() public {
        _mixedPosition();
        uint256 sharesBefore = stata.balanceOf(address(vault));
        assertGt(sharesBefore, 0, "vault holds the position shares");

        address attacker = makeAddr("attacker");
        bytes memory drain = abi.encodeWithSignature("transfer(address,uint256)", attacker, sharesBefore);

        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ForbiddenExecuteTarget.selector);
        vault.execute(address(stata), 0, drain);

        // No shares moved; escrowed (permanent) principal untouched.
        assertEq(stata.balanceOf(address(vault)), sharesBefore, "position shares unchanged after attempted drain");
        assertEq(stata.balanceOf(attacker), 0, "attacker received nothing");
        assertEq(vault.totalEscrowedPrincipal(), 1 ether, "escrowed principal intact");
    }

    /// @dev The WETH the vault holds an unbounded approval on is also a forbidden target (approve/transfer
    ///      route to principal), as is the vault itself (self-call). Both revert ForbiddenExecuteTarget.
    function test_execute_revertsForbiddenWethAndSelfTargets() public {
        _mixedPosition();

        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ForbiddenExecuteTarget.selector);
        vault.execute(
            address(weth), 0, abi.encodeWithSignature("approve(address,uint256)", stranger, type(uint256).max)
        );

        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ForbiddenExecuteTarget.selector);
        vault.execute(address(vault), 0, "");
    }

    /// @dev The denylist is additive: legit value-only deployment of the vested corpus to an arbitrary `to`
    ///      (an EOA here) still succeeds and the escrowed tranche is untouched.
    function test_execute_legitValueDeployStillWorksAfterDenylist() public {
        MockOwnable b = _mixedPosition();
        address eoa = makeAddr("legit_sink");

        vm.prank(ambassador);
        vault.execute(eoa, 1 ether, ""); // full vested corpus, value-only

        assertEq(eoa.balance, 1 ether, "legit value-only deploy to EOA still works");
        assertEq(vault.totalVestedDeployable(), 0, "corpus deployed");
        assertEq(vault.escrowedPrincipal(address(b)), 1 ether, "escrowed principal untouched");
        assertEq(vault.totalEscrowedPrincipal(), 1 ether, "escrowed total untouched");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 14. RE-B2 — migrate zeroes escrow basis + decommissions (no brick / no re-open)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev After an escrow migrate the basis is zeroed so harvest/execute stay self-consistent on the vested
    ///      tranche (no stale-basis brick), and intake + vesting are permanently closed.
    function test_migrate_zeroesBasisAndDecommissions() public {
        _contributeBenefactor(1 ether); // A → will vest
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 1 ether); // B → escrowed
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract)); // A vested (corpus 1 ETH); B escrowed (1 ETH)
        assertEq(vault.totalEscrowedPrincipal(), 1 ether);
        assertEq(vault.totalVestedDeployable(), 1 ether);

        vm.prank(vaultOwner);
        vault.migratePosition(makeAddr("recovery"));

        assertEq(vault.totalEscrowedPrincipal(), 0, "escrow basis zeroed");
        assertTrue(vault.migrated(), "vault decommissioned");
        assertEq(vault.totalVestedDeployable(), 1 ether, "vested corpus retained");

        // harvest does NOT brick: yield on the retained vested tranche still distributes (basis is sane).
        _simulateYield(1 ether);
        uint256 communityBefore = communityPayout.balance;
        vault.harvest();
        assertGt(communityPayout.balance - communityBefore, 0, "harvest still distributes (not bricked)");

        // execute still works on the retained vested corpus (no RedeemShortfall from a phantom basis).
        address sink = makeAddr("sink");
        vm.prank(ambassador);
        vault.execute(sink, 1 ether, "");
        assertEq(sink.balance, 1 ether, "vested corpus still deployable post-migrate");

        // Intake is closed: a post-migrate deposit cannot re-open the dead position.
        vm.deal(alice, alice.balance + 1 ether);
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.VaultMigrated.selector);
        vault.receiveContribution{ value: 1 ether }(nativeCurrency, 1 ether, address(b));

        // Vesting is closed: the stale escrow tranche cannot vest into a phantom deployable corpus.
        vm.expectRevert(AlignmentEndowmentVault.VaultMigrated.selector);
        vault.vest(address(b));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 15. RE-B3 — per-deposit vesting clocks (a late top-up is not vested early)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev A second deposit made when the FIRST tranche has already matured is NOT instantly vestable: only
    ///      the first tranche vests, the fresh amount keeps its own 26-week clock. Pre-fix (single depositTime,
    ///      never reset) the whole escrow vested at once, robbing the top-up of its creator-earning window.
    function test_vest_perDepositClock_lateTopUpNotVestedEarly() public {
        uint256 t0 = block.timestamp;
        _contributeBenefactor(1 ether); // tranche A @ t0

        vm.warp(t0 + VEST); // A matured
        _contributeBenefactor(1 ether); // tranche B @ t0 + VEST (fresh clock)
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 2 ether);

        // Only A vests; B stays escrowed with its own clock.
        vault.vest(address(benefactorContract));
        assertEq(vault.vestedPrincipal(address(benefactorContract)), 1 ether, "only the matured tranche vested");
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 1 ether, "fresh top-up still escrowed");
        assertEq(vault.totalVested(), 1 ether);

        // Poking vest again now reverts — B is not yet mature (would have been instantly vestable pre-fix).
        vm.expectRevert(AlignmentEndowmentVault.NotVested.selector);
        vault.vest(address(benefactorContract));

        // B vests only after its OWN 26 weeks elapse.
        vm.warp(t0 + 2 * VEST);
        vault.vest(address(benefactorContract));
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 0, "B vested on its own clock");
        assertEq(vault.vestedPrincipal(address(benefactorContract)), 2 ether);
    }

    /// @dev A brand-new deposit made AFTER a full vest starts a fresh window — it is not instantly vestable
    ///      just because an earlier tranche's clock (the never-reset `depositTime`) already elapsed.
    function test_vest_postFullVestDepositIsNotInstant() public {
        uint256 t0 = block.timestamp;
        _contributeBenefactor(1 ether); // A @ t0
        vm.warp(t0 + VEST);
        vault.vest(address(benefactorContract)); // A fully vested; escrow empty
        assertEq(vault.escrowedPrincipal(address(benefactorContract)), 0);

        // New deposit at t0 + VEST. depositTime is still t0, so the OLD code would treat this as already
        // past `depositTime + VEST` and vest it in the same block. The per-tranche clock forbids that.
        _contributeBenefactor(1 ether); // B @ t0 + VEST
        vm.expectRevert(AlignmentEndowmentVault.NotVested.selector);
        vault.vest(address(benefactorContract));

        // B matures only at t0 + 2*VEST.
        vm.warp(t0 + 2 * VEST);
        vault.vest(address(benefactorContract));
        assertEq(vault.vestedPrincipal(address(benefactorContract)), 2 ether, "B vested on its own fresh clock");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 16. noesis-118 — migrate harvest-first + impairment socialization; execute forwards `got`
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Fix 1 (yield-misdirection): `migratePosition` crystallizes the escrow class's pending Aave yield
    ///      (split 80/19/1 into the accumulator legs) BEFORE redeeming escrow principal to `to`. The recovery
    ///      address must receive PRINCIPAL only — the yield stays in the legs, not swept out. Pre-fix, the
    ///      pro-rata `escrowValue` was computed off the yield-inflated position value and force-sent to `to`.
    function test_migrate_harvestsEscrowYieldFirst_noSweepToRecovery() public {
        _contributeBenefactor(10 ether); // escrowed only
        _simulateYield(1 ether); // position 11, basis 10 → 1 ETH pending escrow-class yield

        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        address recovery = makeAddr("recovery");
        vm.deal(recovery, 0);

        vm.prank(vaultOwner);
        vault.migratePosition(recovery);

        // Escrow yield split 80/19/1 into the legs — NOT swept to the recovery address.
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether, "creator leg booked (not swept)");
        assertEq(vault.totalYieldToCreators(), 0.8 ether);
        assertEq(communityPayout.balance - communityBefore, 0.19 ether, "target leg 19% routed to community");
        assertEq(treasury.balance - treasuryBefore, 0.01 ether, "protocol leg 1% routed to treasury");
        assertEq(vault.totalYieldToTarget(), 0.19 ether);
        assertEq(vault.totalProtocolFees(), 0.01 ether);

        // recovery receives the escrow PRINCIPAL (10 ETH), NOT principal + yield (11 ETH).
        assertApproxEqAbs(recovery.balance, 10 ether, 2, "recovery gets escrow principal only, not the yield");
    }

    /// @dev Fix 2 (stale-vested-basis): on an IMPAIRED migrate the vested tranche now backs only its
    ///      `value·vested/basis` realizable WETH, so `deployableCorpus()` must be scaled down to match —
    ///      otherwise a later `execute(corpus)` reverts `RedeemShortfall` and strands the residual. After the
    ///      socialization a full-corpus `execute` settles cleanly with nothing stuck.
    function test_migrate_impaired_socializesOntoVestedTranche_executeNoShortfall() public {
        _contributeBenefactor(10 ether); // A → will vest
        _contributeNewBenefactor(address(0xCAFE), 10 ether); // B → stays escrowed
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract)); // A vested (corpus 10); B escrowed (10)
        assertEq(vault.totalVestedDeployable(), 10 ether);
        assertEq(vault.totalEscrowedPrincipal(), 10 ether);

        // 50% solvency impairment: position value 20 → 10.
        stata.simulateLoss(10 ether);
        vm.deal(address(weth), 100 ether); // ensure redemptions settle in ETH

        address recovery = makeAddr("recovery");
        vm.deal(recovery, 0);

        vm.prank(vaultOwner);
        vault.migratePosition(recovery);

        // Escrow pro-rata: value(10)·escrowed(10)/basis(20) = 5 ETH redeemed to recovery.
        assertApproxEqAbs(recovery.balance, 5 ether, 2, "escrow pro-rata redeemed to recovery");
        // Fix 2: vested tranche scaled to realizable value(10)·vested(10)/basis(20) = 5 ETH.
        assertEq(vault.totalVestedDeployable(), 5 ether, "vested scaled to realizable on impairment");
        assertEq(vault.deployableCorpus(), 5 ether, "corpus reflects realizable, not stale full vested");
        assertTrue(vault.migrated(), "vault decommissioned");

        // The full (scaled) corpus deploys WITHOUT RedeemShortfall, and nothing is stranded.
        address sink = makeAddr("sink");
        uint256 corpus = vault.deployableCorpus(); // cache: a call in the arg would consume the prank
        vm.prank(ambassador);
        vault.execute(sink, corpus, "");

        assertApproxEqAbs(sink.balance, 5 ether, 2, "full realizable corpus deployed, no shortfall");
        assertEq(vault.totalVestedDeployable(), 0, "corpus emptied - no residual stuck");
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2, "position fully drained, nothing stranded");
    }

    /// @dev Pre-fix guard: without the socialization the stale full corpus would revert the same execute with
    ///      `RedeemShortfall`. This asserts the post-fix corpus (5 ETH) is exactly the realizable value and a
    ///      request for the OLD full 10 ETH is now correctly rejected as exceeding the corpus.
    function test_migrate_impaired_oldFullCorpusNowExceedsScaledCorpus() public {
        _contributeBenefactor(10 ether);
        _contributeNewBenefactor(address(0xCAFE), 10 ether);
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract));

        stata.simulateLoss(10 ether); // 50% impairment
        vm.deal(address(weth), 100 ether);

        vm.prank(vaultOwner);
        vault.migratePosition(makeAddr("recovery"));

        // The pre-fix stale corpus (10 ETH) is no longer deployable — it now exceeds the socialized corpus.
        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ExceedsDeployableCorpus.selector);
        vault.execute(makeAddr("sink"), 10 ether, "");
    }

    /// @dev Fix 3 (execute redeem-dust): on a dusty redeem (`got = value − dust`, within `REDEEM_DUST`)
    ///      `execute` forwards `got`, NOT `value` — so the ~dust shortfall is never covered from the vault's
    ///      OTHER native ETH (a creator `yieldPurse`). The un-redeemed dust stays as deployable corpus.
    function test_execute_dustyRedeem_forwardsGot_noYieldPurseDip() public {
        _vest(1 ether); // vested-only corpus = 1 ETH
        assertEq(vault.deployableCorpus(), 1 ether);

        // The vault holds OTHER native ETH (a creator yieldPurse / stray ETH) that execute must not dip.
        uint256 otherEth = 5 ether;
        vm.deal(address(vault), otherEth);

        // Force a dusty redeem: maxWithdraw returns value − dust, so `_redeem(1 ETH)` yields got = 1 ETH − dust.
        uint256 dust = 1e6; // == REDEEM_DUST — tolerated (no RedeemShortfall)
        stata.setMaxWithdrawCap(1 ether - dust);

        address sink = makeAddr("dust_sink");
        vm.expectEmit(true, true, false, true);
        emit CapitalDeployed(ambassador, sink, 1 ether - dust, bytes4(0), block.timestamp);
        vm.prank(ambassador);
        vault.execute(sink, 1 ether, "");

        // `to` receives what was ACTUALLY redeemed (got), not the requested value.
        assertEq(sink.balance, 1 ether - dust, "sink receives got, not value");
        // The vault's other native ETH is UNTOUCHED — no dust dip from the yieldPurse.
        assertEq(address(vault).balance, otherEth, "yieldPurse / other native ETH untouched");
        // The un-redeemed dust stays as still-deployable vested corpus (debited by got, not value).
        assertEq(vault.totalVestedDeployable(), dust, "dust retained as corpus (debited by got)");
        assertEq(vault.deployableCorpus(), dust);
        assertEq(vault.totalDeployedByTarget(), 1 ether - dust, "deploy counter tracks got");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 17. noesis-343 — deployableCorpus() is clamped to what the position can redeem
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev Mixed position under a solvency haircut: A vested 10 ETH, B escrowed 10 ETH (basis 20), position
    ///      value taken to 16 ETH by a 20% haircut. The vested tranche's pro-rata claim on that value is
    ///      16·10/20 = 8 ETH, so `deployableCorpus()` must report 8 while the nominal `totalVestedDeployable`
    ///      stays 10.
    function _impairedMixedPosition() internal {
        _contributeBenefactor(10 ether); // A → will vest
        _contributeNewBenefactor(address(0xCAFE), 10 ether); // B → stays escrowed
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract));
        assertEq(vault.totalVestedDeployable(), 10 ether, "vested tranche before the haircut");
        assertEq(vault.totalEscrowedPrincipal(), 10 ether, "escrowed tranche before the haircut");

        stata.simulateLoss(4 ether); // 20% solvency haircut: 20 → 16
        vm.deal(address(weth), 100 ether); // ensure redemptions settle in ETH
        assertEq(vault.currentPositionValue(), 16 ether, "position value after the haircut");
    }

    /// @dev The clamp: the reported corpus is the vested tranche's pro-rata claim on the live position value,
    ///      not the nominal basis. The nominal tranche is untouched — this is an accounting bound on what is
    ///      redeemable, not a socialization of the loss onto the vested class.
    function test_deployableCorpus_impaired_clampsToRealizableProRata() public {
        _impairedMixedPosition();

        assertEq(vault.deployableCorpus(), 8 ether, "corpus clamped to value(16)*vested(10)/basis(20)");
        assertEq(vault.totalVestedDeployable(), 10 ether, "nominal vested tranche is not written down");
    }

    /// @dev THE HEADLINE. Deploying the nominal (un-clamped) corpus on an impaired position must be rejected
    ///      by the corpus bound. Before the clamp this call succeeded and paid out 100% of nominal from a
    ///      position that could not back it; it must now revert `ExceedsDeployableCorpus` — and specifically
    ///      NOT `RedeemShortfall`, which would leave the request half-processed against a stale bound.
    function test_execute_impaired_nominalCorpusRevertsExceedsDeployableCorpus() public {
        _impairedMixedPosition();

        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ExceedsDeployableCorpus.selector);
        vault.execute(makeAddr("sink"), 10 ether, "");

        // Nothing moved: the whole position is still in place behind the rejected request.
        assertEq(vault.currentPositionValue(), 16 ether, "position untouched by the rejected deploy");
        assertEq(vault.totalVestedDeployable(), 10 ether, "corpus basis untouched by the rejected deploy");
    }

    /// @dev The clamped figure is deployable in full and settles without a shortfall.
    function test_execute_impaired_clampedCorpusDeploysCleanly() public {
        _impairedMixedPosition();

        address sink = makeAddr("sink");
        uint256 corpus = vault.deployableCorpus(); // cache: a call in the arg would consume the prank
        vm.prank(ambassador);
        vault.execute(sink, corpus, "");

        assertEq(sink.balance, 8 ether, "the full clamped corpus reached the sink");
        assertEq(vault.totalVestedDeployable(), 2 ether, "nominal tranche debited by what actually left");
        assertEq(vault.totalDeployedByTarget(), 8 ether, "deploy counter tracks what left");
        assertEq(vault.currentPositionValue(), 8 ether, "the escrowed tranche's value remains in the position");
    }

    /// @dev Idempotency — the property the view shape exists for. At an unchanged position value the answer
    ///      never moves, however many times it is read and however many permissionless `harvest()` calls are
    ///      interleaved. A write-down applied on a permissionless path would instead converge downward on
    ///      each call; a view has no state to re-apply.
    function test_deployableCorpus_impaired_isIdempotentAcrossReadsAndHarvests() public {
        _impairedMixedPosition();

        uint256 first = vault.deployableCorpus();
        assertEq(first, 8 ether, "clamped corpus");

        for (uint256 i = 0; i < 5; i++) {
            vault.harvest(); // permissionless, and a no-op while the position is below basis
            assertEq(vault.deployableCorpus(), first, "corpus unchanged by a harvest at an unchanged value");
            assertEq(vault.deployableCorpus(), first, "corpus unchanged by a repeated read");
        }

        assertEq(vault.totalVestedDeployable(), 10 ether, "nominal tranche never written down by a read");
    }

    /// @dev Healthy position: the clamp is a strict no-op. Unharvested yield above the basis does NOT raise
    ///      the corpus either — the `min(...)` floor keeps the yield legs out of `execute`'s reach.
    function test_deployableCorpus_healthy_clampIsNoOp() public {
        _contributeBenefactor(10 ether);
        _contributeNewBenefactor(address(0xCAFE), 10 ether);
        vm.warp(block.timestamp + VEST);
        vault.vest(address(benefactorContract));

        assertEq(vault.deployableCorpus(), vault.totalVestedDeployable(), "no-op at value == basis");
        assertEq(vault.deployableCorpus(), 10 ether);

        _simulateYield(2 ether); // position 22 vs basis 20 — all of it is yield, none of it is corpus
        assertEq(vault.deployableCorpus(), 10 ether, "unharvested yield does not raise the corpus");
        assertEq(vault.deployableCorpus(), vault.totalVestedDeployable(), "still exactly the nominal tranche");
    }

    /// @dev An empty vault has a zero basis: the clamp's divisor guard returns 0 rather than reverting.
    function test_deployableCorpus_zeroBasis_returnsZeroAndDoesNotRevert() public {
        AlignmentEndowmentVault fresh = _deployVault(communityPayout);

        assertEq(fresh.totalEscrowedPrincipal(), 0, "no escrowed principal");
        assertEq(fresh.totalVestedDeployable(), 0, "no vested principal");
        assertEq(fresh.deployableCorpus(), 0, "zero basis reports zero corpus");
    }
}
