// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Ownable } from "solady/auth/Ownable.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { LibString } from "solady/utils/LibString.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IMetadataResolver } from "./IMetadataResolver.sol";
import { IMasterRegistry } from "../master/interfaces/IMasterRegistry.sol";
import { IAlignmentVault } from "../interfaces/IAlignmentVault.sol";
import { RevenueSplitLib } from "../shared/libraries/RevenueSplitLib.sol";

/// @dev Reads + holder-auth the overlay needs off an ERC404 instance.
interface IOverlayInstance {
    function owner() external view returns (address);
    function ownerOf(uint256 id) external view returns (address); // the new seam getter
    function protocolTreasury() external view returns (address);
    function vault() external view returns (address);
    function stakingModule() external view returns (address);
}

/// @dev The staking singleton's public `stakedBalance` mapping.
interface IOverlayStakedReader {
    function stakedBalance(address instance, address holder) external view returns (uint256);
}

/// @title MetadataOverlayModule
/// @notice Artist-driven augmentation served *over* the ERC404 base (ADR-0006). Two flows behind one
///         `IMetadataResolver`: per-id commissions (pay-the-artist or free) and cohort event waves,
///         holder-selectable via a version pointer. Content is mutable-forever but ADDITIVE — published
///         waves are append-only and a commission locks once paid (buyer protection). Base is never
///         replaced: a holder can always pin BASE (return "") to fall through to the lower stack/base.
/// @dev Singleton keyed by instance, holds no custody — ETH only flows through. Selection pointer:
///      0=AUTO, 1=BASE, 2=COMMISSION, >=3 → wave index (ptr-3).
contract MetadataOverlayModule is IMetadataResolver, Ownable, ReentrancyGuard {
    using RevenueSplitLib for uint256;

    error NotRegisteredFactory();
    error AlreadyConfigured();
    error InvalidAddress();
    error NotInstanceOwner();
    error NotHolder();
    error EmptyURI();
    error CommissionLocked(); // setCommission after paid
    error NotPayCommission();
    error NotPayWave();
    error AlreadyPaid();
    error NoCommission();
    error InvalidWave();
    error WrongPayment();
    error InvalidSelection();

    // ── Pointer encoding ────────────────────────────────────────────────────────
    uint256 internal constant AUTO = 0;
    uint256 internal constant BASE = 1;
    uint256 internal constant COMMISSION = 2;
    uint256 internal constant WAVE_OFFSET = 3;

    enum WaveCond {
        NONE, // event-wave gate, per wave
        STAKE,
        PAY
    }
    enum CommCond {
        NONE, // commission gate (STAKE makes no sense per-id)
        PAY
    }
    enum Payout {
        ARTIST, // where PAY money goes (STAKERS deferred)
        SPLIT
    }

    struct Terms {
        CommCond cond;
        uint256 price;
        Payout payout;
    }

    struct Wave {
        string baseURI;
        WaveCond cond;
        uint256 threshold;
        uint256 price;
        Payout payout;
    }

    IMasterRegistry public immutable masterRegistry;

    // kind A — commission (bespoke per-id string)
    mapping(address => mapping(uint256 => string)) public commissionURI;
    mapping(address => mapping(uint256 => Terms)) public commissionTerms;
    mapping(address => mapping(uint256 => bool)) public paid; // PAY commission settled

    // kind B — event waves (append-only); a token's event art is wave.baseURI + id
    mapping(address => Wave[]) public waves;

    // holder selection — version pointer, default 0 = AUTO
    mapping(address => mapping(uint256 => uint256)) public selection;
    mapping(address => mapping(uint256 => mapping(uint256 => bool))) public wavePaid; // per id per wave

    // collection config (initConfig set-once; autoLatest mutable thereafter)
    mapping(address => bool) public configured;
    mapping(address => bool) public autoLatest;
    mapping(address => Payout) public defaultPayout;

    string private _metadataURI;

    event WavePublished(address indexed instance, uint256 wIdx);
    event CommissionSet(address indexed instance, uint256 indexed id);
    event Unlocked(address indexed instance, uint256 indexed id, address who, uint8 kind); // 0=commission,1=wave
    event SelectionChanged(address indexed instance, uint256 indexed id, uint256 ptr);
    event AutoLatestSet(address indexed instance, bool autoLatest);
    event OverlayConfigured(address indexed instance, bool autoLatest, Payout defaultPayout);

    constructor(address _masterRegistry) {
        if (_masterRegistry == address(0)) revert InvalidAddress();
        masterRegistry = IMasterRegistry(_masterRegistry);
        _initializeOwner(msg.sender);
    }

    // ── Auth helpers ──────────────────────────────────────────────────────────

    function _onlyInstanceOwner(address inst) internal view {
        if (msg.sender != IOverlayInstance(inst).owner()) revert NotInstanceOwner();
    }

    /// @dev Holder auth via the seam getter — reverts on unminted id (can't act on a nonexistent token).
    function _onlyHolder(address inst, uint256 id) internal view {
        if (msg.sender != IOverlayInstance(inst).ownerOf(id)) revert NotHolder();
    }

    // ── Factory wiring (set-once) ───────────────────────────────────────────────

    /// @notice Seed initial collection config. Registered-factory-only, set-once. `autoLatest`
    ///         stays owner-mutable afterward (it is policy, not mechanism — holders keep pin control).
    function initConfig(address inst, bool autoLatest_, Payout defaultPayout_) external {
        // Least privilege (D1): only the factory that registered THIS instance may seed its config,
        // not any registered factory.
        if (masterRegistry.getInstanceInfo(inst).factory != msg.sender) revert NotRegisteredFactory();
        if (configured[inst]) revert AlreadyConfigured();
        configured[inst] = true;
        autoLatest[inst] = autoLatest_;
        defaultPayout[inst] = defaultPayout_;
        emit OverlayConfigured(inst, autoLatest_, defaultPayout_);
    }

    // ── Artist writes (owner of the instance) ───────────────────────────────────

    /// @notice Update collection auto-latest policy. Owner-mutable (H8) — safe: holders always retain pin.
    function setAutoLatest(address inst, bool v) external {
        _onlyInstanceOwner(inst);
        autoLatest[inst] = v;
        emit AutoLatestSet(inst, v);
    }

    /// @notice Append an event wave (append-only — no edit; published terms are immutable).
    function publishWave(
        address inst,
        string calldata baseURI,
        WaveCond cond,
        uint256 threshold,
        uint256 price,
        Payout payout
    ) external returns (uint256 wIdx) {
        _onlyInstanceOwner(inst);
        if (bytes(baseURI).length == 0) revert EmptyURI();
        waves[inst].push(Wave({ baseURI: baseURI, cond: cond, threshold: threshold, price: price, payout: payout }));
        wIdx = waves[inst].length - 1;
        emit WavePublished(inst, wIdx);
    }

    /// @notice Set/replace the per-id commission. Reverts once paid (buyer protection); free (NONE)
    ///         commissions stay mutable. One slot per id.
    function setCommission(address inst, uint256 id, string calldata uri, CommCond cond, uint256 price, Payout payout)
        external
    {
        _onlyInstanceOwner(inst);
        if (paid[inst][id]) revert CommissionLocked();
        if (bytes(uri).length == 0) revert EmptyURI();
        commissionURI[inst][id] = uri;
        commissionTerms[inst][id] = Terms({ cond: cond, price: price, payout: payout });
        emit CommissionSet(inst, id);
    }

    // ── Holder writes (NFT owner) ───────────────────────────────────────────────

    /// @notice Pin a version. ptr: 0=AUTO, 1=BASE, 2=COMMISSION, >=3 → wave index (ptr-3).
    function select(address inst, uint256 id, uint256 ptr) external {
        _onlyHolder(inst, id);
        if (ptr >= WAVE_OFFSET && ptr - WAVE_OFFSET >= waves[inst].length) revert InvalidSelection();
        selection[inst][id] = ptr;
        emit SelectionChanged(inst, id, ptr);
    }

    /// @notice Pay for a PAY commission and pin it in the same tx. CEI + nonReentrant.
    function unlock(address inst, uint256 id) external payable nonReentrant {
        _onlyHolder(inst, id);
        Terms memory t = commissionTerms[inst][id];
        if (bytes(commissionURI[inst][id]).length == 0) revert NoCommission();
        if (t.cond != CommCond.PAY) revert NotPayCommission();
        if (paid[inst][id]) revert AlreadyPaid();
        if (msg.value != t.price) revert WrongPayment();

        // Effects before value transfer (CEI)
        paid[inst][id] = true;
        selection[inst][id] = COMMISSION;
        emit Unlocked(inst, id, msg.sender, 0);
        emit SelectionChanged(inst, id, COMMISSION);

        _route(inst, t.price, t.payout);
    }

    /// @notice Pay for a PAY wave (per id) and pin it in the same tx. CEI + nonReentrant.
    function unlockWave(address inst, uint256 id, uint256 w) external payable nonReentrant {
        _onlyHolder(inst, id);
        if (w >= waves[inst].length) revert InvalidWave();
        Wave memory wv = waves[inst][w];
        if (wv.cond != WaveCond.PAY) revert NotPayWave();
        if (wavePaid[inst][id][w]) revert AlreadyPaid();
        if (msg.value != wv.price) revert WrongPayment();

        // Effects before value transfer (CEI)
        wavePaid[inst][id][w] = true;
        uint256 ptr = w + WAVE_OFFSET;
        selection[inst][id] = ptr;
        emit Unlocked(inst, id, msg.sender, 1);
        emit SelectionChanged(inst, id, ptr);

        _route(inst, wv.price, wv.payout);
    }

    // ── Payment routing ─────────────────────────────────────────────────────────

    function _route(address inst, uint256 price, Payout payout) internal {
        if (price == 0) return;
        address artist = IOverlayInstance(inst).owner();
        if (payout == Payout.ARTIST) {
            SafeTransferLib.safeTransferETH(artist, price);
            return;
        }
        // SPLIT — 1% protocol / 19% vault / 80% artist (canonical graduation split). The module holds
        // no custody, so EVERY wei of `price` must leave in this call: a leg whose destination is
        // address(0) (the codebase tolerates a zero treasury) folds into the artist payout rather than
        // stranding ETH in the module forever.
        RevenueSplitLib.Split memory s = price.split();
        address treasury = IOverlayInstance(inst).protocolTreasury();
        address vault = IOverlayInstance(inst).vault();
        uint256 toArtist = s.remainder;
        if (s.protocolCut > 0) {
            if (treasury != address(0)) SafeTransferLib.safeTransferETH(treasury, s.protocolCut);
            else toArtist += s.protocolCut;
        }
        if (s.vaultCut > 0) {
            if (vault != address(0)) {
                // credit the contribution to the instance as benefactor (graduation path)
                IAlignmentVault(payable(vault)).receiveContribution{ value: s.vaultCut }(
                    Currency.wrap(address(0)), s.vaultCut, inst
                );
            } else {
                toArtist += s.vaultCut;
            }
        }
        if (toArtist > 0) SafeTransferLib.safeTransferETH(artist, toArtist);
    }

    // ── Resolution (IMetadataResolver) ──────────────────────────────────────────

    /// @inheritdoc IMetadataResolver
    function resolve(address inst, uint256 id, address holder) external view override returns (string memory) {
        uint256 sel = selection[inst][id];

        if (sel == BASE) return ""; // decline overlay → lower stack/base
        if (sel == COMMISSION) {
            return _commissionVisible(inst, id) ? commissionURI[inst][id] : "";
        }
        if (sel >= WAVE_OFFSET) {
            uint256 w = sel - WAVE_OFFSET;
            if (w >= waves[inst].length) return ""; // defensive
            if (_waveEligible(inst, id, w, holder)) {
                return string.concat(waves[inst][w].baseURI, LibString.toString(id));
            }
            return "";
        }
        // AUTO — newest eligible wave if collection policy allows
        if (!autoLatest[inst]) return "";
        return _newestEligibleWave(inst, id, holder);
    }

    // ── Eligibility (public views for indexer / UI) ─────────────────────────────

    function commissionVisible(address inst, uint256 id) external view returns (bool) {
        return _commissionVisible(inst, id);
    }

    function waveEligible(address inst, uint256 id, uint256 w, address holder) external view returns (bool) {
        if (w >= waves[inst].length) return false;
        return _waveEligible(inst, id, w, holder);
    }

    function waveCount(address inst) external view returns (uint256) {
        return waves[inst].length;
    }

    // ── Internal eligibility ────────────────────────────────────────────────────

    function _commissionVisible(address inst, uint256 id) internal view returns (bool) {
        if (bytes(commissionURI[inst][id]).length == 0) return false;
        CommCond c = commissionTerms[inst][id].cond;
        return c == CommCond.NONE || (c == CommCond.PAY && paid[inst][id]);
    }

    /// @dev Per-wave Condition is the only gate (H2: AUTO is NOT blanket-staked-gated).
    function _waveEligible(address inst, uint256 id, uint256 w, address holder) internal view returns (bool) {
        Wave storage wv = waves[inst][w];
        if (wv.cond == WaveCond.NONE) return true;
        if (wv.cond == WaveCond.STAKE) return _stakedOf(inst, holder) >= wv.threshold;
        // PAY
        return wavePaid[inst][id][w];
    }

    /// @dev Scan waves from the newest; return the first the holder qualifies for (its art), else "".
    function _newestEligibleWave(address inst, uint256 id, address holder) internal view returns (string memory) {
        Wave[] storage ws = waves[inst];
        uint256 len = ws.length;
        for (uint256 i = len; i > 0; --i) {
            uint256 w = i - 1;
            if (_waveEligible(inst, id, w, holder)) {
                return string.concat(ws[w].baseURI, LibString.toString(id));
            }
        }
        return "";
    }

    function _stakedOf(address inst, address holder) internal view returns (uint256) {
        address sm = IOverlayInstance(inst).stakingModule();
        if (sm == address(0)) return 0;
        return IOverlayStakedReader(sm).stakedBalance(inst, holder);
    }

    // ── IComponentModule self-description (wizard) ──────────────────────────────

    function metadataURI() external view override returns (string memory) {
        return _metadataURI;
    }

    function setMetadataURI(string calldata uri) external override onlyOwner {
        _metadataURI = uri;
        emit MetadataURIUpdated(uri);
    }
}
