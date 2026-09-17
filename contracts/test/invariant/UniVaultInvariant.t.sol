// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { StdInvariant } from "forge-std/StdInvariant.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { UniAlignmentVault } from "../../src/vaults/uni/UniAlignmentVault.sol";
import { TestableUniAlignmentVault } from "../helpers/TestableUniAlignmentVault.sol";
import { MockEXECToken } from "../mocks/MockEXECToken.sol";
import { MockZRouter } from "../mocks/MockZRouter.sol";
import { MockVaultPriceValidator } from "../mocks/MockVaultPriceValidator.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { UniVaultHandler } from "./handlers/UniVaultHandler.sol";

contract UniVaultInvariantTest is StdInvariant, Test {
    TestableUniAlignmentVault public vault;
    MockEXECToken public alignmentToken;
    MockZRouter public mockZRouter;
    MockVaultPriceValidator public mockValidator;
    MockAlignmentRegistry public mockAlignmentRegistry;
    UniVaultHandler public handler;

    address public owner = address(this);
    address public treasury = address(0x99);
    address[] public actors;

    uint256 constant TARGET_ID = 1;

    function setUp() public {
        alignmentToken = new MockEXECToken(10_000_000e18);
        mockZRouter = new MockZRouter();
        mockValidator = new MockVaultPriceValidator();
        mockAlignmentRegistry = new MockAlignmentRegistry();
        mockAlignmentRegistry.setTargetActive(TARGET_ID, true);
        mockAlignmentRegistry.setTokenInTarget(TARGET_ID, address(alignmentToken), true);

        vm.deal(address(mockZRouter), 1000 ether);
        alignmentToken.transfer(address(mockZRouter), 1_000_000e18);

        TestableUniAlignmentVault impl = new TestableUniAlignmentVault();
        vault = TestableUniAlignmentVault(payable(LibClone.clone(address(impl))));
        vault.initialize(
            address(this),
            address(0x1111111111111111111111111111111111111111), // mockWETH
            address(0x2222222222222222222222222222222222222222), // mockPoolManager
            address(alignmentToken),
            address(mockZRouter),
            3000,
            60,
            IVaultPriceValidator(address(mockValidator)),
            IAlignmentRegistry(address(mockAlignmentRegistry)),
            TARGET_ID,
            treasury
        );

        PoolKey memory mockPoolKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(alignmentToken)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        vault.setV4PoolKey(mockPoolKey);

        // The oracle floor reads a DAO-pinned reference pool and has NO fail-open: without one,
        // `_floorTokenOut` reverts `NoReferencePool` and `convertAndAddLiquidity` cannot run at all.
        // It was never wired here, so EVERY convert in this suite reverted and every invariant that
        // only says something after a conversion was holding over an empty path (audit M-2).
        mockAlignmentRegistry.setReferencePool(
            TARGET_ID,
            address(alignmentToken),
            IAlignmentRegistry.ReferencePool({ pool: address(0xBEEF), kind: 0, twapWindow: 1800 })
        );
        mockValidator.setEthPer1e18Tokens(1e18); // 1 token == 1 ETH at the oracle

        actors.push(address(0xA11CE));
        actors.push(address(0xB0B));
        actors.push(address(0xCAFE));
        actors.push(address(0xDEAD));

        handler = new UniVaultHandler(vault, actors);

        targetContract(address(handler));
    }

    // ── Invariant 1: sum(benefactorShares[i]) == totalShares ──

    function invariant_sharesSumEqualsTotal() public view {
        uint256 sumShares;
        address[] memory a = handler.getActors();
        for (uint256 i = 0; i < a.length; i++) {
            sumShares += vault.benefactorShares(a[i]);
        }
        assertEq(sumShares, vault.totalShares(), "Uni: sum(benefactorShares) != totalShares");
    }

    // ── Invariant 2: no phantom ETH ──
    // accumulatedProtocolFees + sum(claimable) <= address(vault).balance

    function invariant_noPhantomETH() public view {
        if (vault.totalShares() == 0) return;
        if (vault.accumulatedFees() == 0) return;

        uint256 sumClaimable;
        address[] memory a = handler.getActors();
        for (uint256 i = 0; i < a.length; i++) {
            if (vault.benefactorShares(a[i]) == 0) continue;
            // Use the delta-based unclaimed amount (what would actually be paid)
            uint256 currentShareValue = (vault.accumulatedFees() * vault.benefactorShares(a[i])) / vault.totalShares();
            uint256 unclaimed = currentShareValue > vault.shareValueAtLastClaim(a[i])
                ? currentShareValue - vault.shareValueAtLastClaim(a[i])
                : 0;
            sumClaimable += unclaimed;
        }

        uint256 obligations = vault.accumulatedProtocolFees() + sumClaimable;
        assertLe(obligations, address(vault).balance, "Uni: phantom ETH - obligations exceed balance");
    }

    // ── Invariant 3: totalPendingETH == balance when no LP deployed ──

    function invariant_pendingEqualsBalancePreLP() public view {
        if (vault.totalShares() > 0) return;
        if (vault.accumulatedFees() > 0) return;
        if (vault.totalPendingETH() == 0 && address(vault).balance == 0) return;

        assertEq(
            vault.totalPendingETH(), address(vault).balance, "Uni: totalPendingETH != balance before LP deployment"
        );
    }

    // ── Invariant 4: no dilution inversion ──
    // Share ordering must be monotonic with contribution ordering:
    // if benefactorTotalETH[a] >= benefactorTotalETH[b], then benefactorShares[a] >= benefactorShares[b]
    // (for actors who both have shares, i.e., have been through at least one conversion).
    // This is weaker than strict ratio equality but immune to double-rounding artifacts.
    //
    // Additionally: no actor's shares can exceed totalShares, and the sum equals totalShares
    // (covered by invariant 1).

    /// @dev Within ONE conversion, more ETH into the batch must never buy fewer shares out of it.
    ///
    ///      This replaces a cross-batch claim — "more lifetime converted ETH implies at least as many
    ///      shares" — that is not a property of this vault and never was. Shares are LP UNITS, and the
    ///      liquidity minted per ETH differs from conversion to conversion, so a holder with more
    ///      lifetime ETH can legitimately hold fewer shares than one who contributed less into a batch
    ///      that minted more liquidity. The old form only ever passed because `convertAndAddLiquidity`
    ///      reverted on every call in this suite (no reference pool was wired), so it was asserting
    ///      over a vault that had never converted anything. With the path live it fails immediately,
    ///      and it should — the claim is wrong, not the code.
    ///
    ///      The per-batch ordering is the real property, and the handler records it at the only moment
    ///      the inputs exist: the convert zeroes `pendingETH`, so the batch's own contributions cannot
    ///      be recovered afterwards.
    function invariant_noDilutionInversionWithinAConversion() public view {
        assertEq(
            handler.ghost_dilutionInversions(), 0, "Uni: within one conversion, more ETH in bought fewer shares out"
        );
    }

    // ── Invariant 5: pending sum consistency ──

    function invariant_pendingSumConsistency() public view {
        uint256 sumPending;
        address[] memory a = handler.getActors();
        for (uint256 i = 0; i < a.length; i++) {
            sumPending += vault.pendingETH(a[i]);
        }
        assertEq(sumPending, vault.totalPendingETH(), "Uni: sum(pendingETH) != totalPendingETH");
    }

    /// @dev Coverage, asserted rather than assumed — and in `afterInvariant` rather than an invariant,
    ///      because it is a fact about the run as a whole and is false before the first call.
    ///
    ///      Two separate things made this suite's post-conversion invariants vacuous at once: no
    ///      reference pool was wired, so every `convertAndAddLiquidity` reverted `NoReferencePool`; and
    ///      the mock reported the whole ETH leg as deposited, so `ethUnabsorbed` was structurally zero
    ///      even if one had landed. An invariant that cannot reach its own subject passes forever
    ///      without saying anything, so pin both here: a change that re-breaks either path fails loudly
    ///      instead of going quiet (audit M-2).
    function afterInvariant() public view {
        assertGt(handler.ghost_convertsLanded(), 0, "no convert ever landed: the invariants are vacuous");
        assertGt(
            handler.ghost_convertsWithResidual(),
            0,
            "no convert ever left a residual: the carry-forward path is unobserved"
        );
    }
}
