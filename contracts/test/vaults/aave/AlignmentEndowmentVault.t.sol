// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { AlignmentEndowmentVault } from "../../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { IAlignmentRegistry } from "../../../src/master/interfaces/IAlignmentRegistry.sol";
import { AlignmentRegistryV1 } from "../../../src/master/AlignmentRegistryV1.sol";

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
///      target sink from. The vault reads `isAmbassador`, `isAlignmentTargetActive` and `getCommunityPayout`.
contract MockAmbassadorRegistry {
    mapping(uint256 => mapping(address => bool)) private _amb;
    mapping(uint256 => address) private _communityPayout;
    /// @dev Stored inverted so an unconfigured target reads as CURATED, matching a registry whose targets
    ///      are active from registration; only `deactivateAlignmentTarget` below flips one off.
    mapping(uint256 => bool) private _decurated;

    function setAmbassador(uint256 targetId, address account, bool flag) external {
        _amb[targetId][account] = flag;
    }

    /// @dev Mirrors AlignmentRegistryV1.setCommunityPayout, minus the owner gate and the write-once pin —
    ///      the ONE sink the vault resolves, since the vault keeps no copy of its own.
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

    /// @dev Mirrors AlignmentRegistryV1.deactivateAlignmentTarget: one-way, and it does NOT clear the
    ///      ambassador set — that is exactly the state the freeze has to be proved against.
    function deactivateAlignmentTarget(uint256 targetId) external {
        _decurated[targetId] = true;
    }

    function isAlignmentTargetActive(uint256 targetId) external view returns (bool) {
        return !_decurated[targetId];
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

    // ── Events ───────────────────────────────────────────────────────────────
    event ContributionReceived(address indexed benefactor, uint256 amount);
    event PrincipalDeposited(address indexed benefactor, uint256 amount, uint256 indexed targetId, uint256 timestamp);
    event FundingRoundOpened(uint256 indexed round, uint256 timestamp);
    event YieldDistributed(uint256 creatorLeg, uint256 targetLeg, uint256 protocolLeg, uint256 timestamp);
    event YieldClaimed(address indexed benefactor, address indexed recipient, uint256 amount);
    event ImpairmentRealized(uint256 shortfallBps, uint256 timestamp);
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

        // The sink is registry state, not vault state: wire it once here and every clone below reads it.
        ambassadorRegistry.setCommunityPayout(TARGET_ID, communityPayout);
        vault = _deployVault();

        vm.deal(alice, 100 ether);
        vm.deal(address(this), 100 ether);

        masterRegistry.setAgent(agent, true);

        // Deterministic base timestamp.
        vm.warp(1_000_000);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _deployVault() internal returns (AlignmentEndowmentVault v) {
        address impl = address(new AlignmentEndowmentVault());
        v = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        v.initialize(
            vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, TARGET_ID
        );
    }

    /// @dev Put the target back to having NO community sink anywhere. There is only one place a sink can
    ///      live now, so this is the whole of "unset" — a vault cannot carry a second answer of its own.
    function _clearRegistrySink() internal {
        ambassadorRegistry.setCommunityPayout(TARGET_ID, address(0));
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
        assertEq(vault.targetId(), TARGET_ID);
        assertEq(vault.owner(), vaultOwner);
        assertEq(vault.fundingRound(), 0);
    }

    function test_initialize_revertsIfCalledAgain() public {
        vm.expectRevert();
        vault.initialize(
            vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, TARGET_ID
        );
    }

    function test_implLocked() public {
        address impl = address(new AlignmentEndowmentVault());
        vm.expectRevert();
        AlignmentEndowmentVault(payable(impl))
            .initialize(
                vaultOwner, address(weth), address(stata), treasury, address(masterRegistry), alignmentToken, TARGET_ID
            );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. receiveContribution — happy + revert
    // ═══════════════════════════════════════════════════════════════════════

    function test_contribution_creditsPrincipal() public {
        _contributeBenefactor(ONE_ETH);
        assertEq(vault.principalOf(address(benefactorContract)), ONE_ETH);
        assertEq(vault.totalPrincipal(), ONE_ETH);
        assertEq(vault.totalPrincipalCommittedAllTime(), ONE_ETH);
        assertEq(vault.totalPrincipalLocked(), ONE_ETH);
    }

    /// @dev A top-up is just more principal in the same bucket. It starts no clock of its own, because
    ///      there is no clock: the second ETH is worth exactly what the first is from the block it lands.
    function test_contribution_topUpAddsToTheSameBucket() public {
        _contributeBenefactor(ONE_ETH);
        vm.warp(2_000_000);
        _contributeBenefactor(ONE_ETH);
        assertEq(vault.principalOf(address(benefactorContract)), 2 * ONE_ETH);
        assertEq(vault.totalPrincipal(), 2 * ONE_ETH);
        assertEq(vault.totalPrincipalCommittedAllTime(), 2 * ONE_ETH);
        assertEq(vault.deployableCorpus(), 2 * ONE_ETH, "all of it is deployable, immediately");
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
        assertEq(vault.principalOf(address(benefactorContract)), ONE_ETH);
    }

    /// @dev The old MATURITY_DURATION refund constant is gone.
    function test_permanence_noMaturityDuration() public {
        (bool ok,) = address(vault).staticcall(abi.encodeWithSignature("MATURITY_DURATION()"));
        assertFalse(ok, "MATURITY_DURATION must not exist");
    }

    /// @dev And so is the whole vesting surface. Principal is one bucket with no second class to move to,
    ///      so nothing may answer for a clock, an escrow tranche, or a vested balance — a reintroduced
    ///      state transition would have to appear here first.
    function test_permanence_noVestingSurface() public {
        _contributeBenefactor(ONE_ETH);
        string[6] memory gone = [
            "VEST_DURATION()",
            "vest(address)",
            "vest(address,uint256)",
            "vestedOf(address)",
            "totalVested()",
            "depositTime(address)"
        ];
        for (uint256 i; i < gone.length; ++i) {
            bytes memory data = bytes(gone[i]);
            bytes4 sel = bytes4(keccak256(data));
            (bool ok,) =
                address(vault).call(abi.encodePacked(sel, uint256(uint160(address(benefactorContract))), uint256(1)));
            assertFalse(ok, gone[i]);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 4. One bucket: a withdrawal is pooled, so it lands pro-rata
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev The law that replaced the clock. A slice stops earning when it is PHYSICALLY WITHDRAWN and at
    ///      no other moment: the withdrawal is taken from the pool, so every benefactor's live principal
    ///      falls in the same proportion, and their weight in the next harvest falls with it.
    function test_withdrawal_landsProRataOnEveryBenefactor() public {
        _contributeBenefactor(1 ether); // A, weight 1
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 3 ether); // B, weight 3
        assertEq(vault.totalPrincipal(), 4 ether);

        vm.prank(ambassador);
        vault.execute(makeAddr("sink"), 2 ether, ""); // half the pool leaves

        assertEq(vault.totalPrincipal(), 2 ether, "pool halved");
        assertEq(vault.principalOf(address(benefactorContract)), 0.5 ether, "A halved, not zeroed");
        assertEq(vault.principalOf(address(b)), 1.5 ether, "B halved, not spared");

        // The creator leg still divides 1:3 — the withdrawal changed the size of the pie, not the slices.
        _simulateYield(1 ether);
        vault.harvest();
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.2 ether, "A keeps its 1/4");
        assertEq(vault.pendingYieldOf(address(b)), 0.6 ether, "B keeps its 3/4");
    }

    /// @dev And a benefactor who arrives AFTER a withdrawal is priced against the pool as it actually is,
    ///      not as it was. Pre-fix arithmetic (minting weight 1:1 with the deposit) would hand the newcomer
    ///      1/2 of the creator leg here while they fund 2/3 of the position.
    function test_depositAfterWithdrawal_isPricedAgainstTheLivePool() public {
        _contributeBenefactor(4 ether); // A funds the pool
        vm.prank(ambassador);
        vault.execute(makeAddr("sink"), 3 ether, ""); // 3 of A's 4 ETH is spent
        assertEq(vault.principalOf(address(benefactorContract)), 1 ether, "A has 1 ETH left in the pool");

        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 2 ether); // B funds 2 of the 3 ETH now here
        assertEq(vault.totalPrincipal(), 3 ether);
        assertEq(vault.principalOf(address(b)), 2 ether, "B's principal is what B put in");
        assertEq(vault.principalOf(address(benefactorContract)), 1 ether, "A's is what A has left");

        _simulateYield(3 ether);
        vault.harvest(); // creator leg = 2.4 ETH, split 1:2
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether, "A earns on its 1 ETH");
        assertEq(vault.pendingYieldOf(address(b)), 1.6 ether, "B earns on its 2 ETH");
    }

    /// @dev A corpus spent to the last wei and then re-funded. The spent shares must not price (or dilute)
    ///      the new money — a new benefactor into an empty pool funds all of it and earns all of the
    ///      creator leg — and the yield the spent shares already earned must survive the reset in full.
    function test_refundingAnEmptiedCorpus_opensAFreshRoundWithoutLosingEarnedYield() public {
        _contributeBenefactor(2 ether);
        _simulateYield(1 ether);
        vault.harvest(); // A earns the whole 0.8 creator leg
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether);

        vm.prank(ambassador);
        vault.execute(makeAddr("sink"), 2 ether, ""); // the corpus is spent to the wei
        assertEq(vault.totalPrincipal(), 0, "pool empty");
        assertEq(vault.principalOf(address(benefactorContract)), 0, "A's ETH is gone, so A's principal is");

        vm.expectEmit(true, false, false, true);
        emit FundingRoundOpened(1, block.timestamp);
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 5 ether);
        assertEq(vault.fundingRound(), 1);
        assertEq(vault.principalOf(address(b)), 5 ether, "B funds the whole pool");
        assertEq(vault.principalOf(address(benefactorContract)), 0, "A's spent shares buy no part of it");

        // A's already-earned 0.8 ETH is untouched by the reset and still claimable.
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether, "earned yield survives the round");

        _simulateYield(1 ether);
        vault.harvest();
        assertEq(vault.pendingYieldOf(address(b)), 0.8 ether, "B takes the whole creator leg of the new round");
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether, "and A accrues nothing more on nothing");

        vm.prank(alice);
        assertEq(vault.claimYieldPurse(address(benefactorContract)), 0.8 ether, "A can still pull it");
    }

    /// @dev A rogue ambassador draining the pool to a sliver and letting it be re-funded, over and over.
    ///      Each cycle prices the next deposit against a near-empty pool, which mints it a proportionally
    ///      enormous share count — correct arithmetic that, compounded, would overflow `amount · shares`
    ///      and brick intake permanently. The price floor ends the round instead, so intake survives any
    ///      number of cycles and each newcomer still owns the pool they funded.
    function test_drainToASliver_repeatedly_doesNotBrickIntake() public {
        for (uint256 i; i < 8; ++i) {
            MockOwnable b = _contributeNewBenefactor(address(uint160(0xD000 + i)), 1 ether);
            assertEq(vault.principalOf(address(b)), 1 ether, "the depositor owns the pool they funded");

            uint256 corpus = vault.deployableCorpus();
            vm.prank(ambassador);
            vault.execute(makeAddr("sink"), corpus - 1, ""); // leave a single wei behind

            assertEq(vault.totalPrincipal(), 0, "a pool worth a sliver of its shares ends the round");
        }
    }

    /// @dev The yield split does not wait for an ambassador. Assignment is eligibility to withdraw, not
    ///      withdrawal, so a target with no seated ambassador still pays 80/19/1 from the first harvest.
    function test_yieldSplitDoesNotWaitForAnAmbassador() public {
        ambassadorRegistry.setAmbassador(TARGET_ID, ambassador, false);
        _contributeBenefactor(1 ether);

        uint256 communityBefore = communityPayout.balance;
        _simulateYield(1 ether);
        vault.harvest();

        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether, "creator leg paid");
        assertEq(communityPayout.balance - communityBefore, 0.19 ether, "community leg paid");

        // The corpus is simply not withdrawable yet — that, and only that, is what the seat gates.
        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.NotAuthorized.selector);
        vault.execute(makeAddr("sink"), 1 ether, "");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 5. harvest — one flat split (wei-exact)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev 80 creator / 19 target / 1 protocol, on whatever principal is in the position. Two
    ///      benefactors, unequal weight; each pendingYieldOf is exact to the wei.
    function test_harvest_flatSplitAndAccumulatorExact() public {
        _contributeBenefactor(1 ether); // A = benefactorContract (weight 1)
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 3 ether); // B (weight 3)
        assertEq(vault.totalPrincipal(), 4 ether);

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

    /// @dev The split does not drift with time, with the number of harvests, or with anything else. Ten
    ///      harvests a year apart pay the same weights as the first.
    function test_harvest_splitIsTheSameForever() public {
        _contributeBenefactor(1 ether);

        for (uint256 i; i < 10; ++i) {
            vm.warp(block.timestamp + 52 weeks);
            uint256 communityBefore = communityPayout.balance;
            uint256 treasuryBefore = treasury.balance;
            uint256 creatorBefore = vault.pendingYieldOf(address(benefactorContract));

            _simulateYield(1 ether);
            vault.harvest();

            assertEq(communityPayout.balance - communityBefore, 0.19 ether, "target leg still 19%");
            assertEq(treasury.balance - treasuryBefore, 0.01 ether, "protocol leg still 1%");
            assertEq(vault.pendingYieldOf(address(benefactorContract)) - creatorBefore, 0.8 ether, "creator still 80%");
        }
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
        _clearRegistrySink();
        AlignmentEndowmentVault v2 = _deployVault();
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
    ///      accrued balance exactly once after the registry pins a sink, and moves nothing on a second call.
    function test_flushTargetFees_paysOnceAfterSinkIsSet() public {
        _clearRegistrySink();
        AlignmentEndowmentVault v2 = _deployVault();
        MockOwnable b2 = new MockOwnable(alice);
        vm.prank(alice);
        v2.receiveContribution{ value: ONE_ETH }(nativeCurrency, ONE_ETH, address(b2));
        _simulateYield(0.1 ether);
        v2.harvest();
        assertEq(v2.accumulatedTargetFees(), 0.019 ether);

        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        v2.flushTargetFees();

        ambassadorRegistry.setCommunityPayout(TARGET_ID, communityPayout);

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
        _clearRegistrySink();
        AlignmentEndowmentVault v2 = _deployVault();
        ambassadorRegistry.setCommunityPayout(TARGET_ID, communityPayout);

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

    /// @dev A registry re-point reaches a vault that was already deployed. The vault holds no copy of the
    ///      sink to go stale: were one read first, every clone deployed before the re-point would keep
    ///      force-sending to the superseded address with nothing to claw back.
    function test_targetSink_registryRepointReachesADeployedVault() public {
        address deployTimeSink = communityPayout;
        address canonical = makeAddr("canonicalSink");
        ambassadorRegistry.setCommunityPayout(TARGET_ID, canonical);

        _contributeBenefactor(ONE_ETH);
        _simulateYield(0.1 ether);

        uint256 staleBefore = deployTimeSink.balance;
        uint256 canonicalBefore = canonical.balance;
        vault.harvest();

        assertEq(canonical.balance - canonicalBefore, 0.019 ether, "the registry's sink was paid");
        assertEq(deployTimeSink.balance, staleBefore, "the address wired when the clone was deployed was not");
    }

    /// @dev The flush leg resolves the same way — a fix that touched only `_crystallizeYield` would
    ///      leave the accrued balance going to the stale address.
    function test_flushTargetFees_resolvesFromRegistry() public {
        // Strand a leg with no sink on either side, then wire the registry alone and flush.
        _clearRegistrySink();
        AlignmentEndowmentVault v2 = _deployVault();
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
    }

    /// @dev With the registry returning zero, `_crystallizeYield` still ACCRUES the target leg (never
    ///      reverts, never drops it) and `flushTargetFees()` still reverts. Zero is an honest answer —
    ///      no community sink exists yet — and the money waits rather than going somewhere else.
    function test_targetSink_zeroRegistryAccruesAndFlushReverts() public {
        _clearRegistrySink();
        AlignmentEndowmentVault v2 = _deployVault();
        assertEq(ambassadorRegistry.getCommunityPayout(TARGET_ID), address(0), "registry unset");

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

    /// @dev There is no second answer to fall back TO. The vault used to keep an owner-writable copy of
    ///      the sink, consulted whenever the registry read zero — and since pinning the registry's payout
    ///      is itself owner-gated, an owner who never pinned one kept that copy live and re-pointable
    ///      forever, over a community with nothing to rotate. Clearing the registry must therefore leave
    ///      the vault with NO sink, not with the owner's.
    function test_targetSink_unsetRegistryLeavesNoSinkAtAll() public {
        _clearRegistrySink();

        _contributeBenefactor(ONE_ETH);
        _simulateYield(0.1 ether);

        uint256 before = communityPayout.balance;
        vault.harvest();

        assertEq(communityPayout.balance, before, "the deploy-time address is not a fallback");
        assertEq(vault.accumulatedTargetFees(), 0.019 ether, "the leg waits in the vault instead");

        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        vault.flushTargetFees();
    }

    /// @dev harvest still succeeds when the target sink rejects ETH (force-send).
    function test_harvest_forcesSendToRejectingCommunity() public {
        RejectETH rejecter = new RejectETH();
        ambassadorRegistry.setCommunityPayout(TARGET_ID, address(rejecter));

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
    // 7. Impairment socialization on migrate
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev One bucket, so a haircut is socialized by construction: the basis is written down to what the
    ///      position can realize and the whole of it is relocated. There is no class to be paid first.
    function test_migrate_impaired_socializesProRata() public {
        _contributeBenefactor(10 ether);
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 10 ether);
        assertEq(vault.totalPrincipal(), 20 ether);

        // 50% impairment.
        stata.simulateLoss(10 ether);
        vm.deal(address(weth), 100 ether);

        address recovery = makeAddr("recovery");
        vm.deal(recovery, 0);

        vm.prank(vaultOwner);
        vm.expectEmit(false, false, false, true);
        emit ImpairmentRealized(5000, block.timestamp);
        vault.migratePosition(recovery);

        assertApproxEqAbs(recovery.balance, 10 ether, 1e9, "the whole impaired position moved to recovery");
        // The basis is zeroed and the vault is decommissioned — the principal has left the position, so
        // keeping a live basis would brick harvest. Per-benefactor share entries are frozen-inert (a mapping
        // cannot be iterated); the on-chain ledger + `Migrated` event remain the record for reconstructing
        // each benefactor's stake at the new venue, and the shares still divide it 1:1 here.
        assertEq(vault.totalPrincipal(), 0, "basis zeroed on migrate");
        assertTrue(vault.migrated(), "vault decommissioned");
        assertEq(
            vault.principalShares(address(benefactorContract)),
            vault.principalShares(address(b)),
            "equal donors keep equal frozen shares"
        );
    }

    /// @dev migrate takes the position with it: there is no second tranche left behind, because there is no
    ///      second tranche.
    function test_migrate_relocatesTheWholePosition() public {
        _contributeBenefactor(1 ether);
        _contributeNewBenefactor(address(0xCAFE), 1 ether);
        assertEq(vault.totalPrincipal(), 2 ether);

        address recovery = makeAddr("recovery");
        vm.deal(recovery, 0);

        vm.prank(vaultOwner);
        vault.migratePosition(recovery);

        assertApproxEqAbs(recovery.balance, 2 ether, 2, "the whole basis moved");
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2, "nothing left in the position");
        assertEq(vault.deployableCorpus(), 0, "and nothing left to deploy");
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

    function test_migrate_revertsNoPrincipal() public {
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
    // 9. Admin: there is no community-payout setter to hold
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev The vault exposes no `setCommunityPayout(address)` at all — not an owner-gated one, not a
    ///      fallback-only one. Asserted by selector against the deployed bytecode rather than by the
    ///      compiler, because the point is what an owner holding the key can send, not what this test
    ///      file can name: a call carrying the old selector must find nothing to run.
    function test_vaultExposesNoCommunityPayoutSetter() public {
        bytes memory oldCall = abi.encodeWithSignature("setCommunityPayout(address)", address(0xDD01));

        vm.prank(vaultOwner);
        (bool ok,) = address(vault).call(oldCall);
        assertFalse(ok, "the owner has no sink setter on the vault");

        vm.prank(stranger);
        (ok,) = address(vault).call(oldCall);
        assertFalse(ok, "and neither does anyone else");

        assertEq(ambassadorRegistry.getCommunityPayout(TARGET_ID), communityPayout, "the registry's sink is unmoved");
    }

    /// @dev And the absence is load-bearing rather than cosmetic: the owner cannot reach the target leg by
    ///      any route the vault offers, so a harvest after their attempt still pays the community.
    function test_ownerCannotRedirectTheTargetLeg() public {
        vm.startPrank(vaultOwner);
        (bool ok,) = address(vault).call(abi.encodeWithSignature("setCommunityPayout(address)", stranger));
        assertFalse(ok);
        (ok,) = address(vault).call(abi.encodeWithSignature("communityPayout()"));
        assertFalse(ok, "and there is no stored sink left to read either");
        vm.stopPrank();

        _contributeBenefactor(ONE_ETH);
        _simulateYield(0.1 ether);

        uint256 communityBefore = communityPayout.balance;
        uint256 strangerBefore = stranger.balance;
        vault.harvest();

        assertEq(communityPayout.balance - communityBefore, 0.019 ether, "the community was paid");
        assertEq(stranger.balance, strangerBefore, "the owner's chosen address got nothing");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 10. Stat surface + interface views
    // ═══════════════════════════════════════════════════════════════════════

    function test_statSurface_acrossLifecycle() public {
        _contributeBenefactor(2 ether);
        assertEq(vault.totalPrincipalLocked(), 2 ether);
        assertEq(vault.totalPrincipalCommittedAllTime(), 2 ether);
        assertEq(vault.totalDeployedByTarget(), 0);
        assertApproxEqAbs(vault.currentPositionValue(), 2 ether, 2);

        _simulateYield(1 ether);
        assertApproxEqAbs(vault.accumulatedFees(), 1 ether, 2);
        vault.harvest();
        assertEq(vault.totalYieldToCreators(), 0.8 ether);
        assertEq(vault.totalYieldToTarget(), 0.19 ether);
        assertEq(vault.totalProtocolFees(), 0.01 ether);

        vm.prank(ambassador);
        vault.execute(makeAddr("sink"), 2 ether, "");
        assertEq(vault.totalDeployedByTarget(), 2 ether);
        assertEq(vault.totalPrincipalLocked(), 0);
        // The all-time counter is the one number a withdrawal does not move: it records what was given.
        assertEq(vault.totalPrincipalCommittedAllTime(), 2 ether);
        assertEq(vault.principalOf(address(benefactorContract)), 0);
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
    // 12. execute — target-sovereign deployment of the corpus
    // ═══════════════════════════════════════════════════════════════════════

    function test_execute_ambassadorDeploysUpToCorpus() public {
        _contributeBenefactor(2 ether);
        assertEq(vault.deployableCorpus(), 2 ether, "corpus == principal");

        address sink = makeAddr("sink");
        vm.prank(ambassador);
        vault.execute(sink, 2 ether, "");

        assertEq(sink.balance, 2 ether, "full corpus deployed");
        assertEq(vault.deployableCorpus(), 0, "corpus emptied");
        assertEq(vault.totalPrincipal(), 0);
        assertEq(vault.totalDeployedByTarget(), 2 ether, "deploy counter updated");
    }

    /// @dev The pivot, stated as a test: every wei of principal is reachable the block it arrives. There is
    ///      no untouchable class and no waiting period — the ambassador seat plus live curation is the whole
    ///      gate, and it is checked against the whole pool.
    function test_execute_reachesFreshlyDepositedPrincipal() public {
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 1 ether);
        _contributeBenefactor(1 ether); // deposited in this very block

        assertEq(vault.deployableCorpus(), 2 ether, "the corpus is the whole pool");

        address sink = makeAddr("sink");
        vm.prank(ambassador);
        vault.execute(sink, 2 ether, "");

        assertEq(sink.balance, 2 ether, "including principal that has been here for zero seconds");
        assertEq(vault.principalOf(address(b)), 0);
        assertEq(vault.principalOf(address(benefactorContract)), 0);
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2, "position drained");
    }

    function test_execute_revertsNonAmbassador() public {
        _contributeBenefactor(1 ether);
        vm.prank(stranger);
        vm.expectRevert(AlignmentEndowmentVault.NotAuthorized.selector);
        vault.execute(makeAddr("sink"), 1 ether, "");
    }

    function test_execute_revertsOverCorpus() public {
        _contributeBenefactor(1 ether);
        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ExceedsDeployableCorpus.selector);
        vault.execute(makeAddr("sink"), 1 ether + 1, "");
    }

    function test_execute_withdrawToEOA() public {
        _contributeBenefactor(1 ether);
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
        _contributeBenefactor(3 ether);
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
        assertEq(vault.totalPrincipal(), 1 ether, "corpus decremented by the deploy");
    }

    /// @dev The sole backstop: owner `removeAmbassador` on the alignment registry revokes execute rights.
    function test_execute_removeAmbassadorRevokes() public {
        _contributeBenefactor(1 ether);
        ambassadorRegistry.removeAmbassador(TARGET_ID, ambassador);
        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.NotAuthorized.selector);
        vault.execute(makeAddr("sink"), 1 ether, "");
    }

    /// @dev Auth resolves LIVE through `masterRegistry.alignmentRegistry()`: a re-point of the alignment
    ///      registry is honored immediately (no cache), and a grant on the live registry enables execute.
    function test_execute_authResolvesLiveThroughMasterRegistry() public {
        _contributeBenefactor(1 ether);

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
        _contributeBenefactor(2 ether);
        ReentrantDeployer attacker = new ReentrantDeployer(vault);
        // The attacker must pass auth for the re-entry to actually exercise the nonReentrant guard.
        ambassadorRegistry.setAmbassador(TARGET_ID, address(attacker), true);

        vm.prank(ambassador);
        vault.execute(address(attacker), 1 ether, "");

        assertTrue(attacker.reentryAttempted(), "attacker attempted re-entry");
        assertFalse(attacker.reentrySucceeded(), "re-entry blocked by nonReentrant");
        assertEq(address(attacker).balance, 1 ether, "attacker received exactly one deployment");
        assertEq(vault.totalDeployedByTarget(), 1 ether, "single spend recorded");
        assertEq(vault.totalPrincipal(), 1 ether, "corpus decremented once (2 - 1)");
    }

    /// @dev A callee that reverts bubbles its revert and rolls back the whole deploy (no partial spend).
    function test_execute_bubblesCalleeRevertAndRollsBack() public {
        _contributeBenefactor(1 ether);
        RejectETH r = new RejectETH();
        vm.prank(ambassador);
        vm.expectRevert();
        vault.execute(address(r), 1 ether, "");

        // Effects rolled back with the revert.
        assertEq(vault.totalPrincipal(), 1 ether, "corpus intact after failed deploy");
        assertEq(vault.totalDeployedByTarget(), 0, "counter intact after failed deploy");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 13. execute may not route around the accounting via calldata
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev A pooled position with two donors, so a drain would take money that is not the caller's to
    ///      take, and the vault also holds native ETH for other people (a creator purse) that a
    ///      calldata-routed drain would leave unbacked.
    function _pooledPosition() internal returns (MockOwnable b) {
        _contributeBenefactor(1 ether);
        b = _contributeNewBenefactor(address(0xCAFE), 1 ether);
        _simulateYield(1 ether);
        vault.harvest(); // 0.8 ETH now sits in the vault as creator purses
    }

    /// @dev THE DRAIN: an authorized ambassador passes `value = 0` (trivially ≤ corpus) and routes an
    ///      ERC-20 `transfer` of the vault's ENTIRE stataToken share balance through `data`. That moves
    ///      principal out with no debit to `totalPrincipal` — the basis desyncs and the creator purses the
    ///      vault is holding stop being backed. It must revert and leave the position intact.
    function test_execute_revertsDrainViaStataTokenCalldata() public {
        _pooledPosition();
        uint256 sharesBefore = stata.balanceOf(address(vault));
        assertGt(sharesBefore, 0, "vault holds the position shares");

        address attacker = makeAddr("attacker");
        bytes memory drain = abi.encodeWithSignature("transfer(address,uint256)", attacker, sharesBefore);

        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ForbiddenExecuteTarget.selector);
        vault.execute(address(stata), 0, drain);

        // No shares moved; the basis and the purses it backs are intact.
        assertEq(stata.balanceOf(address(vault)), sharesBefore, "position shares unchanged after attempted drain");
        assertEq(stata.balanceOf(attacker), 0, "attacker received nothing");
        assertEq(vault.totalPrincipal(), 2 ether, "principal basis intact");
    }

    /// @dev The WETH the vault holds an unbounded approval on is also a forbidden target (approve/transfer
    ///      route to principal), as is the vault itself (self-call). Both revert ForbiddenExecuteTarget.
    function test_execute_revertsForbiddenWethAndSelfTargets() public {
        _pooledPosition();

        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ForbiddenExecuteTarget.selector);
        vault.execute(
            address(weth), 0, abi.encodeWithSignature("approve(address,uint256)", stranger, type(uint256).max)
        );

        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ForbiddenExecuteTarget.selector);
        vault.execute(address(vault), 0, "");
    }

    /// @dev The denylist is additive: legit value-only deployment to an arbitrary `to` (an EOA here) still
    ///      succeeds, and the creator purses the vault holds are not dipped into to fund it.
    function test_execute_legitValueDeployStillWorksAfterDenylist() public {
        MockOwnable b = _pooledPosition();
        address eoa = makeAddr("legit_sink");

        vm.prank(ambassador);
        vault.execute(eoa, 2 ether, ""); // the whole corpus, value-only

        assertEq(eoa.balance, 2 ether, "legit value-only deploy to EOA still works");
        assertEq(vault.totalPrincipal(), 0, "corpus deployed");
        assertEq(address(vault).balance, 0.8 ether, "the creator purses were not spent to fund it");
        assertEq(vault.pendingYieldOf(address(b)), 0.4 ether, "and they are still owed");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 14. migrate zeroes the basis + decommissions (no brick / no re-open)
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev After a migrate the basis is zeroed so nothing reads a phantom position, and intake is
    ///      permanently closed.
    function test_migrate_zeroesBasisAndDecommissions() public {
        _contributeBenefactor(1 ether);
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 1 ether);
        assertEq(vault.totalPrincipal(), 2 ether);

        vm.prank(vaultOwner);
        vault.migratePosition(makeAddr("recovery"));

        assertEq(vault.totalPrincipal(), 0, "basis zeroed");
        assertTrue(vault.migrated(), "vault decommissioned");
        assertEq(vault.deployableCorpus(), 0, "nothing left to deploy");

        // harvest does NOT brick — it is a no-op against an empty position rather than a revert.
        vault.harvest();

        // Intake is closed: a post-migrate deposit cannot re-open the dead position.
        vm.deal(alice, alice.balance + 1 ether);
        vm.prank(alice);
        vm.expectRevert(AlignmentEndowmentVault.VaultMigrated.selector);
        vault.receiveContribution{ value: 1 ether }(nativeCurrency, 1 ether, address(b));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 16. migrate harvest-first + impairment write-down; execute forwards `got`
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev `migratePosition` crystallizes the pending Aave yield (split 80/19/1 into the legs) BEFORE
    ///      redeeming principal to `to`. The recovery address must receive PRINCIPAL only — the yield stays
    ///      in the legs, not swept out.
    function test_migrate_harvestsYieldFirst_noSweepToRecovery() public {
        _contributeBenefactor(10 ether);
        _simulateYield(1 ether); // position 11, basis 10 → 1 ETH pending yield

        uint256 communityBefore = communityPayout.balance;
        uint256 treasuryBefore = treasury.balance;

        address recovery = makeAddr("recovery");
        vm.deal(recovery, 0);

        vm.prank(vaultOwner);
        vault.migratePosition(recovery);

        // Yield split 80/19/1 into the legs — NOT swept to the recovery address.
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether, "creator leg booked (not swept)");
        assertEq(vault.totalYieldToCreators(), 0.8 ether);
        assertEq(communityPayout.balance - communityBefore, 0.19 ether, "target leg 19% routed to community");
        assertEq(treasury.balance - treasuryBefore, 0.01 ether, "protocol leg 1% routed to treasury");
        assertEq(vault.totalYieldToTarget(), 0.19 ether);
        assertEq(vault.totalProtocolFees(), 0.01 ether);

        // recovery receives the PRINCIPAL (10 ETH), NOT principal + yield (11 ETH).
        assertApproxEqAbs(recovery.balance, 10 ether, 2, "recovery gets principal only, not the yield");
    }

    /// @dev Fix 3 (execute redeem-dust): on a dusty redeem (`got = value − dust`, within `REDEEM_DUST`)
    ///      `execute` forwards `got`, NOT `value` — so the ~dust shortfall is never covered from the vault's
    ///      OTHER native ETH (a creator `yieldPurse`). The un-redeemed dust stays as deployable corpus.
    function test_execute_dustyRedeem_forwardsGot_noYieldPurseDip() public {
        _contributeBenefactor(1 ether); // corpus = 1 ETH
        assertEq(vault.deployableCorpus(), 1 ether);

        // The vault holds OTHER native ETH (a creator yieldPurse / stray ETH) that execute must not dip.
        uint256 otherEth = 5 ether;
        vm.deal(address(vault), otherEth);

        // Force a dusty redeem: maxWithdraw returns value − dust, so `_redeem(0.5 ETH)` yields
        // got = 0.5 ETH − dust. Deploy half the corpus, so what is left sits far above the price floor
        // and the round stays open — the retained dust is the thing under test here.
        uint256 dust = 1e6; // == REDEEM_DUST — tolerated (no RedeemShortfall)
        stata.setMaxWithdrawCap(0.5 ether - dust);

        address sink = makeAddr("dust_sink");
        vm.expectEmit(true, true, false, true);
        emit CapitalDeployed(ambassador, sink, 0.5 ether - dust, bytes4(0), block.timestamp);
        vm.prank(ambassador);
        vault.execute(sink, 0.5 ether, "");

        // `to` receives what was ACTUALLY redeemed (got), not the requested value.
        assertEq(sink.balance, 0.5 ether - dust, "sink receives got, not value");
        // The vault's other native ETH is UNTOUCHED — no dust dip from the yieldPurse.
        assertEq(address(vault).balance, otherEth, "yieldPurse / other native ETH untouched");
        // The un-redeemed dust stays as still-deployable corpus (debited by got, not value).
        assertEq(vault.totalPrincipal(), 0.5 ether + dust, "dust retained as corpus (debited by got)");
        assertEq(vault.totalDeployedByTarget(), 0.5 ether - dust, "deploy counter tracks got");
    }

    /// @dev The other end of the same redeem: when the WHOLE corpus is deployed dustily, what is left is a
    ///      sliver of the share count rather than a real balance, so the round closes instead of carrying a
    ///      near-zero price into the next deposit. The residue is not destroyed — it stays in the position
    ///      and the next harvest splits it 80/19/1.
    function test_execute_dustyFullRedeem_closesTheRoundAndLeavesTheResidueAsYield() public {
        _contributeBenefactor(1 ether);

        uint256 dust = 1e6;
        stata.setMaxWithdrawCap(1 ether - dust);

        address sink = makeAddr("dust_sink");
        vm.prank(ambassador);
        vault.execute(sink, 1 ether, "");

        assertEq(sink.balance, 1 ether - dust, "sink receives got");
        assertEq(vault.totalPrincipal(), 0, "a residue that small ends the round");
        assertEq(vault.deployableCorpus(), 0, "and there is no corpus left to deploy");
        assertEq(vault.accumulatedFees(), dust, "the residue is still there, now as harvestable yield");

        // The next deposit therefore prices against an empty pool and owns all of it.
        stata.setMaxWithdrawCap(0);
        MockOwnable b = _contributeNewBenefactor(address(0xCAFE), 1 ether);
        assertEq(vault.fundingRound(), 1, "a fresh round opened");
        assertEq(vault.principalOf(address(b)), 1 ether, "the new benefactor funds the whole pool");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 17. deployableCorpus() is clamped to what the position can redeem
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev A 20% solvency haircut on a 20 ETH pooled basis: the position is worth 16, so that — and not
    ///      the nominal basis — is what may be deployed.
    function _impairedPosition() internal {
        _contributeBenefactor(10 ether);
        _contributeNewBenefactor(address(0xCAFE), 10 ether);
        assertEq(vault.totalPrincipal(), 20 ether, "basis before the haircut");

        stata.simulateLoss(4 ether); // 20% solvency haircut: 20 → 16
        vm.deal(address(weth), 100 ether); // ensure redemptions settle in ETH
        assertEq(vault.currentPositionValue(), 16 ether, "position value after the haircut");
    }

    /// @dev The clamp: the reported corpus is the live position value, not the nominal basis. The basis
    ///      itself is untouched by a READ — this is an accounting bound on what is redeemable, applied as a
    ///      write-down only on the paths that actually move money.
    function test_deployableCorpus_impaired_clampsToPositionValue() public {
        _impairedPosition();

        assertEq(vault.deployableCorpus(), 16 ether, "corpus clamped to the live position value");
        assertEq(vault.totalPrincipal(), 20 ether, "the nominal basis is not written down by a read");
    }

    /// @dev THE HEADLINE. Deploying the nominal (un-clamped) basis on an impaired position must be rejected
    ///      by the corpus bound — and specifically NOT by `RedeemShortfall`, which would leave the request
    ///      half-processed against a stale bound.
    function test_execute_impaired_nominalBasisRevertsExceedsDeployableCorpus() public {
        _impairedPosition();

        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.ExceedsDeployableCorpus.selector);
        vault.execute(makeAddr("sink"), 20 ether, "");

        // Nothing moved: the whole position is still in place behind the rejected request.
        assertEq(vault.currentPositionValue(), 16 ether, "position untouched by the rejected deploy");
        assertEq(vault.totalPrincipal(), 20 ether, "basis untouched by the rejected deploy");
    }

    /// @dev The clamped figure is deployable in full and settles without a shortfall.
    function test_execute_impaired_clampedCorpusDeploysCleanly() public {
        _impairedPosition();

        address sink = makeAddr("sink");
        uint256 corpus = vault.deployableCorpus(); // cache: a call in the arg would consume the prank
        vm.prank(ambassador);
        vault.execute(sink, corpus, "");

        assertEq(sink.balance, 16 ether, "the full clamped corpus reached the sink");
        assertEq(vault.totalPrincipal(), 4 ether, "basis debited by what actually left");
        assertEq(vault.totalDeployedByTarget(), 16 ether, "deploy counter tracks what left");
        assertApproxEqAbs(vault.currentPositionValue(), 0, 2, "the position is emptied");
    }

    /// @dev Idempotency — the property the view shape exists for. At an unchanged position value the answer
    ///      never moves, however many times it is read and however many permissionless `harvest()` calls are
    ///      interleaved. A write-down applied on a permissionless path would instead converge downward on
    ///      each call; a view has no state to re-apply.
    function test_deployableCorpus_impaired_isIdempotentAcrossReadsAndHarvests() public {
        _impairedPosition();

        uint256 first = vault.deployableCorpus();
        assertEq(first, 16 ether, "clamped corpus");

        for (uint256 i = 0; i < 5; i++) {
            vault.harvest(); // permissionless, and a no-op while the position is below basis
            assertEq(vault.deployableCorpus(), first, "corpus unchanged by a harvest at an unchanged value");
            assertEq(vault.deployableCorpus(), first, "corpus unchanged by a repeated read");
        }

        assertEq(vault.totalPrincipal(), 20 ether, "nominal basis never written down by a read");
    }

    /// @dev Healthy position: the clamp is a strict no-op. Unharvested yield above the basis does NOT raise
    ///      the corpus either — the clamp keeps the yield legs out of `execute`'s reach.
    function test_deployableCorpus_healthy_clampIsNoOp() public {
        _contributeBenefactor(10 ether);
        _contributeNewBenefactor(address(0xCAFE), 10 ether);

        assertEq(vault.deployableCorpus(), vault.totalPrincipal(), "no-op at value == basis");
        assertEq(vault.deployableCorpus(), 20 ether);

        _simulateYield(2 ether); // position 22 vs basis 20 — all of it is yield, none of it is corpus
        assertEq(vault.deployableCorpus(), 20 ether, "unharvested yield does not raise the corpus");
        assertEq(vault.deployableCorpus(), vault.totalPrincipal(), "still exactly the nominal basis");
    }

    /// @dev An empty vault has a zero basis: the clamp's guard returns 0 rather than reverting.
    function test_deployableCorpus_zeroBasis_returnsZeroAndDoesNotRevert() public {
        AlignmentEndowmentVault fresh = _deployVault();

        assertEq(fresh.totalPrincipal(), 0, "no principal");
        assertEq(fresh.deployableCorpus(), 0, "zero basis reports zero corpus");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 18. De-curation freezes the ambassador seat's spending, without stranding the corpus
    // ═══════════════════════════════════════════════════════════════════════

    /// @dev The ambassador seat is an appointment made because the protocol curates the target, so
    ///      withdrawing curation withdraws the discretion that came with it — for every seat at once,
    ///      rather than one `removeAmbassador` call at a time. The appointment itself is untouched:
    ///      `isAmbassador` still answers true, which is what makes this a check on the target and not a
    ///      restatement of the auth check above it.
    function test_execute_frozenAfterDecuration() public {
        _contributeBenefactor(1 ether);

        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);

        assertTrue(ambassadorRegistry.isAmbassador(TARGET_ID, ambassador), "the seat itself survives de-curation");
        vm.prank(ambassador);
        vm.expectRevert(AlignmentEndowmentVault.TargetDecurated.selector);
        vault.execute(makeAddr("sink"), 1 ether, "");

        assertEq(vault.totalPrincipal(), 1 ether, "corpus unspent");
    }

    /// @dev Non-vacuity for the test above: the same call on the same position succeeds while the target
    ///      is curated. Deleting the `isAlignmentTargetActive` gate turns the revert test green-to-red;
    ///      this one pins that the gate is the only thing standing between them.
    function test_execute_stillWorksWhileCurated() public {
        _contributeBenefactor(1 ether);
        address sink = makeAddr("sink");

        vm.prank(ambassador);
        vault.execute(sink, 1 ether, "");

        assertEq(sink.balance, 1 ether, "a curated target still deploys its corpus");
    }

    /// @dev The freeze is on SPENDING, not on the seat. A de-curated community can still correct the text
    ///      and logo it shows — `updateAlignmentTarget` is `onlyOwnerOrAmbassador` and reads no `active`
    ///      flag — which is what "they can operate what has been given to them" means in practice.
    function test_decuration_leavesTheSeatsMetadataPowerIntact() public {
        AlignmentRegistryV1 realRegistry = new AlignmentRegistryV1(address(weth));
        realRegistry.initialize(address(this));

        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] =
            IAlignmentRegistry.AlignmentAsset({ token: alignmentToken, symbol: "EXEC", info: "", metadataURI: "" });
        uint256 id = realRegistry.registerAlignmentTarget("Remilia", "", "", assets);
        realRegistry.addAmbassador(id, ambassador);
        realRegistry.deactivateAlignmentTarget(id);

        assertFalse(realRegistry.isAlignmentTargetActive(id), "target de-curated");
        assertEq(realRegistry.ambassadorCount(id), 1, "the outstanding seat is still counted");

        vm.prank(ambassador);
        realRegistry.updateAlignmentTarget(id, "still ours", "");
        assertEq(realRegistry.getAlignmentTarget(id).description, "still ours", "metadata power survives");
    }

    /// @dev The freeze would be a permanent strand on its own: `migratePosition` is an owner emergency and
    ///      not a route the community can ask for, so with `execute` closed the corpus has no other exit and
    ///      de-curation is one-way. `releaseCorpusToCommunity` is that exit — permissionless, whole-corpus,
    ///      and to the registry's own sink rather than an address the caller picks.
    function test_releaseCorpusToCommunity_deliversTheFrozenCorpusToTheRegistrySink() public {
        _contributeBenefactor(1 ether);
        _contributeNewBenefactor(address(0xCAFE), 1 ether);
        address sink = makeAddr("community_sink");
        ambassadorRegistry.setCommunityPayout(TARGET_ID, sink);
        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);

        uint256 released = vault.releaseCorpusToCommunity();

        assertEq(released, 2 ether, "the whole corpus is released");
        assertEq(sink.balance, 2 ether, "and it lands at the community's own sink");
        assertEq(vault.totalPrincipal(), 0, "corpus emptied");
    }

    /// @dev A stranger may call it, because the call carries no choice: no amount argument, no destination
    ///      argument. That is what makes leaving it open safe rather than a gift to a de-curated seat.
    function test_releaseCorpusToCommunity_isPermissionlessButNotADirection() public {
        _contributeBenefactor(1 ether);
        address sink = makeAddr("community_sink");
        ambassadorRegistry.setCommunityPayout(TARGET_ID, sink);
        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);

        vm.prank(stranger);
        vault.releaseCorpusToCommunity();

        assertEq(sink.balance, 1 ether, "the stranger moved it to the community, not to themselves");
        assertEq(stranger.balance, 0, "and gained nothing by calling");
    }

    /// @dev It is the de-curation exit and nothing else: while the target is curated the corpus is the
    ///      target's to deploy, and this must not become a way to force it out from under them.
    function test_releaseCorpusToCommunity_revertsWhileTheTargetIsStillCurated() public {
        _contributeBenefactor(1 ether);
        ambassadorRegistry.setCommunityPayout(TARGET_ID, makeAddr("community_sink"));

        vm.expectRevert(AlignmentEndowmentVault.TargetStillCurated.selector);
        vault.releaseCorpusToCommunity();
    }

    /// @dev With no sink wired the corpus waits rather than being force-sent somewhere arbitrary. The
    ///      registry keeps `setCommunityPayout` open on an inactive target precisely so this is recoverable
    ///      after the fact, so the same call must then succeed. Waiting is the only option the vault has:
    ///      it holds no sink of its own to fall back to in the meantime.
    function test_releaseCorpusToCommunity_waitsForASinkThenDelivers() public {
        // No sink wired in the registry, and a clone cannot carry one of its own, so `_targetSink()`
        // really is unset.
        _clearRegistrySink();
        AlignmentEndowmentVault bare = _deployVault();
        MockOwnable b = new MockOwnable(alice);
        vm.prank(alice);
        bare.receiveContribution{ value: 1 ether }(nativeCurrency, 1 ether, address(b));
        assertEq(bare.totalPrincipal(), 1 ether, "corpus funded");

        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);

        vm.expectRevert(AlignmentEndowmentVault.CommunityPayoutNotSet.selector);
        bare.releaseCorpusToCommunity();
        assertEq(bare.totalPrincipal(), 1 ether, "corpus still held, not dropped");

        address sink = makeAddr("late_sink");
        ambassadorRegistry.setCommunityPayout(TARGET_ID, sink);
        bare.releaseCorpusToCommunity();

        assertEq(sink.balance, 1 ether, "a sink wired after de-curation still collects");
        assertEq(bare.totalPrincipal(), 0, "corpus emptied");
    }

    /// @dev On an impaired position the release writes the basis DOWN to what the position can realize
    ///      rather than releasing against a nominal figure it cannot back. Without the write-down
    ///      `totalPrincipal` would keep the nominal number and carry an unbacked residual no later call
    ///      could redeem; here one call empties it.
    function test_releaseCorpusToCommunity_impaired_writesTheBasisDownAndEmptiesIt() public {
        _contributeBenefactor(10 ether);
        _contributeNewBenefactor(address(0xCAFE), 10 ether);
        assertEq(vault.totalPrincipal(), 20 ether, "nominal basis");

        stata.simulateLoss(10 ether); // 50% impairment
        vm.deal(address(weth), 100 ether);

        address sink = makeAddr("community_sink");
        ambassadorRegistry.setCommunityPayout(TARGET_ID, sink);
        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);

        vm.expectEmit(false, false, false, true);
        emit ImpairmentRealized(5000, block.timestamp);
        uint256 released = vault.releaseCorpusToCommunity();

        assertApproxEqAbs(released, 10 ether, 1e9, "the realizable half is what leaves");
        assertApproxEqAbs(sink.balance, 10 ether, 1e9, "and it lands at the community sink");
        assertLe(vault.totalPrincipal(), 1e9, "basis written down and emptied, no unbacked residual");
    }

    /// @dev Harvest-first, for the reason `execute` does it: releasing the LAST principal would otherwise
    ///      trap the pending yield behind `_crystallizeYield`'s `totalPrincipal == 0` guard.
    function test_releaseCorpusToCommunity_crystallizesYieldBeforeEmptyingThePosition() public {
        _contributeBenefactor(1 ether);
        _simulateYield(1 ether); // unharvested

        address sink = makeAddr("community_sink");
        ambassadorRegistry.setCommunityPayout(TARGET_ID, sink);
        ambassadorRegistry.deactivateAlignmentTarget(TARGET_ID);

        uint256 treasuryBefore = treasury.balance;
        vault.releaseCorpusToCommunity();

        // The flat split runs first, so the sink collects its 19% on top of the corpus, the protocol gets
        // its 1%, and the creator's 80% is booked to the purse. Nothing is left behind an emptied position.
        assertEq(treasury.balance - treasuryBefore, 0.01 ether, "protocol leg realized before the release");
        assertEq(vault.pendingYieldOf(address(benefactorContract)), 0.8 ether, "creator leg booked");
        assertEq(sink.balance, 1 ether + 0.19 ether, "target leg + corpus both delivered");
        assertEq(vault.totalPrincipal(), 0, "corpus emptied");
    }
}
