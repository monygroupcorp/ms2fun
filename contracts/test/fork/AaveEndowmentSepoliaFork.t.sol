// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeploySepolia } from "../../script/DeploySepolia.s.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { IStataToken } from "../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { IAlignmentVault } from "../../src/interfaces/IAlignmentVault.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { ERC4626_FLOOR_WEI } from "./helpers/Erc4626Rounding.sol";

/// @dev Exposes the Sepolia network config so the rehearsal deploys against the real ADDRESSES rather
///      than a hand-copied approximation of them — which is the whole point of the file, since what it
///      asserts is which WETH the live stataToken is backed by.
///
///      Two things the caller replaces, and neither is one of those addresses: the vanity CREATE3 salts
///      (already consumed on live Sepolia, so a fork of latest would collide on the first proxy) and the
///      alignment-target roster, which this network now leaves deliberately empty — see `_config`.
contract DeploySepoliaHarness is DeploySepolia {
    function sepoliaConfig() external pure returns (NetworkConfig memory) {
        return _sepoliaConfig();
    }
}

/// @dev Stand-in benefactor. The endowment vault credits principal to a CONTRACT and reads
///      `IOwnable(benefactor).owner()` on the yield-claim path, so a codeless address cannot be one.
contract StubBenefactor {
    address public owner;

    constructor(address _owner) {
        owner = _owner;
    }
}

/**
 * @title AaveEndowmentSepoliaForkTest
 * @notice Fork rehearsal for `NetworkConfig.aaveWeth` against live Sepolia state.
 *
 *         Sepolia's Aave V3 WETH market is fronted by Aave's own test WETH, so the stataToken's
 *         `asset()` is not the canonical Sepolia WETH the rest of the deployment uses. This test
 *         rehearses the whole path against the real tokens:
 *
 *         - the endowment family deploys and its vault initializes on the Aave-side WETH, while the
 *           rest of the deployment stays on canonical WETH;
 *         - a native-ETH contribution wraps and lands as a real stataToken position;
 *         - pointing `cfg.aaveWeth` back at canonical WETH makes `deploy()` revert, which is what
 *           shows the deploy-time assertion is load-bearing rather than decorative.
 *
 * @dev Fork-gated: `SEPOLIA_RPC_URL` unset -> `vm.skip(true)`, so the suite degrades instead of
 *      failing where no RPC is configured. Not exercised by the dispatch verify, which compiles it
 *      only.
 *      Run: SEPOLIA_RPC_URL=<url> forge test --mp test/fork/AaveEndowmentSepoliaFork.t.sol -vv
 */
contract AaveEndowmentSepoliaForkTest is Test {
    /// @dev Canonical Sepolia WETH — what `cfg.weth` is, and what every non-endowment family uses.
    address constant CANONICAL_WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    bool skipped;

    function setUp() public {
        string memory rpc = vm.envOr("SEPOLIA_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            skipped = true;
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
    }

    // ── The endowment family deploys, initializes, and takes a deposit ───────

    function test_endowmentFamilyDeploysAndTakesADepositOnSepolia() public {
        if (skipped) return;

        DeployCore.NetworkConfig memory cfg = _config();
        address aaveWeth = cfg.aaveWeth;

        DeployCore s = new DeployCore();
        s.deploy(address(s), cfg);

        // The parameter reached the family, and only the family.
        assertEq(s.aaveVaultFactory().weth(), aaveWeth, "endowment factory on the Aave-side WETH");
        assertTrue(aaveWeth != CANONICAL_WETH, "the two WETHs are genuinely different on Sepolia");
        assertEq(s.erc721Factory().weth(), CANONICAL_WETH, "the rest of the deployment keeps canonical WETH");

        // The invariant the deploy asserts, re-read from the live stataToken.
        IStataToken stata = IStataToken(cfg.aaveStataToken);
        assertEq(stata.asset(), aaveWeth, "stataToken asset() is the endowment family's WETH");

        // A native-ETH contribution wraps and lands in the real Aave position.
        address vault = s.aaveVaults(0);
        StubBenefactor benefactor = new StubBenefactor(address(this));

        assertEq(stata.balanceOf(vault), 0, "vault holds no position before the contribution");

        uint256 amount = 0.01 ether;
        vm.deal(address(this), amount);
        IAlignmentVault(payable(vault)).receiveContribution{ value: amount }(
            Currency.wrap(address(0)), amount, address(benefactor)
        );

        assertGt(stata.balanceOf(vault), 0, "contribution reached the stataToken");
        // TWO real ERC-4626 conversions stand between the ETH that went in and this read, and the bound
        // is one term per conversion. `_deposit` wraps the ETH 1:1 into WETH, which cannot round; then
        // `stataToken.deposit` floors the shares it mints against the live liquidity index, and
        // `maxWithdraw` floors again valuing those shares back through `convertToAssets`. A single-floor
        // bound stood here and it is not enough: the second floor lands whenever BOTH divisions come out
        // uneven. Measured on the live token at 0.01 ETH, sampling 149 mainnet blocks spread over five
        // months: the round trip lost 1 wei at 140 of them and 2 wei at 9, and never 3. So a one-floor
        // bound is green about fifteen runs in sixteen -- which is how it shipped, and how it then failed
        // on the first run of a reviewer who thought to run it more than once.
        //
        // The direction is asserted on its own because it is the direction that carries the safety. A
        // position reading ABOVE the contribution would be value the vault never received -- an
        // over-credit the next withdrawal cannot honour -- while a shortfall of a few wei is the floors
        // landing where they are designed to land, in the vault's favour, and is owed to nobody. So the
        // upper assert is the one that would catch a defect; the lower one only refuses a position that
        // collapsed.
        assertLe(stata.maxWithdraw(vault), amount, "the position reads MORE than was contributed");
        assertGe(stata.maxWithdraw(vault) + 2 * ERC4626_FLOOR_WEI, amount, "position is worth the contribution");
    }

    // ── Vacuity: canonical WETH for the endowment family fails at deploy ─────

    function test_deployRevertsWhenTheEndowmentFamilyIsPointedAtCanonicalWeth() public {
        if (skipped) return;

        DeployCore.NetworkConfig memory cfg = _config();
        cfg.aaveWeth = CANONICAL_WETH; // the mismatch, made explicit

        DeployCore s = new DeployCore();
        vm.expectRevert(
            bytes("DeployCore: cfg.aaveWeth does not match the Aave stataToken's asset() (set cfg.aaveWeth)")
        );
        s.deploy(address(s), cfg);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// @dev The real Sepolia config, with one endowment target to hang a vault on and fresh salts:
    ///      the live vanity set is already consumed on Sepolia and a fork of latest would
    ///      `CreateCollision` on the first proxy. Salt choice is irrelevant to what this test asserts.
    ///
    ///      The target is supplied here for the same reason the mainnet twin supplies one. This test
    ///      was written when `_sepoliaConfig()` still carried a single LINK target that existed only
    ///      to give the per-target endowment vault something to hang on; the roster then moved to
    ///      `SeedSepolia`, and `cfg.alignmentTargets` on this network is now deliberately EMPTY. An
    ///      empty roster deploys the endowment factory and no vault, so `aaveVaults(0)` reverts on an
    ///      out-of-bounds read — a network-config change silently taking a fork rehearsal with it.
    ///      What this file asserts is the WETH pairing on the live chain, not the shipped roster, so
    ///      it names its own target rather than depending on whatever the network config carries.
    function _config() internal returns (DeployCore.NetworkConfig memory cfg) {
        cfg = new DeploySepoliaHarness().sepoliaConfig();

        DeployCore.AlignmentTargetConfig[] memory targets = new DeployCore.AlignmentTargetConfig[](1);
        targets[0] = DeployCore.AlignmentTargetConfig({
            token: CANONICAL_WETH, // registry paperwork only; an endowment vault never touches it
            symbol: "REHEARSAL",
            name: "Endowment rehearsal target",
            description: "Fixture target, fork rehearsal only.",
            deployUniVault: false,
            deployZAMMVault: false,
            communityPayout: address(0xB0B)
        });
        cfg.alignmentTargets = targets;

        cfg.saltMasterRegistry = keccak256("rehearsal.masterRegistry");
        cfg.saltTreasury = keccak256("rehearsal.treasury");
        cfg.saltQueueManager = keccak256("rehearsal.queueManager");
        cfg.saltGlobalMsgReg = keccak256("rehearsal.globalMsgReg");
        cfg.saltAlignmentReg = keccak256("rehearsal.alignmentReg");
        cfg.saltComponentReg = keccak256("rehearsal.componentReg");
        cfg.saltNonce = block.timestamp;
        cfg.jsonOutputPath = "";
    }
}
