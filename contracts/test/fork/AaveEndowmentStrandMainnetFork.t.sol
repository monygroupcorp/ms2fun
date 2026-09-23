// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { AlignmentEndowmentVault } from "../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { MainnetAddresses } from "../../script/MainnetAddresses.sol";
import {
    MockWETH,
    MockStataToken,
    MockMasterRegistry,
    MockAmbassadorRegistry
} from "../vaults/aave/AlignmentEndowmentVault.t.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { ERC4626_FLOOR_WEI } from "./helpers/Erc4626Rounding.sol";

interface IStata4626 {
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function totalSupply() external view returns (uint256);
    function balanceOf(address) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function previewWithdraw(uint256 assets) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
    function deposit(uint256 assets, address receiver) external returns (uint256);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256);
}

interface IWethLike {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

interface IAavePool {
    function getReserveNormalizedIncome(address asset) external view returns (uint256);
}

/// @dev Stand-in benefactor: the endowment credits principal to a CONTRACT and reads
///      `IOwnable(benefactor).owner()` on the yield-claim path, so a codeless address cannot be one.
contract StrandBenefactor {
    address public owner;

    constructor(address _owner) {
        owner = _owner;
    }
}

/// @dev Sink for the ambassador's `execute`. Takes ETH inertly; it exists only to be a destination.
contract StrandSink {
    receive() external payable { }
}

/**
 * @title AaveEndowmentStrandMainnetForkTest
 * @notice Whether endowment principal can be stranded out of sight and then re-attributed as YIELD against
 *         the REAL Aave static aToken.
 *
 *         It can be against the inline `MockStataToken`, and the invariant suite finds it. The chain there
 *         is four links:
 *           (1) EIP-4626 makes `withdraw` round the share BURN up, so every redemption burns slightly more
 *               shares than proportional;
 *           (2) the mock prices shares as an assets-over-shares RATIO, so that over-burn RATCHETS the price,
 *               and a drain sized to leave a remainder below one share's worth takes the last share while
 *               assets remain — `totalShares == 0` over a non-zero `totalManaged`;
 *           (3) `convertToAssets` on an empty supply is 0, so `currentPositionValue()` reads zero over live
 *               assets: the round closes redeeming nothing and books `roundResidue = 0` before zeroing the
 *               basis over the top of it;
 *           (4) the next deposit mints 1:1 against the empty supply and INHERITS the orphan, which the next
 *               harvest splits 80/19/1 as yield.
 *         Nothing is drained — principal is RECLASSIFIED, so the fifth of it that the target and protocol
 *         legs take leaves the benefactors' pool for good.
 *
 *         What this file settles is that the bound in production is the WRAPPER and not the vault. The
 *         chain ends at link (2), twice over: `waEthWETH` prices shares off Aave's liquidity index, which
 *         no redemption moves, so the over-burn of link (1) has nothing to ratchet — and its `totalAssets`
 *         is DERIVED from the supply through that index rather than held beside it, so "supply empty,
 *         assets remain" is not a state the token can be in even when the supply is zeroed by force.
 *         Link (1) is real on the real token; links (3) and (4) never get their premise. That is a claim
 *         about a live contract, so it is
 *         measured against the live contract rather than read off Aave's documentation, and each link is
 *         taken in order so the file says WHICH one breaks rather than only that the sequence declines to
 *         reproduce. `test_control_theMockRatchetsAndStrands` holds the mock's side of the same four links
 *         in miniature, so the difference between the two is a diff and not an assertion.
 *
 * @dev Fork-gated: `MAINNET_RPC_URL` unset -> `vm.skip(true)`, so the suite degrades instead of failing
 *      where no RPC is configured. Not in the default gate, which compiles it only.
 *      Run: MAINNET_RPC_URL=<url> forge test --mp test/fork/AaveEndowmentStrandMainnetFork.t.sol -vv
 */
contract AaveEndowmentStrandMainnetForkTest is Test {
    /// @dev Aave v3 Ethereum `Pool`. Read here ONLY as the independent publisher of the liquidity index, so
    ///      "the share price IS the index" is checked against the index's source rather than against a
    ///      second read of the token, which would agree with itself by construction.
    address internal constant AAVE_V3_POOL = 0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2;

    /// @dev Aave's ray. The static aToken's share price is quoted in it: `convertToAssets(1 RAY)` is the
    ///      liquidity index itself.
    uint256 internal constant RAY = 1e27;

    /// @dev The residue the drain deliberately leaves behind. It must be under `totalPrincipalShares /
    ///      MIN_SHARE_PRICE_INVERSE` (1e18 / 1e9 = 1e9 wei for a one-ether round) or the vault's round does
    ///      not close and the close path — link (3) — is never entered.
    uint256 internal constant STRAND_REMAINDER = 1000;

    /// @dev ERC-7201 namespace root for OpenZeppelin's upgradeable ERC20 storage —
    ///      `keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.ERC20")) - 1)) & ~bytes32(uint256(0xff))`.
    ///      `_totalSupply` is the third member of that struct. Used by one test to FORCE an empty supply; the
    ///      slot is verified against `totalSupply()` before it is written, so a storage layout change makes
    ///      that test fail rather than silently write somewhere harmless.
    bytes32 internal constant ERC20_STORAGE_BASE = 0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00;

    IStata4626 internal stata;
    IWethLike internal weth;
    bool internal skipped;

    address internal actor = address(0x5721AD);

    function setUp() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            skipped = true;
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        stata = IStata4626(MainnetAddresses.WETH_STATA_TOKEN);
        weth = IWethLike(MainnetAddresses.WETH);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Link 1 — does the real token round the share burn UP?
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice It does. The chain does NOT break here, and the reason it breaks later is not that the real
    ///         token rounds more kindly than the mock.
    ///
    /// @dev EIP-4626 requires `withdraw` to round the share burn up and `waEthWETH` obeys: `previewWithdraw`
    ///      returns the ceiling where `convertToShares` returns the floor, on every size below, none of
    ///      which divides evenly by a ~1.07-ray index. Asserted as an EQUALITY rather than a bound so this
    ///      cannot pass by the premise quietly evaporating — if the real token ever stopped over-burning,
    ///      the tests after it would be proving nothing about the mock chain, and this one says so first.
    function test_link1_theRealTokenAlsoRoundsTheShareBurnUp() public view {
        if (skipped) return;

        uint256[5] memory sizes = [uint256(1), 1000, 1e9, 1 ether, 7.77 ether];
        for (uint256 i = 0; i < sizes.length; i++) {
            assertEq(
                stata.previewWithdraw(sizes[i]),
                stata.convertToShares(sizes[i]) + 1,
                "the share burn did not round up on a size that divides unevenly"
            );
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Link 2 — can that over-burn ratchet the share price? This is the break.
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice The real token's share price is Aave's liquidity index, not an assets-over-shares ratio, so
    ///         the over-burn of link 1 has nothing to ratchet.
    ///
    /// @dev `convertToAssets(1 RAY)` equals `Pool.getReserveNormalizedIncome(WETH)` to the wei. The ratio
    ///      model — which is exactly what `MockStataToken` implements — is a DIFFERENT number at the same
    ///      block, and that is asserted too, so the two models are told apart here rather than assumed not
    ///      to coincide.
    function test_link2a_theSharePriceIsTheLiquidityIndexNotAnAssetsOverSharesRatio() public view {
        if (skipped) return;

        uint256 index = IAavePool(AAVE_V3_POOL).getReserveNormalizedIncome(MainnetAddresses.WETH);
        assertEq(stata.convertToAssets(RAY), index, "the share price is not the liquidity index");

        uint256 ratioModel = (RAY * stata.totalAssets()) / stata.totalSupply();
        assertTrue(ratioModel != index, "ratio and index coincide at this block: this test cannot tell them apart here");
    }

    /// @notice No redemption moves the share price, however it is sized — including the one sized so the
    ///         ceiling burn takes the last share. This is the ratchet the mock has and the real token does
    ///         not, and the reason the chain cannot reach link 3.
    function test_link2b_noRedemptionMovesTheSharePrice() public {
        if (skipped) return;

        uint256 priceBefore = stata.convertToAssets(1e18);
        _mintPosition(10 ether);
        assertEq(stata.convertToAssets(1e18), priceBefore, "a deposit moved the share price");

        // Walk the position down, ending on the drain the mock exploit uses: one that leaves a remainder
        // smaller than a single share is worth, so the ceiling burn reaches for the last share.
        uint256[3] memory cuts = [uint256(9 ether), 0.9 ether, 0];
        for (uint256 i = 0; i < cuts.length; i++) {
            uint256 amount = cuts[i] == 0 ? stata.maxWithdraw(actor) - 1 : cuts[i];
            vm.prank(actor);
            stata.withdraw(amount, actor, actor);
            assertEq(stata.convertToAssets(1e18), priceBefore, "a redemption ratcheted the share price");
        }

        uint256 dust = stata.maxWithdraw(actor);
        if (dust > 0) {
            vm.prank(actor);
            stata.withdraw(dust, actor, actor);
        }
        assertEq(stata.convertToAssets(1e18), priceBefore, "emptying the position ratcheted the share price");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  Links 3 and 4 — is there anything to strand, and can a later deposit inherit it?
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice Emptying a holding strands nothing a later deposit can pick up.
    ///
    /// @dev Under the index model a holding is worth `shares * index / RAY`, so zero shares is zero assets:
    ///      there is no "assets remain while the supply is empty" state for the value to be invisible in,
    ///      and a fresh deposit is priced by the same index rather than 1:1 against an empty supply. Link 4
    ///      is checked head-on — the new position is worth at most what was paid for it.
    function test_link34_emptyingTheHoldingStrandsNothingALaterDepositInherits() public {
        if (skipped) return;

        _mintPosition(3 ether);
        uint256 all = stata.maxWithdraw(actor);
        vm.prank(actor);
        stata.withdraw(all, actor, actor);

        assertEq(stata.balanceOf(actor), 0, "the drain did not empty the share balance");
        assertEq(stata.convertToAssets(stata.balanceOf(actor)), 0, "an empty balance is worth something");

        // The next deposit, same block, no interest anywhere in between.
        uint256 second = 1 ether;
        uint256 worth = stata.convertToAssets(_mintPosition(second));
        assertLe(worth, second, "the new position is worth MORE than was paid for it: an orphan was inherited");
        // And it did not collapse either: the shortfall is the two 4626 floors, the mint and the valuation.
        assertGe(worth + 2 * ERC4626_FLOOR_WEI, second, "the new position lost more than two conversion floors");
    }

    /// @notice The orphan state itself — an empty supply standing over live assets — does not exist on the
    ///         real token, and not because it is hard to reach: it is not representable. `totalAssets()` is
    ///         DERIVED from the supply through the index rather than held beside it, so emptying the supply
    ///         empties the assets in the same breath. There is no second number for a wei to survive in.
    ///
    /// @dev The supply is zeroed by writing storage directly. That is not a claim the state is reachable by
    ///      any call — it is the question asked in its strongest form. `MockStataToken` keeps `totalShares`
    ///      and `totalManaged` as two independent numbers, and its whole vulnerability is that a redemption
    ///      can zero the first while the second still holds a wei. Hand `waEthWETH` the same write and the
    ///      second number goes with it; hand it a zero-supply branch to take and it has none, so the price
    ///      stays the liquidity index and the next deposit is still priced by it rather than one-for-one.
    ///      Nothing else in this file forces state; this test exists so the answer does not rest on the
    ///      empty supply merely being unreachable.
    ///
    ///      The slot is the ERC-7201 namespace `openzeppelin.storage.ERC20` + 2 (`_balances`, `_allowances`,
    ///      then `_totalSupply`), and that it really is the supply is asserted before it is written rather
    ///      than assumed, so a storage-layout change fails this test instead of quietly writing nowhere.
    function test_link2c_theOrphanStateIsNotEvenRepresentableOnTheRealToken() public {
        if (skipped) return;

        bytes32 supplySlot = bytes32(uint256(ERC20_STORAGE_BASE) + 2);
        assertEq(
            uint256(vm.load(address(stata), supplySlot)),
            stata.totalSupply(),
            "that slot is not the supply: the forced state would be meaningless"
        );
        assertGt(stata.totalAssets(), 0, "the wrapper is already empty: there is nothing to strand");

        uint256 index = stata.convertToAssets(RAY);
        vm.store(address(stata), supplySlot, bytes32(0));

        assertEq(stata.totalSupply(), 0, "the supply did not empty");
        // The mock's step 2 is `totalShares == 0` with `totalManaged == 1`. Here the assets are the supply
        // priced by the index, so zeroing one zeroes the other: the orphan has nowhere to be.
        assertEq(stata.totalAssets(), 0, "assets survived an empty supply: an orphan is representable");

        // And no zero-supply branch takes over the pricing either way.
        assertEq(stata.convertToAssets(RAY), index, "an empty supply moved the share price");
        assertEq(stata.convertToAssets(0), 0, "zero shares are worth something on an empty supply");

        // The deposit that inherits the orphan against the mock is still index-priced, not one-for-one.
        uint256 amount = 1 ether;
        uint256 worth = stata.convertToAssets(_mintPosition(amount));
        assertLe(worth, amount, "the deposit minted 1:1 against the empty supply and over-credited itself");
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  The vault-level replay: the six-call shape, against the real wrapper
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice The endowment vault itself, unmodified, wired to the REAL `waEthWETH` and the REAL WETH, run
    ///         through the shape that reclassifies principal against the mock — deposit, accrue, harvest,
    ///         drain, deposit, harvest. Nothing is reclassified.
    ///
    /// @dev Three things are measured, one per link the mock chain would take:
    ///        - the round close REDEEMS the residue it books. Against the mock it redeems 1 and gets 0,
    ///          booking `roundResidue = 0` while the wei sits in the wrapper; here `roundResidue` comes out
    ///          within one conversion floor of the remainder the drain deliberately left.
    ///        - `currentPositionValue()` agrees with the shares the vault actually holds, so there is no
    ///          value the vault is blind to.
    ///        - the vault's own yield pool — `currentPositionValue() - totalPrincipal`, exactly what
    ///          `harvest` realizes and splits — is read immediately before and after the second deposit, in
    ///          the SAME block. No interest can accrue between those two reads, so any jump is inherited
    ///          orphan and nothing else. Against the mock that jump is the stranded principal entire.
    ///
    ///      Yield is accrued with `vm.warp` alone, which is faithful rather than a stand-in: Aave's
    ///      `getReserveNormalizedIncome` interpolates linearly from the reserve's last-update timestamp, so
    ///      wall-clock time IS the accrual — no interaction, and no index written by hand. That the warp
    ///      moved the index is asserted before anything is built on it, so an Aave change making accrual
    ///      interaction-driven surfaces here as a failure instead of as a vacuous pass.
    function test_theEndowmentReplayDoesNotReclassifyPrincipalOnTheRealToken() public {
        if (skipped) return;

        (AlignmentEndowmentVault vault, address ambassador) = _deployVaultOnRealAave();
        StrandBenefactor benefactor = new StrandBenefactor(address(this));
        StrandSink sink = new StrandSink();

        // (1) deposit
        uint256 first = 1 ether;
        vm.deal(address(this), first);
        vault.receiveContribution{ value: first }(Currency.wrap(address(0)), first, address(benefactor));
        assertGt(stata.balanceOf(address(vault)), 0, "the contribution never reached the stataToken");

        // (2) accrueYield — real Aave interest, bought with time
        uint256 indexBefore = stata.convertToAssets(RAY);
        vm.warp(block.timestamp + 30 days);
        assertGt(stata.convertToAssets(RAY), indexBefore, "warping bought no interest: the accrual model changed");

        // (3) harvest — the accrued interest is split and leaves the pool
        vault.harvest();

        // (4) execute — the ambassador drains all but `STRAND_REMAINDER`, which is the call that collapses
        //     the share price past the vault's floor and closes the round. Against the mock this is where
        //     the residue becomes invisible.
        uint256 corpus = vault.deployableCorpus();
        assertGt(corpus, STRAND_REMAINDER, "nothing to drain: the replay would be vacuous");
        vm.prank(ambassador);
        vault.execute(address(sink), corpus - STRAND_REMAINDER, "");

        assertEq(vault.totalPrincipal(), 0, "the round did not close: the close path was never entered");
        assertGe(
            vault.roundResidue() + ERC4626_FLOOR_WEI,
            STRAND_REMAINDER,
            "the close booked less residue than it left behind: principal went invisible"
        );
        assertEq(
            vault.currentPositionValue(),
            stata.convertToAssets(stata.balanceOf(address(vault))),
            "the vault's position reading disagrees with the shares it holds"
        );

        uint256 poolBefore = _yieldPool(vault);

        // (5) deposit — the call that inherits the orphan against the mock. Same block as the read above.
        uint256 second = 1 ether;
        vm.deal(address(this), second);
        vault.receiveContribution{ value: second }(Currency.wrap(address(0)), second, address(benefactor));

        assertLe(
            _yieldPool(vault),
            poolBefore + 2 * ERC4626_FLOOR_WEI,
            "the deposit inherited stranded principal: it surfaced as distributable yield"
        );

        // (6) harvest — with nothing inherited there is nothing for the split to take.
        uint256 distributedBefore = _distributed(vault);
        vault.harvest();
        assertLe(
            _distributed(vault) - distributedBefore, 2 * ERC4626_FLOOR_WEI, "harvest distributed principal as yield"
        );
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  The control: the same four links, against the mock, in miniature
    // ═════════════════════════════════════════════════════════════════════════

    /// @notice `MockStataToken` takes all four links, at three wei. Keeping the mock's side of the diff next
    ///         to the real token's is what makes "the wrapper is the bound" a comparison rather than an
    ///         assertion — and it pins the mock's behaviour, so a later rewrite of the mock that quietly
    ///         removed the ratchet would show up as this test failing rather than as the tests above losing
    ///         their subject without saying so.
    ///
    /// @dev Not a defect report against the mock and not a request to change it: a test double is entitled
    ///      to be cruder than the thing it stands for. It is a statement of what the invariant finding rests
    ///      on, held where the reader can see both halves at once.
    function test_control_theMockRatchetsAndStrands() public {
        if (skipped) return;

        MockWETH mockWeth = new MockWETH();
        MockStataToken mock = new MockStataToken(address(mockWeth));
        mockWeth.mint(address(this), 10);
        mockWeth.approve(address(mock), type(uint256).max);

        // Three wei in, three shares out, price 1.
        mock.deposit(3, address(this));
        assertEq(mock.convertToAssets(1), 1, "the mock did not start at unit price");

        // A wei of yield: 4 managed over 3 shares. The price is 1.33, which no integer can express.
        mock.simulateYield(1);

        // Links 1 and 2: the ceiling burn takes a whole share for 1 wei of assets, and the price RATCHETS
        // from 4/3 to 3/2 — a move no redemption can make against the real token.
        mock.withdraw(1, address(this), address(this));
        assertEq(mock.totalShares(), 2, "the burn did not round up");
        assertEq(mock.totalManaged(), 3, "the wrapper did not debit exactly what was withdrawn");

        // Link 2 concluded: the drain sized to leave 1 wei takes the LAST share while an asset remains.
        mock.withdraw(2, address(this), address(this));
        assertEq(mock.totalShares(), 0, "the supply did not empty");
        assertEq(mock.totalManaged(), 1, "there is nothing left to strand: the control is vacuous");

        // Link 3: the wei is invisible. This is the read `currentPositionValue()` makes.
        assertEq(mock.convertToAssets(mock.totalManaged()), 0, "the mock did not hide the remainder");

        // Link 4: the next deposit mints 1:1 against the empty supply and inherits it — one wei in, two out.
        uint256 shares = mock.deposit(1, address(this));
        assertEq(mock.convertToAssets(shares), 2, "the next deposit did not inherit the orphan");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// @dev Everything ever routed down the three yield legs. The creator leg is the counter PLUS the
    ///      remainder: a leg the per-share accumulator cannot express at the live share count waits in the
    ///      remainder, and reading the counter alone under-reports it.
    function _distributed(AlignmentEndowmentVault vault) internal view returns (uint256) {
        return vault.totalYieldToCreators() + vault.creatorYieldRemainder() + vault.totalYieldToTarget()
            + vault.totalProtocolFees();
    }

    /// @dev Position value above the tracked principal basis — exactly what `harvest` realizes and splits.
    function _yieldPool(AlignmentEndowmentVault vault) internal view returns (uint256) {
        uint256 basis = vault.totalPrincipal();
        uint256 value = vault.currentPositionValue();
        return value > basis ? value - basis : 0;
    }

    /// @dev Give `actor` a real stataToken position of `amount` WETH. Returns the shares minted.
    function _mintPosition(uint256 amount) internal returns (uint256 shares) {
        vm.deal(actor, actor.balance + amount);
        vm.startPrank(actor);
        weth.deposit{ value: amount }();
        weth.approve(address(stata), amount);
        shares = stata.deposit(amount, actor);
        vm.stopPrank();
    }

    /// @dev The endowment vault, unmodified, on the REAL WETH and the REAL `waEthWETH`. Only the registries
    ///      are stood in for — they are platform bookkeeping the wrapper question does not touch — so that
    ///      exactly ONE thing differs from the world the invariant suite runs in: the wrapper.
    function _deployVaultOnRealAave() internal returns (AlignmentEndowmentVault vault, address ambassador) {
        ambassador = address(0xA0FB);
        uint256 targetId = 42;

        MockMasterRegistry master = new MockMasterRegistry();
        MockAmbassadorRegistry ambassadors = new MockAmbassadorRegistry();
        master.setAlignmentRegistry(address(ambassadors));
        ambassadors.setAmbassador(targetId, ambassador, true);
        ambassadors.setCommunityPayout(targetId, address(0xA0FC));

        address impl = address(new AlignmentEndowmentVault());
        vault = AlignmentEndowmentVault(payable(LibClone.clone(impl)));
        vault.initialize(
            address(0xA0FF), // owner
            MainnetAddresses.WETH,
            MainnetAddresses.WETH_STATA_TOKEN,
            address(0xA0FE), // protocol treasury
            address(master),
            address(0xA0FD), // alignment token: registry paperwork, never touched by an endowment vault
            targetId
        );
    }
}
