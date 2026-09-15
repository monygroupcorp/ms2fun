// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import { DeployBondEscrow } from "../../src/factories/erc404/DeployBondEscrow.sol";
import { ProtocolTreasuryV1 } from "../../src/treasury/ProtocolTreasuryV1.sol";
import { MockWETH } from "../mocks/MockWETH.sol";

/// @dev A bonding instance carrying the creator-settable surface the escrow could have been tempted to
///      anchor a deadline on — `bondingMaturityTime` above all, which on the real instance is an
///      owner-or-agent setter. `graduated` is one-way here, as it is on `ERC404BondingInstance`: a
///      creator who actually graduates is entitled to their bond back, and that is the escrow doing its
///      job rather than an escape. What must not exist is a value the creator can write that leaves the
///      bond neither refundable nor forfeitable.
contract CreatorControlledInstance {
    address public owner;
    bool public graduated;
    uint256 public bondingMaturityTime;
    uint256 public bondingOpenTime;
    bool public bondingActive;

    constructor(address _owner) {
        owner = _owner;
    }

    function setBondingMaturityTime(uint256 t) external {
        bondingMaturityTime = t;
    }

    function setBondingOpenTime(uint256 t) external {
        bondingOpenTime = t;
    }

    function setBondingActive(bool a) external {
        bondingActive = a;
    }

    /// @dev One-way, mirroring the real instance: nothing un-graduates a collection.
    function graduate() external {
        graduated = true;
    }
}

/// @dev Drives the escrow through posts, protocol re-tunings, creator writes, time, and both
///      permissionless settlement legs. Each post records the deadline the terms in force AT THAT MOMENT
///      imply (`ghost_deadlineAtPost`, derived here and not read back out of the escrow); every call
///      after it is an attempt to move that number.
contract BondDeadlineHandler is Test {
    DeployBondEscrow public immutable escrow;
    address public immutable owner;
    address public immutable factory;
    address public immutable treasury;

    CreatorControlledInstance[] public instances;
    address[] public posted;
    /// @notice instance => the forfeit deadline implied by the terms in force when its bond was posted.
    mapping(address => uint256) public ghost_deadlineAtPost;
    /// @notice instance => the bond amount escrowed, so the forfeit leg can be value-checked.
    mapping(address => uint256) public ghost_amount;

    uint256 public calls;
    /// @notice Posts that landed. Nothing below proves anything on a run that never escrowed a bond.
    uint256 public ghost_posts;
    /// @notice Protocol re-tunings of the forfeit terms that landed while some posted bond was live —
    ///         the state the second half of the invariant is about. A run with none of these is vacuous.
    uint256 public ghost_retunesUnderALiveBond;
    /// @notice Creator writes to an instance's `bondingMaturityTime` that landed while its bond was live.
    uint256 public ghost_creatorMaturityWritesUnderALiveBond;

    constructor(DeployBondEscrow _escrow, address _owner, address _factory, address _treasury) {
        escrow = _escrow;
        owner = _owner;
        factory = _factory;
        treasury = _treasury;
    }

    modifier counted() {
        calls++;
        _;
    }

    /// @dev The deadline `forfeit` will compute for `instance`, read back out of the escrow's own public
    ///      record rather than recomputed from the live setters — that distinction is the whole point.
    function deadlineOf(address instance) public view returns (uint256) {
        (,, uint40 createdAt,, uint40 maxDur, uint32 grace) = escrow.bonds(instance);
        return uint256(createdAt) + uint256(maxDur) + uint256(grace) * 1 days;
    }

    function isLive(address instance) public view returns (bool) {
        (,, uint40 createdAt, bool settled,,) = escrow.bonds(instance);
        return createdAt != 0 && !settled;
    }

    function liveCount() public view returns (uint256 n) {
        for (uint256 i = 0; i < posted.length; i++) {
            if (isLive(posted[i])) n++;
        }
    }

    function postedCount() external view returns (uint256) {
        return posted.length;
    }

    function graduatedAt(uint256 i) external view returns (bool) {
        return CreatorControlledInstance(posted[i]).graduated();
    }

    // ── Posts ────────────────────────────────────────────────────────────────

    /// @dev A fresh instance, a fresh creator, a bond posted at whatever terms stand right now. Capped
    ///      at six so the per-call sweeps in the invariants stay cheap over the default depth.
    function postBond(uint256 amountSeed) external counted {
        if (instances.length >= 6) return;
        // A run that has pushed the terms past the record's narrowing cannot post — `postBond` refuses
        // rather than truncating (`BondTermsOutOfRange`, unit-tested). Skip instead of burning the call.
        if (escrow.maxBondDuration() > type(uint40).max || escrow.graceDays() > type(uint32).max) return;

        _postFreshBond(bound(amountSeed, 1, 10 ether));
    }

    /// @dev A fresh instance, a fresh creator, a bond posted at whatever terms stand right now, and the
    ///      ghost record of the deadline those terms imply. Shared by the capped random `postBond` above
    ///      and by `creatorSetsMaturityUnderALiveBond` below, so both escrow a bond by the same path.
    function _postFreshBond(uint256 amount) internal returns (address) {
        address creator = address(uint160(uint256(keccak256(abi.encode("bondCreator", calls)))));
        CreatorControlledInstance inst = new CreatorControlledInstance(creator);
        instances.push(inst);

        // Derived INDEPENDENTLY of the escrow's record, from the live setters and the clock a moment
        // before the post: `createdAt + maxBondDuration + graceDays`. Reading it back out of the record
        // instead would compare the record with itself, and a post that snapshotted nothing at all would
        // satisfy the equality below while moving every deadline it wrote.
        uint256 expected = block.timestamp + escrow.maxBondDuration() + escrow.graceDays() * 1 days;

        vm.prank(owner);
        escrow.setBondAmount(amount);
        vm.deal(factory, amount);
        vm.prank(factory);
        escrow.postBond{ value: amount }(address(inst), creator);

        posted.push(address(inst));
        ghost_amount[address(inst)] = amount;
        ghost_deadlineAtPost[address(inst)] = expected;
        ghost_posts++;
        return address(inst);
    }

    // ── Protocol actions ─────────────────────────────────────────────────────

    function protocolSetMaxBondDuration(uint256 v) external counted {
        // Straddles the uint40 narrowing in both directions: down to zero, and past what the record can
        // hold. Neither end may reach a bond that is already posted.
        uint256 next = bound(v, 0, uint256(type(uint40).max) + 1e6);
        uint256 live = liveCount();
        vm.prank(owner);
        escrow.setMaxBondDuration(next);
        if (live > 0) ghost_retunesUnderALiveBond++;
    }

    function protocolSetGraceDays(uint256 v) external counted {
        uint256 next = bound(v, 0, uint256(type(uint32).max) + 1e3);
        uint256 live = liveCount();
        vm.prank(owner);
        escrow.setGraceDays(next);
        if (live > 0) ghost_retunesUnderALiveBond++;
    }

    function protocolSetBondAmount(uint256 v) external counted {
        vm.prank(owner);
        escrow.setBondAmount(bound(v, 0, 100 ether));
    }

    /// @dev The treasury pointer moves and comes back. `forfeit` deposits through the treasury's tagged
    ///      entry point, so leaving it on a random address would disarm the forfeit leg rather than test
    ///      it; what this exercises is that the lever exists and touches no bond.
    function protocolMovesTheTreasuryAndBack(uint256 seed) external counted {
        vm.prank(owner);
        escrow.setProtocolTreasury(address(uint160(bound(seed, 1, type(uint160).max))));
        vm.prank(owner);
        escrow.setProtocolTreasury(treasury);
    }

    // ── Creator actions ──────────────────────────────────────────────────────

    /// @dev The historic lever: an escrow that anchored its deadline on the instance's maturity would
    ///      have handed the creator its own deadline, which is why `forfeit` deliberately does not read
    ///      it. Written here with no bound at all, which is what the setter carried before #401.
    function creatorSetsMaturity(uint256 idx, uint256 t) external counted {
        if (instances.length == 0) return;
        CreatorControlledInstance inst = instances[bound(idx, 0, instances.length - 1)];
        bool live = isLive(address(inst));
        inst.setBondingMaturityTime(t);
        if (live) ghost_creatorMaturityWritesUnderALiveBond++;
    }

    /// @dev The same creator write as above, but carrying its own live bond so the coverage floor in
    ///      `invariant_theRunActuallyAttackedALiveBond` is reachable BY CONSTRUCTION rather than by a
    ///      lucky interleaving of two independent draws.
    ///
    ///      `creatorSetsMaturity` only counts when the index it happens to draw is a bond that happens
    ///      to still be live, and a run can put itself where that is impossible for good: re-tune
    ///      `maxBondDuration` to zero, warp, forfeit each bond in turn, and once the six-instance cap is
    ///      reached with nothing live, no later draw can ever count again. Such a run then fails the
    ///      guard no matter how long it continues — which is what CI hit on this branch (run
    ///      35030425281, "no creator maturity write ever landed under a live bond: 0 < 1"), and what
    ///      eight local seeds happened not to.
    ///
    ///      This call closes that hole from the handler side, leaving the invariant itself untouched:
    ///      it writes maturity on a bond that is already live, and if none is, escrows one first. The
    ///      guard still measures the walk — it is satisfied only by calls the walk actually made — but
    ///      a single draw of this selector now suffices, where before it took a coincidence.
    function creatorSetsMaturityUnderALiveBond(uint256 idx, uint256 t) external counted {
        address target;
        uint256 n = posted.length;
        if (n > 0) {
            uint256 start = bound(idx, 0, n - 1);
            for (uint256 k = 0; k < n; k++) {
                address candidate = posted[(start + k) % n];
                if (isLive(candidate)) {
                    target = candidate;
                    break;
                }
            }
        }

        if (target == address(0)) {
            // Nothing live. Post one on a slot the capped `postBond` above cannot consume, so this
            // call keeps working after the random walk has spent every instance it is allowed.
            if (instances.length >= 7) return;
            // The walk is free to push the terms past what the record can hold, and `postBond` refuses
            // outright there. Narrow them back — the owner's own lever, exercised no differently than
            // `protocolSetMaxBondDuration` does — so a bond can always be escrowed here.
            if (escrow.maxBondDuration() > type(uint40).max) {
                vm.prank(owner);
                escrow.setMaxBondDuration(180 days);
            }
            if (escrow.graceDays() > type(uint32).max) {
                vm.prank(owner);
                escrow.setGraceDays(30);
            }
            target = _postFreshBond(bound(t, 1, 10 ether));
        }

        CreatorControlledInstance(target).setBondingMaturityTime(t);
        ghost_creatorMaturityWritesUnderALiveBond++;
    }

    function creatorSetsOpenTime(uint256 idx, uint256 t) external counted {
        if (instances.length == 0) return;
        instances[bound(idx, 0, instances.length - 1)].setBondingOpenTime(t);
    }

    function creatorSetsActive(uint256 idx, bool a) external counted {
        if (instances.length == 0) return;
        instances[bound(idx, 0, instances.length - 1)].setBondingActive(a);
    }

    function creatorGraduates(uint256 idx) external counted {
        if (instances.length == 0) return;
        instances[bound(idx, 0, instances.length - 1)].graduate();
    }

    // ── Time ─────────────────────────────────────────────────────────────────

    function warp(uint256 dt) external counted {
        vm.warp(block.timestamp + bound(dt, 1, 90 days));
    }

    // ── Settlement ───────────────────────────────────────────────────────────

    function refund(uint256 idx) external counted {
        if (posted.length == 0) return;
        try escrow.refund(posted[bound(idx, 0, posted.length - 1)]) { } catch { }
    }

    function forfeit(uint256 idx) external counted {
        if (posted.length == 0) return;
        try escrow.forfeit(posted[bound(idx, 0, posted.length - 1)]) { } catch { }
    }
}

/**
 * @title  DeployBondDeadlineInvariant
 * @notice The escrowed-bond invariant in the words of the question it answers: NO creator-settable
 *         value can make a posted bond unforfeitable, and NO protocol action can move an
 *         already-posted bond's deadline in either direction.
 *
 *         `DeployBondEscrow` states this as a design property — the forfeit terms are snapshotted onto
 *         the bond at post, and `forfeit` reads nothing else — and the unit suite checks it one setter
 *         at a time. This file checks it over the reachable state space: after any interleaving of
 *         posts, protocol re-tunings (in both directions, and past the uint40/uint32 narrowing the
 *         record uses), treasury moves, creator writes to `bondingMaturityTime` / `bondingOpenTime` /
 *         `bondingActive`, graduation, time, and both permissionless settlement legs, the deadline each
 *         bond is judged against is still the one its own post implied, and reaching that deadline is
 *         still exactly what makes it forfeitable.
 *
 *         VACUITY ([[vacuity-check]]): the last two invariants are the coverage floor. A run that never
 *         posted a bond, or never landed a protocol re-tuning and a creator maturity write while a bond
 *         was live, has exercised nothing, and fails here rather than reporting green.
 */
contract DeployBondDeadlineInvariantTest is StdInvariant, Test {
    DeployBondEscrow internal escrow;
    ProtocolTreasuryV1 internal treasury;
    MockWETH internal weth;
    BondDeadlineHandler internal handler;

    address internal owner = makeAddr("bondEscrowOwner");
    address internal factory = makeAddr("erc404Factory");
    address internal stranger = makeAddr("anyStranger");

    /// @dev Call counts the two coverage invariants wait for. The walk picks uniformly from 14
    ///      selectors, so a post is overwhelmingly certain well inside 200 calls, and the paired attack
    ///      state well inside 300 because one of those selectors —
    ///      `creatorSetsMaturityUnderALiveBond` — reaches it on its own rather than needing two draws
    ///      to coincide. Below the threshold they say nothing, so a shrunk replay of some other
    ///      failure — a handful of calls long — stays readable instead of failing here.
    uint256 internal constant COVERAGE_POSTS_AFTER = 200;
    uint256 internal constant COVERAGE_ATTACK_AFTER = 300;

    function setUp() public {
        ProtocolTreasuryV1 impl = new ProtocolTreasuryV1();
        bytes memory initData = abi.encodeWithSelector(ProtocolTreasuryV1.initialize.selector, owner);
        treasury = ProtocolTreasuryV1(payable(address(new ERC1967Proxy(address(impl), initData))));

        weth = new MockWETH();
        escrow = new DeployBondEscrow(owner, factory, address(treasury), address(weth));

        // Start clear of the epoch: deadlines here are `createdAt + up to ~210 days` and the probe warps
        // across them, and a walk beginning at timestamp 1 would read as if every bond were posted then.
        vm.warp(365 days);

        handler = new BondDeadlineHandler(escrow, owner, factory, address(treasury));

        bytes4[] memory selectors = new bytes4[](14);
        selectors[0] = handler.postBond.selector;
        selectors[1] = handler.protocolSetMaxBondDuration.selector;
        selectors[2] = handler.protocolSetGraceDays.selector;
        selectors[3] = handler.protocolSetBondAmount.selector;
        selectors[4] = handler.protocolMovesTheTreasuryAndBack.selector;
        selectors[5] = handler.creatorSetsMaturity.selector;
        selectors[6] = handler.creatorSetsOpenTime.selector;
        selectors[7] = handler.creatorSetsActive.selector;
        selectors[8] = handler.creatorGraduates.selector;
        selectors[9] = handler.warp.selector;
        selectors[10] = handler.refund.selector;
        selectors[11] = handler.forfeit.selector;
        selectors[12] = handler.postBond.selector; // weighted: every other action needs a bond to act on
        selectors[13] = handler.creatorSetsMaturityUnderALiveBond.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
        targetContract(address(handler));
    }

    /// @dev THE deadline invariant, on the record. For every bond ever posted — live or settled — the
    ///      deadline the escrow's record implies is EXACTLY the one the terms in force at its post
    ///      implied, re-derived in the handler from the live setters and the clock at that moment. An
    ///      equality and not a bound: a protocol re-tuning that SHORTENED a deadline is as much a
    ///      violation as one that extended it, and a creator write that moved it by a second fails here
    ///      as loudly as one that moved it by a decade.
    ///
    ///      Necessary and not sufficient on its own — it says what the record holds, not what `forfeit`
    ///      enforces. The probe below is what ties the two together, and the pair is what makes the file
    ///      non-vacuous from both sides: measured on this tree, re-pointing `forfeit` at the live
    ///      setters leaves this one green and fails the probe, while a post that snapshotted nothing
    ///      would leave the probe green and fail this one.
    function invariant_postedDeadlineNeverMoves() public view {
        uint256 n = handler.postedCount();
        for (uint256 i = 0; i < n; i++) {
            address inst = handler.posted(i);
            assertEq(
                handler.deadlineOf(inst),
                handler.ghost_deadlineAtPost(inst),
                "deploy bond: an already-posted bond's forfeit deadline moved"
            );
        }
    }

    /// @dev The other half, and the one that has to actually run the call: reaching the recorded
    ///      deadline is SUFFICIENT to forfeit an ungraduated bond, and reaching it is NECESSARY.
    ///      Probed on a state snapshot so the random walk is not disturbed — one live bond per call,
    ///      rotating on the handler's call counter, which over the default depth sweeps them all.
    ///
    ///      `forfeit` is permissionless, so the probe calls it from an address with no relationship to
    ///      the bond at all: "unforfeitable" would mean this call failing at some time past the
    ///      deadline, by any cause, and here it is asserted to succeed and to move the whole bond.
    function invariant_reachingTheRecordedDeadlineIsExactlyWhatForfeitsIt() public {
        uint256 n = handler.postedCount();
        if (n == 0) return;

        address target;
        for (uint256 k = 0; k < n; k++) {
            uint256 i = (handler.calls() + k) % n;
            if (handler.isLive(handler.posted(i)) && !handler.graduatedAt(i)) {
                target = handler.posted(i);
                break;
            }
        }
        if (target == address(0)) return;

        uint256 deadline = handler.ghost_deadlineAtPost(target);
        uint256 wasAt = block.timestamp;
        uint256 snap = vm.snapshotState();

        // NECESSARY: at the deadline itself — not a second before it — the escrow still refuses.
        vm.warp(deadline);
        vm.prank(stranger);
        vm.expectRevert(DeployBondEscrow.NotYetForfeitable.selector);
        escrow.forfeit(target);

        // SUFFICIENT: one second later any caller can forfeit it, whatever the creator has written on
        // the instance and whatever the protocol has since done to the terms.
        vm.warp(deadline + 1);
        uint256 treasuryBefore = address(treasury).balance;
        vm.prank(stranger);
        escrow.forfeit(target);
        assertEq(
            address(treasury).balance - treasuryBefore,
            handler.ghost_amount(target),
            "deploy bond: forfeit past the deadline did not deliver the escrowed amount to the treasury"
        );

        vm.revertToState(snap);
        vm.warp(wasAt); // the snapshot restores journaled state, not the block environment
    }

    /// @dev COVERAGE, not belief (i): the walk actually escrowed bonds.
    function invariant_theRunActuallyPostedBonds() public view {
        if (handler.calls() < COVERAGE_POSTS_AFTER) return;
        assertGe(handler.ghost_posts(), 1, "deploy bond: this run never posted a bond, so it proved nothing");
    }

    /// @dev COVERAGE, not belief (ii): the walk reached the state the invariant is about — the protocol
    ///      re-tuned the forfeit terms while a bond was live, and a creator wrote its instance's
    ///      maturity while its own bond was live. Without both, the equality above is satisfied by a
    ///      state that nothing ever tried to move.
    function invariant_theRunActuallyAttackedALiveBond() public view {
        if (handler.calls() < COVERAGE_ATTACK_AFTER) return;
        assertGe(
            handler.ghost_retunesUnderALiveBond(), 1, "deploy bond: no protocol re-tuning ever landed under a live bond"
        );
        assertGe(
            handler.ghost_creatorMaturityWritesUnderALiveBond(),
            1,
            "deploy bond: no creator maturity write ever landed under a live bond"
        );
    }
}
