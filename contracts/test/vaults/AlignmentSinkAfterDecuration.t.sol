// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { UniAlignmentVault } from "../../src/vaults/uni/UniAlignmentVault.sol";
import { TestableUniAlignmentVault } from "../helpers/TestableUniAlignmentVault.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { MockEXECToken } from "../mocks/MockEXECToken.sol";
import { MockZRouter } from "../mocks/MockZRouter.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";

/// @notice The community's accrued cut must survive de-curation.
///
/// @dev    An LP alignment vault accrues the target's 19% and has exactly one exit for it,
///         `withdrawTargetFees()`, which resolves the destination from
///         `AlignmentRegistryV1.getCommunityPayout`. De-curation is one-way by design, so if
///         `setCommunityPayout` were gated on `active` a target deactivated before its sink was ever
///         wired would leave that ETH with no reachable destination for the life of the contract.
///
///         This suite runs the whole path against the REAL registry rather than the vault mock — the
///         trap lives in the registry's gate, and the mock has no gate to trip. Restore the `active`
///         check in `setCommunityPayout` and `test_payoutStaysSettableAfterDecuration_andTheCutLands`
///         goes red at the `setCommunityPayout` call.
contract AlignmentSinkAfterDecurationTest is Test {
    AlignmentRegistryV1 internal registry;
    TestableUniAlignmentVault internal vault;
    MockEXECToken internal alignmentToken;
    MockWETH internal weth;
    MockZRouter internal router;
    MockVaultPriceValidator internal validator;

    address internal daoOwner = makeAddr("dao");
    address internal vaultOwner = makeAddr("vaultOwner");
    address internal treasury = makeAddr("treasury");
    address internal communitySink = makeAddr("communitySink");
    address internal anyone = makeAddr("anyone");

    uint256 internal targetId;

    function setUp() public {
        weth = new MockWETH();
        alignmentToken = new MockEXECToken(1_000_000e18);
        router = new MockZRouter();
        validator = new MockVaultPriceValidator();

        registry = new AlignmentRegistryV1(address(weth));
        registry.initialize(daoOwner);

        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({
            token: address(alignmentToken), symbol: "EXEC", info: "", metadataURI: ""
        });
        vm.prank(daoOwner);
        targetId = registry.registerAlignmentTarget("Remilia", "", "", assets);

        vault = TestableUniAlignmentVault(payable(LibClone.clone(address(new TestableUniAlignmentVault()))));
        vault.initialize(
            vaultOwner,
            address(weth),
            makeAddr("poolManager"),
            address(alignmentToken),
            address(router),
            3000,
            60,
            IVaultPriceValidator(address(validator)),
            IAlignmentRegistry(address(registry)),
            targetId,
            treasury
        );
    }

    /// @dev Put 1 ETH of trading fees through the split so the target bucket holds a real 19%.
    function _accrueTargetCut() internal {
        vm.deal(address(this), 1 ether);
        vault.exerciseFeeSplit{ value: 1 ether }(1 ether);
        assertEq(vault.accumulatedTargetFees(), 0.19 ether, "19% accrued to the target bucket");
    }

    /// The whole trap, start to finish: fees accrue, the target is de-curated with no sink ever set,
    /// and the community's cut still reaches the community.
    function test_payoutStaysSettableAfterDecuration_andTheCutLands() public {
        _accrueTargetCut();

        vm.prank(daoOwner);
        registry.deactivateAlignmentTarget(targetId);
        assertFalse(registry.isAlignmentTargetActive(targetId), "target is de-curated");
        assertEq(registry.getCommunityPayout(targetId), address(0), "and its sink was never wired");

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, communitySink);
        assertEq(registry.getCommunityPayout(targetId), communitySink, "sink settable after de-curation");

        uint256 before = communitySink.balance;
        vm.prank(anyone);
        vault.withdrawTargetFees();

        assertEq(communitySink.balance - before, 0.19 ether, "the accrued 19% reached the community");
        assertEq(vault.accumulatedTargetFees(), 0, "target bucket cleared");
    }

    /// De-curation is still one-way, and setting a sink is not a way back in.
    function test_settingPayoutDoesNotRestoreCuration() public {
        vm.prank(daoOwner);
        registry.deactivateAlignmentTarget(targetId);

        vm.prank(daoOwner);
        registry.setCommunityPayout(targetId, communitySink);

        assertFalse(registry.isAlignmentTargetActive(targetId), "still de-curated");
    }

    /// The `approvedAt` gate stays: an id that was never approved has no target to pay.
    function test_unapprovedTargetStillReverts() public {
        vm.prank(daoOwner);
        vm.expectRevert(AlignmentRegistryV1.TargetNotFound.selector);
        registry.setCommunityPayout(targetId + 999, communitySink);
    }

    /// And the owner gate stays: de-curation does not open the sink to anyone else.
    function test_decuratedTargetPayoutIsStillOwnerOnly() public {
        vm.prank(daoOwner);
        registry.deactivateAlignmentTarget(targetId);

        vm.prank(anyone);
        vm.expectRevert();
        registry.setCommunityPayout(targetId, communitySink);
    }
}
