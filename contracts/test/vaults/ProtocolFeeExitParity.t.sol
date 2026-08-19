// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { stdStorage, StdStorage } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";

import { CypherAlignmentVault } from "../../src/vaults/cypher/CypherAlignmentVault.sol";
import { ZAMMAlignmentVault, IZAMM } from "../../src/vaults/zamm/ZAMMAlignmentVault.sol";
import { UniAlignmentVault } from "../../src/vaults/uni/UniAlignmentVault.sol";
import { AlignmentEndowmentVault } from "../../src/vaults/aave/AlignmentEndowmentVault.sol";

import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";

import { MockERC20 } from "../mocks/MockERC20.sol";
import { MockWETH } from "../mocks/MockWETH.sol";
import { MockZAMM } from "../mocks/MockZAMM.sol";
import { MockZRouter } from "../mocks/MockZRouter.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { MockAlgebraPositionManager, MockAlgebraSwapRouter, MockAlgebraFactory } from "../mocks/MockCypherAlgebra.sol";

/**
 * @title ProtocolFeeExitParity
 * @notice Cross-family parity gate for the 1% protocol-fee exit.
 * @dev The three fee-bearing liquidity families — Uni, ZAMM, Cypher — each accrue a protocol cut in
 *      `accumulatedProtocolFees` and each expose a `withdrawProtocolFees()` push. Divergence between
 *      them is what this file exists to catch, on two axes:
 *
 *        Axis 1 — EXIT CALLABILITY. The push is permissionless (any caller), the ETH lands in full at
 *                 the vault's pinned `protocolTreasury` (never a caller-supplied address), the bucket
 *                 is zeroed, and an unpinned sink reverts `TreasuryNotSet`.
 *
 *        Axis 2 — SINK MUTABILITY. Whether a family can re-point `protocolTreasury` after deploy.
 *                 Today only ZAMM exposes `setProtocolTreasury`; Cypher and Uni write the sink once at
 *                 `initialize`. This file asserts that table AS IT STANDS so a future divergence fails
 *                 loudly. It does not claim which shape is correct — whether Cypher and Uni should
 *                 gain a setter is a separate, unruled question.
 *
 *        Axis 3 — SINK PINNED AT BIRTH. `initialize` refuses a zero `protocolTreasury` in every family.
 *                 This is the half of the property that axis 1 cannot supply: because the sink is
 *                 write-once for two of the three families, a vault born with a zero sink accrues the
 *                 1% cut into a bucket that can never be withdrawn (axis 1 reverts, correctly) and can
 *                 never be re-pointed (axis 2, for those families). The factories take the treasury as
 *                 a caller-supplied argument, so init is the boundary where it has to be rejected.
 *
 *      NAMED EXCLUSION: `AlignmentEndowmentVault` is a fourth vault family and is deliberately NOT in
 *      the axis-1/axis-2/axis-3 table. It carries no `accumulatedProtocolFees` bucket and no fee exit, so
 *      three families is the complete set for this property. That exclusion is asserted below
 *      (`test_endowment_isExcludedBecauseItHasNoProtocolFeeBucket`) rather than left as a silent
 *      omission — an omission that looks identical to a coverage gap is how this class returns.
 */
contract ProtocolFeeExitParityTest is Test {
    using stdStorage for StdStorage;

    uint256 internal constant TARGET_ID = 1;
    uint256 internal constant ACCRUED = 1.234 ether;

    address internal treasury = makeAddr("protocolTreasury");
    address internal stranger = makeAddr("stranger"); // arbitrary non-treasury caller
    address internal refPool = makeAddr("refPool");
    address internal poolManager = makeAddr("poolManager");

    MockERC20 internal alignmentToken;
    MockWETH internal weth;
    MockAlignmentRegistry internal registry;
    MockVaultPriceValidator internal validator;
    MockZRouter internal zRouter;
    MockZAMM internal zamm;
    MockAlgebraPositionManager internal positionManager;
    MockAlgebraSwapRouter internal swapRouter;
    MockAlgebraFactory internal algebraFactory;

    CypherAlignmentVault internal cypherImpl;
    ZAMMAlignmentVault internal zammImpl;
    UniAlignmentVault internal uniImpl;

    CypherAlignmentVault internal cypher;
    ZAMMAlignmentVault internal zammVault;
    UniAlignmentVault internal uni;

    function setUp() public {
        alignmentToken = new MockERC20("Alignment", "ALN");
        weth = new MockWETH();
        zRouter = new MockZRouter();
        zamm = new MockZAMM();
        positionManager = new MockAlgebraPositionManager();
        swapRouter = new MockAlgebraSwapRouter();
        algebraFactory = new MockAlgebraFactory();

        validator = new MockVaultPriceValidator();
        validator.setEthPer1e18Tokens(1e18);

        registry = new MockAlignmentRegistry();
        registry.setTargetActive(TARGET_ID, true);
        registry.setTokenInTarget(TARGET_ID, address(alignmentToken), true);
        registry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: refPool, kind: 0, twapWindow: 1800 })
        );

        cypherImpl = new CypherAlignmentVault();
        zammImpl = new ZAMMAlignmentVault();
        uniImpl = new UniAlignmentVault();

        cypher = _newCypher(treasury);
        zammVault = _newZamm(treasury);
        uni = _newUni(treasury);
    }

    // ── Family constructors ─────────────────────────────────────────────────

    // Clone and init are split so axis 3 can arm `vm.expectRevert` on the `initialize` call alone —
    // armed across the clone it would trip on the deployment instead — while both paths still drive
    // the same argument list.

    function _newCypher(address treasury_) internal returns (CypherAlignmentVault v) {
        v = _cloneCypher();
        _initCypher(v, treasury_);
    }

    function _cloneCypher() internal returns (CypherAlignmentVault) {
        return CypherAlignmentVault(payable(LibClone.clone(address(cypherImpl))));
    }

    function _initCypher(CypherAlignmentVault v, address treasury_) internal {
        v.initialize(
            address(positionManager),
            address(swapRouter),
            address(algebraFactory),
            address(weth),
            address(alignmentToken),
            treasury_,
            address(0), // zRouter
            address(0), // zQuoter
            address(validator),
            IAlignmentRegistry(address(registry)),
            TARGET_ID
        );
    }

    function _newZamm(address treasury_) internal returns (ZAMMAlignmentVault v) {
        v = _cloneZamm();
        _initZamm(v, treasury_);
    }

    function _cloneZamm() internal returns (ZAMMAlignmentVault) {
        return ZAMMAlignmentVault(payable(LibClone.clone(address(zammImpl))));
    }

    function _initZamm(ZAMMAlignmentVault v, address treasury_) internal {
        v.initialize(
            address(zamm),
            address(zRouter),
            address(weth),
            address(alignmentToken),
            IZAMM.PoolKey({ id0: 0, id1: 0, token0: address(0), token1: address(alignmentToken), feeOrHook: 30 }),
            treasury_,
            address(validator),
            IAlignmentRegistry(address(registry)),
            TARGET_ID
        );
    }

    function _newUni(address treasury_) internal returns (UniAlignmentVault v) {
        v = _cloneUni();
        _initUni(v, treasury_);
    }

    function _cloneUni() internal returns (UniAlignmentVault) {
        return UniAlignmentVault(payable(LibClone.clone(address(uniImpl))));
    }

    function _initUni(UniAlignmentVault v, address treasury_) internal {
        v.initialize(
            address(this),
            address(weth),
            poolManager,
            address(alignmentToken),
            address(zRouter),
            3000,
            60,
            IVaultPriceValidator(address(validator)),
            IAlignmentRegistry(address(registry)),
            TARGET_ID,
            treasury_
        );
    }

    /// @dev Uniform accrual across the three families: write the protocol bucket and fund the vault
    ///      with the matching ETH. `checked_write` asserts the write is observable, so if a family's
    ///      storage layout moves this goes red instead of silently no-opping.
    function _accrue(address vault, uint256 amount) internal {
        stdstore.target(vault).sig("accumulatedProtocolFees()").checked_write(amount);
        vm.deal(vault, amount);
    }

    /// @dev Axis 1, one family. Asserted identically for all three.
    function _assertPermissionlessExit(address vault) internal {
        _accrue(vault, ACCRUED);
        assertEq(_protocolFees(vault), ACCRUED, "accrual staged");

        uint256 treasuryBefore = treasury.balance;
        uint256 strangerBefore = stranger.balance;

        vm.prank(stranger);
        (bool ok,) = vault.call(abi.encodeWithSignature("withdrawProtocolFees()"));
        assertTrue(ok, "protocol-fee exit must be callable by an arbitrary non-treasury caller");

        assertEq(treasury.balance - treasuryBefore, ACCRUED, "full cut lands at the pinned treasury");
        assertEq(stranger.balance, strangerBefore, "caller receives nothing; the sink is not caller-supplied");
        assertEq(vault.balance, 0, "vault holds no residue of the cut");
        assertEq(_protocolFees(vault), 0, "protocol bucket zeroed");
    }

    function _protocolFees(address vault) internal view returns (uint256) {
        (bool ok, bytes memory ret) = vault.staticcall(abi.encodeWithSignature("accumulatedProtocolFees()"));
        assertTrue(ok, "family must expose accumulatedProtocolFees()");
        return abi.decode(ret, (uint256));
    }

    /// @dev Axis 2 probe: does this family expose `setProtocolTreasury(address)` at all? Raw-called
    ///      from the vault's own owner with a valid non-zero argument, so a `false` means the function
    ///      is absent (no vault carries a `fallback()`, only `receive()`), not that auth rejected it.
    function _ownerCanRepointSink(address vault) internal returns (bool ok) {
        address vaultOwner = abi.decode(_view(vault, "owner()"), (address));
        vm.prank(vaultOwner);
        (ok,) = vault.call(abi.encodeWithSignature("setProtocolTreasury(address)", makeAddr("newSink")));
    }

    function _view(address target, string memory sig) internal view returns (bytes memory ret) {
        bool ok;
        (ok, ret) = target.staticcall(abi.encodeWithSignature(sig));
        assertTrue(ok, sig);
    }

    // ── Axis 1 — exit callability ───────────────────────────────────────────

    function test_axis1_cypher_exitIsPermissionlessAndLandsAtTreasury() public {
        _assertPermissionlessExit(address(cypher));
    }

    function test_axis1_zamm_exitIsPermissionlessAndLandsAtTreasury() public {
        _assertPermissionlessExit(address(zammVault));
    }

    function test_axis1_uni_exitIsPermissionlessAndLandsAtTreasury() public {
        _assertPermissionlessExit(address(uni));
    }

    // An unpinned sink must revert rather than burn the cut. Asserted on an UNINITIALIZED clone
    // uniformly across the three families: Uni and ZAMM refuse a zero treasury at `initialize`, so a
    // fresh clone is the only state in which the guard is reachable for all three.

    function test_axis1_cypher_revertsWhenTreasuryUnset() public {
        CypherAlignmentVault v = CypherAlignmentVault(payable(LibClone.clone(address(cypherImpl))));
        vm.expectRevert(CypherAlignmentVault.TreasuryNotSet.selector);
        v.withdrawProtocolFees();
    }

    function test_axis1_zamm_revertsWhenTreasuryUnset() public {
        ZAMMAlignmentVault v = ZAMMAlignmentVault(payable(LibClone.clone(address(zammImpl))));
        vm.expectRevert(ZAMMAlignmentVault.TreasuryNotSet.selector);
        v.withdrawProtocolFees();
    }

    function test_axis1_uni_revertsWhenTreasuryUnset() public {
        UniAlignmentVault v = UniAlignmentVault(payable(LibClone.clone(address(uniImpl))));
        vm.expectRevert(UniAlignmentVault.TreasuryNotSet.selector);
        v.withdrawProtocolFees();
    }

    // ── Axis 2 — sink mutability, asserted as an explicit table ─────────────

    /// @dev The table as it stands today. A family gaining or losing `setProtocolTreasury` flips its
    ///      row and fails here, which is the point: the divergence becomes a decision instead of a
    ///      discovery.
    function test_axis2_sinkMutabilityTable() public {
        assertTrue(_ownerCanRepointSink(address(zammVault)), "ZAMM: sink is re-pointable by the owner");
        assertFalse(_ownerCanRepointSink(address(cypher)), "Cypher: sink is write-once at initialize");
        assertFalse(_ownerCanRepointSink(address(uni)), "Uni: sink is write-once at initialize");
    }

    /// @dev Only ZAMM's setter exists, and it moves the sink for real — pinned so the axis-2 `true`
    ///      row cannot be satisfied by an unrelated function that merely happens to accept the call.
    function test_axis2_zammSetterActuallyMovesTheSink() public {
        address newSink = makeAddr("relocatedTreasury");
        zammVault.setProtocolTreasury(newSink);
        assertEq(zammVault.protocolTreasury(), newSink, "ZAMM sink re-pointed");

        _accrue(address(zammVault), ACCRUED);
        vm.prank(stranger);
        zammVault.withdrawProtocolFees();
        assertEq(newSink.balance, ACCRUED, "cut follows the re-pointed sink");
    }

    // ── Axis 3 — the sink is pinned at birth ────────────────────────────────

    // A zero treasury is rejected at `initialize` in every family. Each leg drives the same helper the
    // happy-path fixtures use, with `address(0)` in the treasury slot, so the assertion tracks the real
    // constructor argument order rather than a hand-rolled copy of it.

    function test_axis3_cypher_initializeRejectsZeroTreasury() public {
        CypherAlignmentVault v = _cloneCypher();
        vm.expectRevert(CypherAlignmentVault.TreasuryNotSet.selector);
        _initCypher(v, address(0));
    }

    function test_axis3_zamm_initializeRejectsZeroTreasury() public {
        ZAMMAlignmentVault v = _cloneZamm();
        vm.expectRevert(ZAMMAlignmentVault.TreasuryNotSet.selector);
        _initZamm(v, address(0));
    }

    function test_axis3_uni_initializeRejectsZeroTreasury() public {
        UniAlignmentVault v = _cloneUni();
        vm.expectRevert(UniAlignmentVault.TreasuryNotSet.selector);
        _initUni(v, address(0));
    }

    /// @dev The happy-path counterpart: a non-zero treasury initializes and is pinned to exactly the
    ///      argument supplied, so the axis-3 reverts above cannot be satisfied by an `initialize` that
    ///      rejects everything.
    function test_axis3_nonZeroTreasuryIsPinnedInEveryFamily() public view {
        assertEq(cypher.protocolTreasury(), treasury, "Cypher pins the supplied sink");
        assertEq(zammVault.protocolTreasury(), treasury, "ZAMM pins the supplied sink");
        assertEq(uni.protocolTreasury(), treasury, "Uni pins the supplied sink");
    }

    // ── Named exclusion ─────────────────────────────────────────────────────

    /// @dev `AlignmentEndowmentVault` is out of the parity table because it has no protocol-fee bucket
    ///      and no fee exit — not because it was overlooked. If it ever gains either, this goes red and
    ///      the family joins the table above.
    function test_endowment_isExcludedBecauseItHasNoProtocolFeeBucket() public {
        AlignmentEndowmentVault endowment = new AlignmentEndowmentVault();

        (bool hasBucket,) = address(endowment).staticcall(abi.encodeWithSignature("accumulatedProtocolFees()"));
        assertFalse(hasBucket, "endowment has no accumulatedProtocolFees bucket");

        (bool hasExit,) = address(endowment).call(abi.encodeWithSignature("withdrawProtocolFees()"));
        assertFalse(hasExit, "endowment has no protocol-fee exit");
    }
}
