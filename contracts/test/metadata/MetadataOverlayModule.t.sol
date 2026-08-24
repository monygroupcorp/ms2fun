// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MetadataOverlayModule } from "../../src/metadata/MetadataOverlayModule.sol";
import { IMasterRegistry } from "../../src/master/interfaces/IMasterRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { Ownable } from "solady/auth/Ownable.sol";

contract ToggleRegistry {
    mapping(address => bool) public factories;

    function setFactory(address a, bool v) external {
        factories[a] = v;
    }

    function isFactoryRegistered(address a) external view returns (bool) {
        return factories[a];
    }

    mapping(address => address) public instFactory;

    function setInstanceFactory(address inst_, address f) external {
        instFactory[inst_] = f;
    }

    function getInstanceInfo(address inst_) external view returns (IMasterRegistry.InstanceInfo memory info) {
        info.instance = inst_;
        info.factory = instFactory[inst_];
    }

    // noesis-126: the SPLIT route now re-checks the vault's alignment target. Default true so the pre-existing
    // SPLIT tests are unaffected; a test flips a specific vault to false to drive the revocation redirect.
    bool public defaultVaultRegistered = true;
    mapping(address => bool) internal _vaultRegOverride;
    mapping(address => bool) internal _vaultReg;

    function setVaultRegistered(address v, bool r) external {
        _vaultRegOverride[v] = true;
        _vaultReg[v] = r;
    }

    function isVaultRegistered(address v) external view returns (bool) {
        return _vaultRegOverride[v] ? _vaultReg[v] : defaultVaultRegistered;
    }
}

contract MockOverlayInstance {
    address public owner;
    address public stakingModule;
    address public vault;
    address public protocolTreasury;
    mapping(uint256 => address) internal _tok;
    mapping(address => uint256) public balanceOf;

    function setOwner(address o) external {
        owner = o;
    }

    function setStaking(address s) external {
        stakingModule = s;
    }

    function setVault(address v) external {
        vault = v;
    }

    function setTreasury(address t) external {
        protocolTreasury = t;
    }

    function setTokenOwner(uint256 id, address o) external {
        _tok[id] = o;
    }

    function setBalance(address a, uint256 v) external {
        balanceOf[a] = v;
    }

    function ownerOf(uint256 id) external view returns (address) {
        address o = _tok[id];
        require(o != address(0), "TokenDoesNotExist");
        return o;
    }
}

contract MockStaking {
    mapping(address => mapping(address => uint256)) public stakedBalance;

    function set(address inst, address holder, uint256 v) external {
        stakedBalance[inst][holder] = v;
    }
}

contract MockSplitVault {
    uint256 public received;
    address public benefactor;

    function receiveContribution(Currency, uint256, address b) external payable {
        received += msg.value;
        benefactor = b;
    }
    receive() external payable { }
}

/// @dev A registered, healthy vault that STILL reverts on `receiveContribution`, reproducing the two
///      real production reverts: a contribution below the vault's minimum, and a filled conversion-
///      participant cap. Wiring this in place of the always-accepting mock de-vacuums the SPLIT gate:
///      the guard must isolate these reverts, not brick the holder's unlock.
contract RevertingSplitVault {
    // Mirrors the real vaults' MIN_CONTRIBUTION floor: a sub-minimum tithe reverts.
    uint256 public constant MIN_CONTRIBUTION = 0.001 ether;

    uint256 public received;
    address public benefactor;
    bool public capReached;

    error ContributionBelowMinimum();
    error TooManyConversionParticipants();

    /// @dev Flip to simulate the conversion-participant cap being full — every contribution then reverts.
    function setCapReached(bool v) external {
        capReached = v;
    }

    function receiveContribution(Currency, uint256, address b) external payable {
        if (capReached) revert TooManyConversionParticipants();
        if (msg.value < MIN_CONTRIBUTION) revert ContributionBelowMinimum();
        received += msg.value;
        benefactor = b;
    }
    receive() external payable { }
}

/// @dev Owner contract that reenters unlock on receiving its artist payout — must be blocked.
contract ReentrantArtist {
    MetadataOverlayModule ov;
    address inst;
    uint256 reenterId;

    function arm(MetadataOverlayModule _ov, address _inst, uint256 _id) external {
        ov = _ov;
        inst = _inst;
        reenterId = _id;
    }

    receive() external payable {
        // Reentry into a guarded function — nonReentrant must revert this.
        ov.unlock(inst, reenterId);
    }
}

contract MetadataOverlayModuleTest is Test {
    MetadataOverlayModule ov;
    ToggleRegistry registry;
    MockOverlayInstance inst;

    address factory = address(0xF1);
    address attacker = address(0xBAD);
    address artist = address(0xA117);
    address holder = address(0xB0B);
    address treasury = address(0x7);

    function setUp() public {
        registry = new ToggleRegistry();
        ov = new MetadataOverlayModule(address(registry));
        registry.setFactory(factory, true);
        inst = new MockOverlayInstance();
        inst.setOwner(artist);
        inst.setTreasury(treasury);
        registry.setInstanceFactory(address(inst), factory);
    }

    function _config(bool autoLatest) internal {
        vm.prank(factory);
        ov.initConfig(address(inst), autoLatest, MetadataOverlayModule.Payout.ARTIST);
    }

    // ── Config wiring ───────────────────────────────────────────────────────────

    function test_initConfig_onlyRegisteredFactory() public {
        vm.prank(attacker);
        vm.expectRevert(MetadataOverlayModule.NotRegisteredFactory.selector);
        ov.initConfig(address(inst), true, MetadataOverlayModule.Payout.ARTIST);
    }

    function test_initConfig_sealOnce() public {
        _config(true);
        vm.prank(factory);
        vm.expectRevert(MetadataOverlayModule.AlreadyConfigured.selector);
        ov.initConfig(address(inst), false, MetadataOverlayModule.Payout.ARTIST);
    }

    /// @dev D1 least-privilege: only the instance's OWN registered factory may init — a different
    ///      (even registered) factory cannot seed config for an instance it does not own.
    function test_initConfig_rejectsWrongFactory() public {
        // inst is registered to `factory` (setUp). A different caller must be rejected.
        address otherFactory = address(0xF2);
        registry.setFactory(otherFactory, true); // globally registered, but NOT inst's factory
        vm.prank(otherFactory);
        vm.expectRevert(MetadataOverlayModule.NotRegisteredFactory.selector);
        ov.initConfig(address(inst), true, MetadataOverlayModule.Payout.ARTIST);
    }

    // ── Artist writes ───────────────────────────────────────────────────────────

    function test_publishWave_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(MetadataOverlayModule.NotInstanceOwner.selector);
        ov.publishWave(
            address(inst), "e-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
    }

    function test_publishWave_appendOnlyIncrements() public {
        vm.startPrank(artist);
        uint256 w0 = ov.publishWave(
            address(inst), "a-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        uint256 w1 = ov.publishWave(
            address(inst), "b-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        vm.stopPrank();
        assertEq(w0, 0);
        assertEq(w1, 1);
        assertEq(ov.waveCount(address(inst)), 2);
    }

    function test_setCommission_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(MetadataOverlayModule.NotInstanceOwner.selector);
        ov.setCommission(
            address(inst), 1, "c", MetadataOverlayModule.CommCond.NONE, 0, MetadataOverlayModule.Payout.ARTIST
        );
    }

    /// @dev H4: a commission locks the moment it is paid for — can't rug what someone bought.
    function test_setCommission_locksOncePaid() public {
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c-1", MetadataOverlayModule.CommCond.PAY, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );

        vm.deal(holder, 1 ether);
        vm.prank(holder);
        ov.unlock{ value: 1 ether }(address(inst), 1);

        // Now locked — artist cannot overwrite.
        vm.prank(artist);
        vm.expectRevert(MetadataOverlayModule.CommissionLocked.selector);
        ov.setCommission(
            address(inst),
            1,
            "c-1-rug",
            MetadataOverlayModule.CommCond.PAY,
            1 ether,
            MetadataOverlayModule.Payout.ARTIST
        );
    }

    function test_setCommission_freeStaysMutable() public {
        vm.startPrank(artist);
        ov.setCommission(
            address(inst), 1, "free-a", MetadataOverlayModule.CommCond.NONE, 0, MetadataOverlayModule.Payout.ARTIST
        );
        ov.setCommission(
            address(inst), 1, "free-b", MetadataOverlayModule.CommCond.NONE, 0, MetadataOverlayModule.Payout.ARTIST
        );
        vm.stopPrank();
        // visible (NONE) → resolves to the latest free URI once selected
        inst.setTokenOwner(1, holder);
        vm.prank(holder);
        ov.select(address(inst), 1, 2); // COMMISSION pointer
        assertEq(ov.resolve(address(inst), 1, holder), "free-b");
    }

    // ── Holder writes / resolution ──────────────────────────────────────────────

    function test_select_onlyHolder() public {
        inst.setTokenOwner(1, holder);
        vm.prank(attacker);
        vm.expectRevert(MetadataOverlayModule.NotHolder.selector);
        ov.select(address(inst), 1, 1);
    }

    /// @dev BASE pin declines overlay (returns "") so the router falls through to the lower stack.
    function test_resolve_basePinDeclines() public {
        _config(true);
        vm.prank(artist);
        ov.publishWave(
            address(inst), "evt-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        inst.setTokenOwner(1, holder);
        vm.prank(holder);
        ov.select(address(inst), 1, 1); // BASE
        assertEq(ov.resolve(address(inst), 1, holder), "");
    }

    /// @dev H2: an open (NONE) auto event must show to ALL holders, not only stakers — AUTO is gated
    ///      only by the per-wave Condition, never a blanket staked check.
    function test_resolve_autoOpenWave_showsToNonStaker() public {
        _config(true); // autoLatest
        vm.prank(artist);
        ov.publishWave(
            address(inst), "evt-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        inst.setTokenOwner(5, holder);
        // holder has zero stake; selection defaults to AUTO
        assertEq(ov.resolve(address(inst), 5, holder), "evt-5");
    }

    function test_resolve_autoOff_returnsEmpty() public {
        _config(false); // autoLatest off
        vm.prank(artist);
        ov.publishWave(
            address(inst), "evt-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        inst.setTokenOwner(5, holder);
        assertEq(ov.resolve(address(inst), 5, holder), "");
    }

    /// @dev STAKE wave: eligible only when the holder's staked balance clears the threshold.
    function test_resolve_stakeWave_gatedByStake() public {
        MockStaking staking = new MockStaking();
        inst.setStaking(address(staking));
        vm.prank(artist);
        uint256 w = ov.publishWave(
            address(inst),
            "stk-",
            MetadataOverlayModule.WaveCond.STAKE,
            10 ether,
            0,
            MetadataOverlayModule.Payout.ARTIST
        );
        inst.setTokenOwner(2, holder);
        vm.prank(holder);
        ov.select(address(inst), 2, w + 3); // pin the wave

        assertEq(ov.resolve(address(inst), 2, holder), ""); // unstaked → not eligible
        staking.set(address(inst), holder, 10 ether);
        assertEq(ov.resolve(address(inst), 2, holder), "stk-2"); // now eligible
    }

    // ── Unlock / payment ────────────────────────────────────────────────────────

    function test_unlock_paysArtist_andPins() public {
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c-1", MetadataOverlayModule.CommCond.PAY, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );

        vm.deal(holder, 1 ether);
        uint256 artistBefore = artist.balance;
        vm.prank(holder);
        ov.unlock{ value: 1 ether }(address(inst), 1);

        assertTrue(ov.paid(address(inst), 1));
        assertEq(ov.selection(address(inst), 1), 2); // COMMISSION
        assertEq(artist.balance, artistBefore + 1 ether);
        assertEq(ov.resolve(address(inst), 1, holder), "c-1");
    }

    function test_unlock_wrongPayment_reverts() public {
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c-1", MetadataOverlayModule.CommCond.PAY, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );
        vm.deal(holder, 1 ether);
        vm.prank(holder);
        vm.expectRevert(MetadataOverlayModule.WrongPayment.selector);
        ov.unlock{ value: 0.5 ether }(address(inst), 1);
    }

    function test_unlock_doublePay_reverts() public {
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c-1", MetadataOverlayModule.CommCond.PAY, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );
        vm.deal(holder, 2 ether);
        vm.startPrank(holder);
        ov.unlock{ value: 1 ether }(address(inst), 1);
        vm.expectRevert(MetadataOverlayModule.AlreadyPaid.selector);
        ov.unlock{ value: 1 ether }(address(inst), 1);
        vm.stopPrank();
    }

    function test_unlock_splitRoutesProtocolVaultArtist() public {
        MockSplitVault vault = new MockSplitVault();
        inst.setVault(address(vault));
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c-1", MetadataOverlayModule.CommCond.PAY, 100, MetadataOverlayModule.Payout.SPLIT
        );

        vm.deal(holder, 100);
        uint256 artistBefore = artist.balance;
        uint256 treasuryBefore = treasury.balance;
        vm.prank(holder);
        ov.unlock{ value: 100 }(address(inst), 1);

        // split(100): 1% protocol / 19% vault / 80% artist
        assertEq(treasury.balance, treasuryBefore + 1);
        assertEq(vault.received(), 19);
        assertEq(vault.benefactor(), address(inst));
        assertEq(artist.balance, artistBefore + 80);
    }

    /// noesis-126 (site 6): if the instance's alignment target is revoked, the SPLIT vault tithe must be
    /// redirected to `protocolTreasury` — NOT fed to the de-curated vault.
    function test_unlock_splitRevokedTarget_RedirectsVaultCutToTreasury() public {
        MockSplitVault vault = new MockSplitVault();
        inst.setVault(address(vault));
        inst.setTokenOwner(1, holder);
        registry.setVaultRegistered(address(vault), false); // DAO revoked the target
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c-1", MetadataOverlayModule.CommCond.PAY, 100, MetadataOverlayModule.Payout.SPLIT
        );

        vm.deal(holder, 100);
        uint256 artistBefore = artist.balance;
        uint256 treasuryBefore = treasury.balance;
        vm.prank(holder);
        vm.expectEmit(true, true, false, true, address(ov));
        emit MetadataOverlayModule.VaultCutRedirected(address(vault), treasury, 19);
        ov.unlock{ value: 100 }(address(inst), 1);

        // 1% protocol + 19% redirected tithe both land at treasury; the vault gets nothing.
        assertEq(treasury.balance, treasuryBefore + 20, "treasury got protocol cut + redirected tithe");
        assertEq(vault.received(), 0, "de-curated vault received nothing");
        assertEq(address(vault).balance, 0, "de-curated vault holds no ETH");
        assertEq(artist.balance, artistBefore + 80, "artist share unchanged");
    }

    /// noesis-126 (site 6): a revoked target whose instance also has a zero treasury must fold the vault cut
    /// into the artist payout rather than force it to address(0) and strand the wei.
    function test_unlock_splitRevokedTarget_ZeroTreasury_FoldsToArtist() public {
        MockSplitVault vault = new MockSplitVault();
        inst.setVault(address(vault));
        inst.setTreasury(address(0)); // codebase-tolerated zero treasury
        inst.setTokenOwner(1, holder);
        registry.setVaultRegistered(address(vault), false);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c-1", MetadataOverlayModule.CommCond.PAY, 100, MetadataOverlayModule.Payout.SPLIT
        );

        vm.deal(holder, 100);
        uint256 artistBefore = artist.balance;
        vm.prank(holder);
        ov.unlock{ value: 100 }(address(inst), 1);

        // protocol cut (zero treasury) + vault cut (revoked, zero treasury) both fold to the artist: full 100.
        assertEq(artist.balance, artistBefore + 100, "all legs folded to artist");
        assertEq(vault.received(), 0, "de-curated vault received nothing");
    }

    /// @dev H5: unlock is nonReentrant + CEI — a reentering artist payout cannot drain.
    function test_unlock_reentrancyBlocked() public {
        ReentrantArtist mal = new ReentrantArtist();
        inst.setOwner(address(mal));
        // mal also holds id 2 with its own PAY commission (the reentry target that would succeed
        // without the guard).
        inst.setTokenOwner(2, address(mal));
        vm.prank(address(mal));
        // owner is mal, so it can author — but use the factory-agnostic path: prank as owner (mal)
        ov.setCommission(
            address(inst), 2, "c-2", MetadataOverlayModule.CommCond.PAY, 1, MetadataOverlayModule.Payout.ARTIST
        );

        // A normal holder for id 1.
        inst.setTokenOwner(1, holder);
        vm.prank(address(mal));
        ov.setCommission(
            address(inst), 1, "c-1", MetadataOverlayModule.CommCond.PAY, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );

        mal.arm(ov, address(inst), 2);
        vm.deal(holder, 1 ether);
        vm.prank(holder);
        vm.expectRevert(); // artist payout reenters unlock → ReentrancyGuard reverts → bubbles up
        ov.unlock{ value: 1 ether }(address(inst), 1);
    }

    /// @dev PAY state is id-keyed, so a paid/pinned augmentation is a sellable upgrade — it travels
    ///      with the token to the new holder with no reset machinery.
    function test_paidUnlock_travelsWithId() public {
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c-1", MetadataOverlayModule.CommCond.PAY, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );
        vm.deal(holder, 1 ether);
        vm.prank(holder);
        ov.unlock{ value: 1 ether }(address(inst), 1);

        // simulate transfer: new owner of id 1
        address buyer = address(0xCAFE);
        inst.setTokenOwner(1, buyer);
        assertTrue(ov.paid(address(inst), 1));
        assertEq(ov.resolve(address(inst), 1, buyer), "c-1"); // commission is id-keyed, holder-agnostic
    }

    // ── Negative paths: authoring guards ────────────────────────────────────────

    function test_publishWave_emptyURI_reverts() public {
        vm.prank(artist);
        vm.expectRevert(MetadataOverlayModule.EmptyURI.selector);
        ov.publishWave(
            address(inst), "", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
    }

    function test_setCommission_emptyURI_reverts() public {
        vm.prank(artist);
        vm.expectRevert(MetadataOverlayModule.EmptyURI.selector);
        ov.setCommission(
            address(inst), 1, "", MetadataOverlayModule.CommCond.NONE, 0, MetadataOverlayModule.Payout.ARTIST
        );
    }

    function test_setAutoLatest_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(MetadataOverlayModule.NotInstanceOwner.selector);
        ov.setAutoLatest(address(inst), true);
    }

    function test_select_invalidWavePointer_reverts() public {
        inst.setTokenOwner(1, holder);
        // no waves published → any wave pointer (>=3) is out of range
        vm.prank(holder);
        vm.expectRevert(MetadataOverlayModule.InvalidSelection.selector);
        ov.select(address(inst), 1, 3);
    }

    // ── Negative paths: commission unlock ───────────────────────────────────────

    function test_unlock_noCommission_reverts() public {
        inst.setTokenOwner(1, holder);
        vm.deal(holder, 1 ether);
        vm.prank(holder);
        vm.expectRevert(MetadataOverlayModule.NoCommission.selector);
        ov.unlock{ value: 0 }(address(inst), 1);
    }

    function test_unlock_freeCommission_reverts() public {
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "free", MetadataOverlayModule.CommCond.NONE, 0, MetadataOverlayModule.Payout.ARTIST
        );
        vm.prank(holder);
        vm.expectRevert(MetadataOverlayModule.NotPayCommission.selector); // free commissions need no unlock
        ov.unlock{ value: 0 }(address(inst), 1);
    }

    function test_unlock_nonHolder_reverts() public {
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c", MetadataOverlayModule.CommCond.PAY, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        vm.expectRevert(MetadataOverlayModule.NotHolder.selector);
        ov.unlock{ value: 1 ether }(address(inst), 1);
    }

    /// @dev SPLIT conservation: a zero treasury (codebase-tolerated) folds the protocol cut into the
    ///      artist payout — the module strands no ETH.
    function test_unlock_split_zeroTreasuryFoldsToArtist() public {
        MockSplitVault vault = new MockSplitVault();
        inst.setVault(address(vault));
        inst.setTreasury(address(0)); // no treasury
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c", MetadataOverlayModule.CommCond.PAY, 100, MetadataOverlayModule.Payout.SPLIT
        );
        vm.deal(holder, 100);
        uint256 artistBefore = artist.balance;
        vm.prank(holder);
        ov.unlock{ value: 100 }(address(inst), 1);
        // protocol(1) folds into artist(80) → 81; vault still 19. Module holds nothing.
        assertEq(vault.received(), 19);
        assertEq(artist.balance, artistBefore + 81);
        assertEq(address(ov).balance, 0);
    }

    /// @dev SPLIT conservation: a zero vault folds the vault cut into the artist payout.
    function test_unlock_split_zeroVaultFoldsToArtist() public {
        inst.setVault(address(0)); // no vault (default)
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c", MetadataOverlayModule.CommCond.PAY, 100, MetadataOverlayModule.Payout.SPLIT
        );
        vm.deal(holder, 100);
        uint256 artistBefore = artist.balance;
        uint256 treasuryBefore = treasury.balance;
        vm.prank(holder);
        ov.unlock{ value: 100 }(address(inst), 1);
        // vault(19) folds into artist(80) → 99; protocol(1) to treasury. Module holds nothing.
        assertEq(treasury.balance, treasuryBefore + 1);
        assertEq(artist.balance, artistBefore + 99);
        assertEq(address(ov).balance, 0);
    }

    // ── noesis-392: a registered vault that reverts must not brick the unlock ────
    // The SPLIT tithe leg feeds a registered vault via receiveContribution. A registered, healthy vault
    // can still revert — on a sub-minimum contribution, or with a full conversion-participant cap. The
    // guard isolates that revert and folds the tithe into the artist payout, so the holder's unlock always
    // completes and the payment is conserved. RevertingSplitVault reproduces both reverts.

    /// @dev Trigger 1: a SPLIT price low enough that the 19% tithe falls below the vault's minimum
    ///      contribution. The vault reverts; the tithe folds to the artist and the unlock still completes.
    function test_unlock_split_belowMinimumTithe_foldsToArtistNotBricks() public {
        RevertingSplitVault vault = new RevertingSplitVault();
        inst.setVault(address(vault));
        inst.setTokenOwner(1, holder);

        // price = 0.005 ETH → vaultCut = 19% = 0.00095 ETH < MIN_CONTRIBUTION (0.001 ETH) → vault reverts.
        uint256 price = 0.005 ether;
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c", MetadataOverlayModule.CommCond.PAY, price, MetadataOverlayModule.Payout.SPLIT
        );

        uint256 expProtocol = price / 100; // 1%
        uint256 expVault = price * 19 / 100; // 19% (would-be tithe, now folded)
        uint256 expRemainder = price - expProtocol - expVault; // 80%

        vm.deal(holder, price);
        uint256 artistBefore = artist.balance;
        uint256 treasuryBefore = treasury.balance;
        vm.prank(holder);
        ov.unlock{ value: price }(address(inst), 1); // must NOT revert

        assertTrue(ov.paid(address(inst), 1), "unlock completed and pinned");
        assertEq(vault.received(), 0, "reverting vault received nothing");
        assertEq(treasury.balance, treasuryBefore + expProtocol, "protocol leg unchanged");
        assertEq(artist.balance, artistBefore + expRemainder + expVault, "vault tithe folded into artist payout");
        assertEq(address(ov).balance, 0, "module strands nothing");
    }

    /// @dev Trigger 2: a healthy, registered vault with a full conversion-participant cap reverts every
    ///      contribution. The tithe folds to the artist; the unlock is not bricked. Above-minimum price so
    ///      only the cap (not the minimum) drives the revert.
    function test_unlock_split_participantCapReverts_foldsToArtistNotBricks() public {
        RevertingSplitVault vault = new RevertingSplitVault();
        vault.setCapReached(true); // conversion-participant cap full → every receiveContribution reverts
        inst.setVault(address(vault));
        inst.setTokenOwner(1, holder);

        uint256 price = 1 ether;
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c", MetadataOverlayModule.CommCond.PAY, price, MetadataOverlayModule.Payout.SPLIT
        );

        uint256 expProtocol = price / 100;
        uint256 expVault = price * 19 / 100;
        uint256 expRemainder = price - expProtocol - expVault;

        vm.deal(holder, price);
        uint256 artistBefore = artist.balance;
        uint256 treasuryBefore = treasury.balance;
        vm.prank(holder);
        ov.unlock{ value: price }(address(inst), 1); // must NOT revert

        assertTrue(ov.paid(address(inst), 1), "unlock completed and pinned");
        assertEq(vault.received(), 0, "capped vault received nothing");
        assertEq(treasury.balance, treasuryBefore + expProtocol, "protocol leg unchanged");
        assertEq(artist.balance, artistBefore + expRemainder + expVault, "vault tithe folded into artist payout");
        assertEq(address(ov).balance, 0, "module strands nothing");
    }

    /// @dev The wave SPLIT path shares the same `_route` leg — a reverting registered vault must not brick
    ///      a paid wave unlock either.
    function test_unlockWave_split_revertingVault_foldsToArtistNotBricks() public {
        RevertingSplitVault vault = new RevertingSplitVault();
        vault.setCapReached(true);
        inst.setVault(address(vault));
        inst.setTokenOwner(2, holder);

        uint256 price = 1 ether;
        vm.prank(artist);
        uint256 w = ov.publishWave(
            address(inst), "pw-", MetadataOverlayModule.WaveCond.PAY, 0, price, MetadataOverlayModule.Payout.SPLIT
        );

        uint256 expProtocol = price / 100;
        uint256 expVault = price * 19 / 100;
        uint256 expRemainder = price - expProtocol - expVault;

        vm.deal(holder, price);
        uint256 artistBefore = artist.balance;
        uint256 treasuryBefore = treasury.balance;
        vm.prank(holder);
        ov.unlockWave{ value: price }(address(inst), 2, w); // must NOT revert

        assertTrue(ov.wavePaid(address(inst), 2, w), "wave unlock completed and pinned");
        assertEq(vault.received(), 0, "reverting vault received nothing");
        assertEq(treasury.balance, treasuryBefore + expProtocol, "protocol leg unchanged");
        assertEq(artist.balance, artistBefore + expRemainder + expVault, "vault tithe folded into artist payout");
        assertEq(address(ov).balance, 0, "module strands nothing");
    }

    // ── Negative paths: wave unlock (was entirely untested) ─────────────────────

    function test_unlockWave_paysAndPins() public {
        inst.setTokenOwner(2, holder);
        vm.prank(artist);
        uint256 w = ov.publishWave(
            address(inst), "pw-", MetadataOverlayModule.WaveCond.PAY, 0, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );
        vm.deal(holder, 1 ether);
        uint256 artistBefore = artist.balance;
        vm.prank(holder);
        ov.unlockWave{ value: 1 ether }(address(inst), 2, w);
        assertTrue(ov.wavePaid(address(inst), 2, w));
        assertEq(ov.selection(address(inst), 2), w + 3);
        assertEq(artist.balance, artistBefore + 1 ether);
        assertEq(ov.resolve(address(inst), 2, holder), "pw-2");
    }

    function test_unlockWave_nonPayWave_reverts() public {
        inst.setTokenOwner(2, holder);
        vm.prank(artist);
        uint256 w = ov.publishWave(
            address(inst), "nw-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        vm.prank(holder);
        vm.expectRevert(MetadataOverlayModule.NotPayWave.selector);
        ov.unlockWave{ value: 0 }(address(inst), 2, w);
    }

    function test_unlockWave_invalidWave_reverts() public {
        inst.setTokenOwner(2, holder);
        vm.prank(holder);
        vm.expectRevert(MetadataOverlayModule.InvalidWave.selector);
        ov.unlockWave{ value: 0 }(address(inst), 2, 0); // no waves exist
    }

    function test_unlockWave_wrongPayment_reverts() public {
        inst.setTokenOwner(2, holder);
        vm.prank(artist);
        uint256 w = ov.publishWave(
            address(inst), "pw-", MetadataOverlayModule.WaveCond.PAY, 0, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );
        vm.deal(holder, 1 ether);
        vm.prank(holder);
        vm.expectRevert(MetadataOverlayModule.WrongPayment.selector);
        ov.unlockWave{ value: 0.5 ether }(address(inst), 2, w);
    }

    function test_unlockWave_doublePay_reverts() public {
        inst.setTokenOwner(2, holder);
        vm.prank(artist);
        uint256 w = ov.publishWave(
            address(inst), "pw-", MetadataOverlayModule.WaveCond.PAY, 0, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );
        vm.deal(holder, 2 ether);
        vm.startPrank(holder);
        ov.unlockWave{ value: 1 ether }(address(inst), 2, w);
        vm.expectRevert(MetadataOverlayModule.AlreadyPaid.selector);
        ov.unlockWave{ value: 1 ether }(address(inst), 2, w);
        vm.stopPrank();
    }

    /// @dev AUTO scans newest-first and SKIPS an unpaid PAY wave, falling to the older eligible NONE
    ///      wave — the auto path never silently surfaces content the holder hasn't unlocked.
    function test_resolve_auto_skipsUnpaidPayWave() public {
        _config(true); // autoLatest
        vm.startPrank(artist);
        ov.publishWave(
            address(inst), "old-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        ); // w0
        ov.publishWave(
            address(inst), "new-", MetadataOverlayModule.WaveCond.PAY, 0, 1 ether, MetadataOverlayModule.Payout.ARTIST
        ); // w1 (newer, PAY)
        vm.stopPrank();
        inst.setTokenOwner(5, holder);
        // AUTO: newest (w1 PAY) unpaid → skipped; falls to w0 NONE.
        assertEq(ov.resolve(address(inst), 5, holder), "old-5");
    }

    /// @dev AUTO honours a STAKE wave's condition per-holder: a staker auto-sees it, a non-staker
    ///      does not (distinct from the pinned-STAKE path).
    function test_resolve_autoStakeWave_respectsStakeCondition() public {
        MockStaking staking = new MockStaking();
        inst.setStaking(address(staking));
        _config(true); // autoLatest
        vm.prank(artist);
        ov.publishWave(
            address(inst),
            "stk-",
            MetadataOverlayModule.WaveCond.STAKE,
            10 ether,
            0,
            MetadataOverlayModule.Payout.ARTIST
        );
        inst.setTokenOwner(3, holder); // selection defaults to AUTO
        assertEq(ov.resolve(address(inst), 3, holder), ""); // unstaked → AUTO finds nothing eligible
        staking.set(address(inst), holder, 10 ether);
        assertEq(ov.resolve(address(inst), 3, holder), "stk-3"); // staked → auto-shows
    }

    /// @dev A pin is sticky: once a holder pins a wave, a NEWER wave does not move them (pinned
    ///      versioning) — only re-pointing or AUTO does.
    function test_resolve_pinIsStickyAcrossNewWaves() public {
        _config(true);
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        uint256 w0 = ov.publishWave(
            address(inst), "a-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        vm.prank(holder);
        ov.select(address(inst), 1, w0 + 3); // pin w0
        // Artist drops a newer wave; the pinned holder stays on w0.
        vm.prank(artist);
        ov.publishWave(
            address(inst), "b-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        assertEq(ov.resolve(address(inst), 1, holder), "a-1");
    }

    /// @dev Transfer behaviour: STAKE eligibility re-evaluates for the new holder — the pin travels
    ///      with the id, but the stake gate is checked against whoever holds it now.
    function test_resolve_stakeWave_reevaluatesForNewHolder() public {
        MockStaking staking = new MockStaking();
        inst.setStaking(address(staking));
        vm.prank(artist);
        uint256 w = ov.publishWave(
            address(inst),
            "stk-",
            MetadataOverlayModule.WaveCond.STAKE,
            10 ether,
            0,
            MetadataOverlayModule.Payout.ARTIST
        );
        inst.setTokenOwner(2, holder);
        staking.set(address(inst), holder, 10 ether);
        vm.prank(holder);
        ov.select(address(inst), 2, w + 3); // holder pins the STAKE wave; eligible while staked
        assertEq(ov.resolve(address(inst), 2, holder), "stk-2");

        // id sold to a non-staker: pin is sticky but the STAKE gate fails for the new holder.
        address buyer = address(0xCAFE);
        inst.setTokenOwner(2, buyer);
        assertEq(ov.resolve(address(inst), 2, buyer), "");
    }

    /// @dev autoLatest is mutable policy: flipping it changes the AUTO outcome (holders keep pin control).
    function test_setAutoLatest_flipsAutoBehavior() public {
        _config(false); // auto off initially
        vm.prank(artist);
        ov.publishWave(
            address(inst), "evt-", MetadataOverlayModule.WaveCond.NONE, 0, 0, MetadataOverlayModule.Payout.ARTIST
        );
        inst.setTokenOwner(5, holder);
        assertEq(ov.resolve(address(inst), 5, holder), ""); // auto off
        vm.prank(artist);
        ov.setAutoLatest(address(inst), true);
        assertEq(ov.resolve(address(inst), 5, holder), "evt-5"); // auto on
    }

    function test_setMetadataURI_onlyModuleOwner() public {
        vm.prank(attacker);
        vm.expectRevert(Ownable.Unauthorized.selector);
        ov.setMetadataURI("x");
        // module owner is this test contract (the deployer)
        ov.setMetadataURI("data:application/json,{}");
        assertEq(ov.metadataURI(), "data:application/json,{}");
    }

    function test_commissionVisible_requiresPaidForPayCond() public {
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c-1", MetadataOverlayModule.CommCond.PAY, 1 ether, MetadataOverlayModule.Payout.ARTIST
        );
        vm.prank(holder);
        ov.select(address(inst), 1, 2); // pin COMMISSION before paying
        assertEq(ov.resolve(address(inst), 1, holder), ""); // not visible until paid
        assertFalse(ov.commissionVisible(address(inst), 1));
    }

    // ── noesis-104 §4.6: overlay PAY revenue conserves the 1/19/80 cut ──────────
    // For the cut-subject overlay PAY paths (Payout.SPLIT), every wei of the payment must leave the
    // module in exactly three legs — protocol 1% / target(vault) 19% / creator 80% (remainder-safe) —
    // that sum to the input, across fuzzed amounts. The module holds no custody, so it must strand
    // nothing. NOTE: the Payout.ARTIST path (100%→artist, P3 O1 — an OPEN product decision) is
    // deliberately NOT exercised here; its conservation is gated pending that ruling.

    /// @dev Wire a real split-receiving vault (nonzero) alongside the nonzero treasury from setUp, so
    ///      no leg folds — the three cuts land at three distinct sinks and must conserve exactly.
    function _wireSplitSinks() internal returns (MockSplitVault v) {
        v = new MockSplitVault();
        inst.setVault(address(v));
        // treasury (nonzero) is already wired in setUp; both sinks nonzero → no fold.
    }

    /// @dev Commission PAY + SPLIT conserves 1/19/80 across fuzzed amounts (remainder-safe).
    function testFuzz_unlockSplit_conserves_1_19_80(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        MockSplitVault vault = _wireSplitSinks();
        inst.setTokenOwner(1, holder);
        vm.prank(artist);
        ov.setCommission(
            address(inst), 1, "c", MetadataOverlayModule.CommCond.PAY, amount, MetadataOverlayModule.Payout.SPLIT
        );

        vm.deal(holder, amount);
        uint256 artistBefore = artist.balance;
        uint256 treasuryBefore = treasury.balance;
        vm.prank(holder);
        ov.unlock{ value: amount }(address(inst), 1);

        _assertConserved(vault, amount, artistBefore, treasuryBefore);
    }

    /// @dev Wave PAY + SPLIT conserves 1/19/80 across fuzzed amounts (the other cut-subject PAY path).
    function testFuzz_unlockWaveSplit_conserves_1_19_80(uint256 amount) public {
        amount = bound(amount, 1, 1e30);
        MockSplitVault vault = _wireSplitSinks();
        inst.setTokenOwner(2, holder);
        vm.prank(artist);
        uint256 w = ov.publishWave(
            address(inst), "pw-", MetadataOverlayModule.WaveCond.PAY, 0, amount, MetadataOverlayModule.Payout.SPLIT
        );

        vm.deal(holder, amount);
        uint256 artistBefore = artist.balance;
        uint256 treasuryBefore = treasury.balance;
        vm.prank(holder);
        ov.unlockWave{ value: amount }(address(inst), 2, w);

        _assertConserved(vault, amount, artistBefore, treasuryBefore);
    }

    /// @dev The 1/19/80 conservation invariant, shared by both cut-subject PAY paths. Expected legs use
    ///      the canonical bps formula (protocol 100bps, target 1900bps, creator = remainder) — exactly
    ///      what RevenueSplitLib.split produces, remainder-safe so no wei is lost or stranded.
    function _assertConserved(MockSplitVault vault, uint256 amount, uint256 artistBefore, uint256 treasuryBefore)
        internal
        view
    {
        uint256 expProtocol = amount * 100 / 10000; // 1%
        uint256 expTarget = amount * 1900 / 10000; // 19%
        uint256 expCreator = amount - expProtocol - expTarget; // 80%, absorbs rounding dust

        uint256 gotProtocol = treasury.balance - treasuryBefore;
        uint256 gotTarget = vault.received();
        uint256 gotCreator = artist.balance - artistBefore;

        assertEq(gotProtocol, expProtocol, "protocol leg = 1%");
        assertEq(gotTarget, expTarget, "target(vault) leg = 19%");
        assertEq(gotCreator, expCreator, "creator leg = 80% remainder-safe");
        // Conservation: the three legs sum to the input, and the module strands nothing.
        assertEq(gotProtocol + gotTarget + gotCreator, amount, "legs sum to input");
        assertEq(address(ov).balance, 0, "module holds no custody");
    }
}
