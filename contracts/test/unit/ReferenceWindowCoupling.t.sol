// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { UniswapVaultPriceValidator } from "../../src/peripherals/UniswapVaultPriceValidator.sol";
import { MockUniV3RefFactory } from "../master/AlignmentRegistryReferencePool.t.sol";

/// @notice A V3-shaped reference pool that HONOURS `secondsAgos`: it serves any window up to
///         `maxWindow` and reverts above it, the way a pool whose observation buffer only reaches
///         that far back does. Every shipped reference-pool mock ignores `secondsAgos` entirely,
///         so none of them can observe the coupling this file pins.
contract WindowHonouringRefPool {
    address public token0;
    address public token1;
    uint32 public maxWindow;
    int24 public meanTick;
    uint24 public fee = 3000;

    constructor(address _token0, address _token1, uint32 _maxWindow, int24 _meanTick) {
        token0 = _token0;
        token1 = _token1;
        maxWindow = _maxWindow;
        meanTick = _meanTick;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            require(secondsAgos[i] <= maxWindow, "OLD");
        }
        tickCumulatives = new int56[](2);
        secondsPerLiquidityCumulativeX128s = new uint160[](2);
        tickCumulatives[0] = 0;
        tickCumulatives[1] = int56(meanTick) * int56(uint56(secondsAgos[0]));
    }
}

/**
 * @title ReferenceWindowCoupling
 * @notice noesis-280 — pins the TWAP-window coupling between the two contracts that together make the
 *         anti-sandwich floor work, and which are configured INDEPENDENTLY:
 *
 *           * `AlignmentRegistryV1.DEFAULT_TWAP_WINDOW` — a hardcoded `internal constant` (1800) that
 *             `setReferencePool` probes with when a `ReferencePool.twapWindow` is left at 0;
 *           * `UniswapVaultPriceValidator.twapSecondsAgo` — a CONSTRUCTOR argument (`cfg.twapSeconds`,
 *             1800 in all three shipped deploy configs) that `quoteEthForTokensVia` falls back to for
 *             the same `twapWindow == 0`.
 *
 *         The registry's setter documents itself as having TEETH: it reverts unless the pool "actually
 *         produces a TWAP over the window". That guarantee only transfers to the vault floor if the
 *         window the setter proved is the window the reader asks for.
 *
 *         noesis-285 CLOSED that coupling from the registry side: `setReferencePool` now stores the
 *         window it RESOLVED and probed with, so a caller's `0` is written back as the default rather
 *         than kept raw, and `quoteEthForTokensVia` is handed an explicit window it never has to fall
 *         back on. These tests were written against the old behaviour, where both sides resolved `0`
 *         independently against constants nothing held together; they now pin the guarantee instead of
 *         the hazard, and `test_defaultWindowPinSurvivesADivergentValidator` is the case that used to
 *         fail and is the reason the change was made.
 *
 *         What is NOT closed, and is why this file keeps its registry-side framing: a reference pinned
 *         BEFORE this change is still stored as `0` and still resolves through the reader's fallback.
 *         The fix is forward-only — see `test_aLegacyZeroPinStillDependsOnTheReadersFallback`.
 */
contract ReferenceWindowCouplingTest is Test {
    AlignmentRegistryV1 internal registry;

    address internal dao = makeAddr("dao");
    address internal weth = address(uint160(0x1111));
    address internal token = address(uint160(0xF000));

    /// @dev `cfg.twapSeconds` in DeployAnvil / DeploySepolia / DeployMainnet, all three.
    ///      RESIDUAL, stated so this file is not read as covering more than it does: this is a LITERAL
    ///      transcribed from the deploy scripts, not a value read from them. It pins the coupling from
    ///      the REGISTRY side (moving `DEFAULT_TWAP_WINDOW` alone turns
    ///      `test_setterProvedWindowIsTheWindowTheReaderAsksFor` red). A change to `cfg.twapSeconds` in
    ///      a deploy script ALONE would not be caught here — the scripts build the value inside a
    ///      function, so there is nothing to import. See `noesis-279`.
    uint32 internal constant SHIPPED_VALIDATOR_WINDOW = 1800;

    /// @dev `AlignmentRegistryV1.DEFAULT_TWAP_WINDOW`, which is `internal` and so cannot be read from a
    ///      test. Transcribed for the same reason as the line above, and load-bearing since noesis-285:
    ///      it is now the value the setter WRITES, not only the value it probes with.
    uint32 internal constant REGISTRY_DEFAULT_WINDOW = 1800;

    uint256 internal targetId;

    MockUniV3RefFactory internal uniFactory;

    function setUp() public {
        uniFactory = new MockUniV3RefFactory();
        AlignmentRegistryV1 impl = new AlignmentRegistryV1(weth, address(uniFactory));
        registry = AlignmentRegistryV1(LibClone.deployERC1967(address(impl)));
        registry.initialize(dao);

        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] = IAlignmentRegistry.AlignmentAsset({ token: token, symbol: "T", info: "", metadataURI: "" });
        vm.prank(dao);
        targetId = registry.registerAlignmentTarget("align", "d", "", assets);
    }

    function _validator(uint32 window) internal returns (UniswapVaultPriceValidator) {
        return new UniswapVaultPriceValidator(weth, address(0), address(0), 1000, window);
    }

    /// @dev This file is about the WINDOW coupling, not provenance (noesis-283), so every pool it builds is
    ///      a canonical one — registered here so the setter's factory check is satisfied and the window
    ///      assertions stay the only thing under test.
    function _canonical(WindowHonouringRefPool p) internal returns (WindowHonouringRefPool) {
        uniFactory.register(p.token0(), p.token1(), p.fee(), address(p));
        return p;
    }

    function _pinDefaultWindow(address pool) internal {
        vm.prank(dao);
        registry.setReferencePool(
            targetId, token, IAlignmentRegistry.ReferencePool({ pool: pool, kind: 0, twapWindow: 0 })
        );
    }

    /// A pool with EXACTLY the registry's default window of history is accepted by the setter, and the
    /// validator deployed with the shipped `cfg.twapSeconds` can then price it. This is the property the
    /// vault floor depends on: "the setter guarantees a usable reference" is only true end to end.
    /// Goes red if `DEFAULT_TWAP_WINDOW` moves without the pool's depth moving with it.
    function test_setterProvedWindowIsTheWindowTheReaderAsksFor() public {
        WindowHonouringRefPool pool =
            _canonical(new WindowHonouringRefPool(weth, token, REGISTRY_DEFAULT_WINDOW, 69080));

        _pinDefaultWindow(address(pool));

        IAlignmentRegistry.ReferencePool memory ref = registry.getReferencePool(targetId, token);
        assertEq(ref.pool, address(pool), "reference pinned");
        assertEq(
            uint256(ref.twapWindow),
            REGISTRY_DEFAULT_WINDOW,
            "noesis-285: the setter stores the window it PROVED, not the caller's 0"
        );

        uint256 quoted =
            _validator(SHIPPED_VALIDATOR_WINDOW).quoteEthForTokensVia(address(pool), 0, ref.twapWindow, token, 1e18);
        assertGt(quoted, 0, "shipped validator window can price a reference the setter accepted");
    }

    /// THE noesis-285 CASE. A reference pinned with `twapWindow: 0` against a pool holding exactly the
    /// registry's default of history, read by a validator configured to a DIFFERENT window.
    ///
    /// Before the fix the registry stored the raw `0`, so `quoteEthForTokensVia` fell back to its own
    /// `twapSecondsAgo` of 3600, asked a pool with 1800s of history for a 3600s TWAP and reverted
    /// `ReferenceTwapUnavailable`. That revert lands inside the vault's floor path, so a pool that pinned
    /// cleanly surfaced as a vault that could not convert. Storing the resolved window means the reader is
    /// handed 1800 explicitly and never consults its own default.
    ///
    /// Non-vacuity: this test is red on the parent commit, and goes red again if `setReferencePool` is
    /// reverted to storing `ref` verbatim.
    function test_defaultWindowPinSurvivesADivergentValidator() public {
        WindowHonouringRefPool pool =
            _canonical(new WindowHonouringRefPool(weth, token, REGISTRY_DEFAULT_WINDOW, 69080));

        _pinDefaultWindow(address(pool));

        IAlignmentRegistry.ReferencePool memory ref = registry.getReferencePool(targetId, token);
        uint256 quoted = _validator(3600).quoteEthForTokensVia(address(pool), 0, ref.twapWindow, token, 1e18);
        assertGt(quoted, 0, "a validator on a divergent window still prices a default-window pin");
    }

    /// The residual the fix does NOT reach, pinned so nobody reads this file as claiming more than it does.
    /// A pool pinned before noesis-285 kept a stored `0`, and a `0` still means "resolve against my own
    /// default" to the reader. Simulated by handing the reader the `0` such a pin left behind: against a
    /// validator whose window outruns the pool's history it still reverts, and re-pinning is the only cure.
    function test_aLegacyZeroPinStillDependsOnTheReadersFallback() public {
        WindowHonouringRefPool pool =
            _canonical(new WindowHonouringRefPool(weth, token, REGISTRY_DEFAULT_WINDOW, 69080));
        _pinDefaultWindow(address(pool));

        UniswapVaultPriceValidator divergent = _validator(3600);
        vm.expectRevert();
        divergent.quoteEthForTokensVia(address(pool), 0, 0, token, 1e18);
    }

    /// A pool with LESS history than the registry's default is rejected AT SET TIME, so the divergence
    /// can never be introduced from the pool side — only from a config change.
    function test_setterRejectsAPoolShallowerThanItsOwnDefaultWindow() public {
        WindowHonouringRefPool tooShallow = _canonical(new WindowHonouringRefPool(weth, token, 60, 69080));
        vm.prank(dao);
        vm.expectRevert(AlignmentRegistryV1.ReferencePoolUnusable.selector);
        registry.setReferencePool(
            targetId, token, IAlignmentRegistry.ReferencePool({ pool: address(tooShallow), kind: 0, twapWindow: 0 })
        );
    }

    /// An EXPLICIT `twapWindow` binds both sides to the same number, so a reference pinned that way is
    /// immune to the config coupling above. Pinned so the explicit form stays the safe one.
    function test_explicitWindowBindsBothSides() public {
        WindowHonouringRefPool pool = _canonical(new WindowHonouringRefPool(weth, token, 600, 69080));
        vm.prank(dao);
        registry.setReferencePool(
            targetId, token, IAlignmentRegistry.ReferencePool({ pool: address(pool), kind: 0, twapWindow: 600 })
        );

        IAlignmentRegistry.ReferencePool memory ref = registry.getReferencePool(targetId, token);
        assertEq(uint256(ref.twapWindow), 600, "explicit window stored");

        // A validator configured with a DIFFERENT default still prices it, because the explicit
        // window is passed through and neither fallback is consulted.
        uint256 quoted = _validator(3600).quoteEthForTokensVia(address(pool), 0, ref.twapWindow, token, 1e18);
        assertGt(quoted, 0, "explicit window is honoured by the reader");
    }
}
