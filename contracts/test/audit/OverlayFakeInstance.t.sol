// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { MetadataOverlayModule } from "../../src/metadata/MetadataOverlayModule.sol";
import { MockMasterRegistry } from "../mocks/MockMasterRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";

/// @dev A wholly attacker-authored "instance". Every authority the overlay module asks about is
///      answered here — that is finding H's premise, and it is true.
contract FakeInstance {
    address public owner;
    address public vault;
    address public protocolTreasury;
    address public stakingModule;
    address public holder;

    constructor(address _owner, address _vault, address _treasury, address _holder) {
        owner = _owner;
        vault = _vault;
        protocolTreasury = _treasury;
        holder = _holder;
    }

    function ownerOf(uint256) external view returns (address) {
        return holder;
    }
}

/// @dev A registered vault that books whatever it is handed, like the real ones.
contract SpyVault {
    mapping(address => uint256) public credited;
    uint256 public totalIn;

    function receiveContribution(Currency, uint256 amount, address benefactor) external payable {
        require(msg.value == amount, "amount");
        credited[benefactor] += amount;
        totalIn += amount;
    }

    receive() external payable { }
}

/// @notice Finding H — `_onlyInstanceOwner`/`_onlyHolder` resolve authority through a caller-supplied
///         `inst`. This test does NOT assume the "namespaced state, value conserved" mitigation; it
///         drives the attack and measures the result.
contract OverlayFakeInstanceTest is Test {
    MetadataOverlayModule internal overlay;
    MockMasterRegistry internal registry;
    SpyVault internal realVault;
    FakeInstance internal fake;
    FakeInstance internal honest;

    address internal attacker = address(0xBAD);
    address internal artist = address(0xA11CE);
    address internal treasury = address(0xFEE);

    function setUp() public {
        registry = new MockMasterRegistry();
        overlay = new MetadataOverlayModule(address(registry));
        realVault = new SpyVault();
        registry.setVaultRegistered(address(realVault), true);

        // Attacker-authored instance naming the REAL registered vault and the REAL treasury.
        fake = new FakeInstance(attacker, address(realVault), treasury, attacker);
        honest = new FakeInstance(artist, address(realVault), treasury, artist);
    }

    /// @dev 1. The auth bypass is real: a fake instance drives every artist write.
    function test_H1_fakeInstanceDrivesArtistWrites() public {
        vm.startPrank(attacker);
        overlay.publishWave(
            address(fake),
            "ipfs://fake/",
            MetadataOverlayModule.WaveCond.PAY,
            0,
            1 ether,
            MetadataOverlayModule.Payout.SPLIT
        );
        overlay.setCommission(
            address(fake),
            1,
            "ipfs://fakecomm",
            MetadataOverlayModule.CommCond.PAY,
            1 ether,
            MetadataOverlayModule.Payout.SPLIT
        );
        overlay.setAutoLatest(address(fake), true);
        vm.stopPrank();
        assertEq(overlay.waveCount(address(fake)), 1, "a fake instance published a wave");
    }

    /// @dev 2. The claimed mitigation, TESTED: the fake's writes never touch another instance's state.
    function test_H2_stateIsNamespacedSoNoRealInstanceIsTouched() public {
        vm.prank(attacker);
        overlay.publishWave(
            address(fake),
            "ipfs://fake/",
            MetadataOverlayModule.WaveCond.PAY,
            0,
            1 ether,
            MetadataOverlayModule.Payout.SPLIT
        );
        assertEq(overlay.waveCount(address(fake)), 1, "fake's own namespace grew");
        assertEq(overlay.waveCount(address(honest)), 0, "the honest instance is untouched");
        assertFalse(overlay.autoLatest(address(honest)));
        assertFalse(overlay.configured(address(fake)), "initConfig stays registry-gated: fakes never configure");
    }

    /// @dev 3. Value: the attacker pays for their own unlock; the module keeps nothing and pays out
    ///         exactly `msg.value`. The vault credit they buy is credit they funded.
    function test_H3_unlockIsValueConservingAndBuysNoPrivilege() public {
        vm.prank(attacker);
        overlay.setCommission(
            address(fake),
            1,
            "ipfs://fakecomm",
            MetadataOverlayModule.CommCond.PAY,
            1 ether,
            MetadataOverlayModule.Payout.SPLIT
        );

        vm.deal(attacker, 10 ether);
        uint256 artistBefore = attacker.balance;
        uint256 treasuryBefore = treasury.balance;

        vm.prank(attacker);
        overlay.unlock{ value: 1 ether }(address(fake), 1, keccak256(bytes("ipfs://fakecomm")));

        // Module holds nothing: every wei left in the same call.
        assertEq(address(overlay).balance, 0, "module holds no custody");
        uint256 out =
            (attacker.balance - (artistBefore - 1 ether)) + (treasury.balance - treasuryBefore) + realVault.totalIn();
        assertEq(out, 1 ether, "payment conserved: nothing created, nothing stranded");
        assertEq(realVault.credited(address(fake)), 0.19 ether, "vault credit went to the fake inst");

        // And that credit bought NO privilege: receiveContribution is permissionless on every real
        // vault, so the attacker could write the identical row directly, with no module involved.
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        realVault.receiveContribution{ value: 0.19 ether }(Currency.wrap(address(0)), 0.19 ether, address(0xC0FFEE));
        assertEq(realVault.credited(address(0xC0FFEE)), 0.19 ether, "direct route is open to everyone");
    }
}
