// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { DeployCore } from "../../script/DeployCore.sol";
import { CREATEX } from "../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { AlignmentEndowmentVault } from "../../src/vaults/aave/AlignmentEndowmentVault.sol";
import { ZAMMAlignmentVault } from "../../src/vaults/zamm/ZAMMAlignmentVault.sol";

/// @title AaveEndowmentWethParamTest
/// @notice Covers `NetworkConfig.aaveWeth` — the WETH the Aave endowment family wraps into before it
///         supplies the stataToken.
///
///         Three properties, in the order they matter:
///
///         1. **Unset is the current behaviour, bit for bit.** A config that never mentions `aaveWeth`
///            wires the endowment factory to `cfg.weth`, the same token every other family gets. This
///            is the mainnet and anvil-fork path and it is pinned by test rather than by argument.
///         2. **Set overrides the endowment family ONLY.** The other families keep `cfg.weth`, so a
///            network whose Aave market is fronted by its own test WETH does not have to flip the whole
///            deployment onto that token.
///         3. **The deploy asserts the pair.** If the endowment family's WETH is not the stataToken's
///            own `asset()`, `deploy()` reverts — the mismatch surfaces at deploy instead of as a vault
///            that reverts on every contribution.
contract AaveEndowmentWethParamTest is Test {
    address constant STUB_LINK = 0x779877A7B0D9E8603169DdbD7836e478b4624789;
    address constant STUB_ZAMM = address(0xADD0);
    address constant STUB_STATA = address(0xADD3);

    /// @dev Second WETH-shaped token, standing in for a network whose Aave market fronts its own.
    address constant STUB_ALT_WETH = address(0xADD6);

    /// @dev `PUSH1 1; MSTORE; RETURN 32` — any call returns `true`/`1`, enough for `approve()`.
    bytes constant RETURN_TRUE = hex"600160005260206000f3";

    function setUp() public {
        vm.etch(CREATEX, CREATEX_BYTECODE);
        vm.etch(STUB_LINK, RETURN_TRUE);
        vm.etch(STUB_ALT_WETH, RETURN_TRUE);
    }

    // ── 1. Unset `aaveWeth` is today's behaviour ─────────────────────────────

    function test_unsetAaveWethResolvesToCfgWeth() public {
        _mockStataAsset(STUB_LINK);

        DeployCore s = new DeployCore();
        s.deploy(address(s), _config(address(0)));

        assertEq(s.aaveVaultFactory().weth(), STUB_LINK, "endowment factory WETH defaults to cfg.weth");
        assertEq(
            address(AlignmentEndowmentVault(payable(s.aaveVaults(0))).weth()),
            STUB_LINK,
            "endowment vault WETH defaults to cfg.weth"
        );
    }

    /// @dev The same resolution reached the other way: naming `cfg.weth` explicitly is indistinguishable
    ///      from leaving the field unset, which is what makes the mainnet flip a no-op.
    function test_aaveWethSetToCfgWethIsTheSameWiring() public {
        _mockStataAsset(STUB_LINK);

        DeployCore s = new DeployCore();
        s.deploy(address(s), _config(STUB_LINK));

        assertEq(s.aaveVaultFactory().weth(), STUB_LINK, "explicit cfg.weth wires the same token");
    }

    // ── 2. Set overrides the endowment family only ───────────────────────────

    function test_aaveWethOverridesTheEndowmentFamilyOnly() public {
        _mockStataAsset(STUB_ALT_WETH);

        DeployCore s = new DeployCore();
        s.deploy(address(s), _config(STUB_ALT_WETH));

        assertEq(s.aaveVaultFactory().weth(), STUB_ALT_WETH, "endowment factory takes cfg.aaveWeth");
        assertEq(
            address(AlignmentEndowmentVault(payable(s.aaveVaults(0))).weth()),
            STUB_ALT_WETH,
            "endowment vault takes cfg.aaveWeth"
        );
        // Everything else stays on cfg.weth — the override is scoped to one family.
        assertEq(s.zammVaultFactory().weth(), STUB_LINK, "ZAMM factory keeps cfg.weth");
        assertEq(ZAMMAlignmentVault(payable(s.zammVaults(0))).weth(), STUB_LINK, "ZAMM vault keeps cfg.weth");
        assertEq(s.erc721Factory().weth(), STUB_LINK, "ERC721 auction factory keeps cfg.weth");
    }

    // ── 3. The deploy-time invariant is not vacuous ──────────────────────────

    /// @dev The override path, mismatched: `aaveWeth` is a token the stataToken does not accept.
    function test_deployRevertsWhenAaveWethIsNotTheStataAsset() public {
        _mockStataAsset(STUB_ALT_WETH);

        DeployCore s = new DeployCore();
        vm.expectRevert(
            bytes("DeployCore: cfg.aaveWeth does not match the Aave stataToken's asset() (set cfg.aaveWeth)")
        );
        s.deploy(address(s), _config(STUB_LINK));
    }

    /// @dev The default path, mismatched — the case a network hits by omitting `aaveWeth` on a chain
    ///      whose Aave market is fronted by its own WETH. It must fail at deploy, not at first deposit.
    function test_deployRevertsWhenDefaultedCfgWethIsNotTheStataAsset() public {
        _mockStataAsset(STUB_ALT_WETH);

        DeployCore s = new DeployCore();
        vm.expectRevert(
            bytes("DeployCore: cfg.aaveWeth does not match the Aave stataToken's asset() (set cfg.aaveWeth)")
        );
        s.deploy(address(s), _config(address(0)));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    function _mockStataAsset(address asset) internal {
        vm.mockCall(STUB_STATA, abi.encodeWithSignature("asset()"), abi.encode(asset));
    }

    /// @dev One alignment target with the endowment family plus a ZAMM vault, so the override's blast
    ///      radius is observable rather than asserted about a single contract.
    function _config(address aaveWeth) internal pure returns (DeployCore.NetworkConfig memory cfg) {
        DeployCore.AlignmentTargetConfig[] memory targets = new DeployCore.AlignmentTargetConfig[](1);
        targets[0] = DeployCore.AlignmentTargetConfig({
            token: STUB_LINK,
            symbol: "LINK",
            name: "Chainlink",
            description: "Test alignment target",
            deployUniVault: false,
            deployCypherVault: false,
            deployZAMMVault: true,
            communityPayout: address(0)
        });

        cfg.chainId = 1337;
        cfg.weth = STUB_LINK; // etched RETURN_TRUE — the endowment init's approve() succeeds
        cfg.v4PoolManager = address(1);
        cfg.zamm = STUB_ZAMM;
        cfg.aaveStataToken = STUB_STATA;
        cfg.aaveWeth = aaveWeth;
        cfg.saltMasterRegistry = bytes32(uint256(1));
        cfg.saltTreasury = bytes32(uint256(2));
        cfg.saltQueueManager = bytes32(uint256(3));
        cfg.saltGlobalMsgReg = bytes32(uint256(4));
        cfg.saltAlignmentReg = bytes32(uint256(5));
        cfg.saltComponentReg = bytes32(uint256(6));
        cfg.priceDeviationBps = 1000;
        cfg.twapSeconds = 1800;
        cfg.zrouterFee = 3000;
        cfg.zrouterTickSpacing = 60;
        cfg.zammFeeOrHook = 100;
        cfg.alignmentTargets = targets;
        cfg.jsonOutputPath = "";
    }
}
