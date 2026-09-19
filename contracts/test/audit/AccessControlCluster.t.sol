// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ERC404Factory } from "../../src/factories/erc404/ERC404Factory.sol";
import { UniAlignmentVaultFactory } from "../../src/vaults/uni/UniAlignmentVaultFactory.sol";
import { UniAlignmentVault } from "../../src/vaults/uni/UniAlignmentVault.sol";
import { ZAMMAlignmentVaultFactory } from "../../src/vaults/zamm/ZAMMAlignmentVaultFactory.sol";
import { IZAMM, ZAMMAlignmentVault } from "../../src/vaults/zamm/ZAMMAlignmentVault.sol";
import { AlignmentEndowmentVaultFactory } from "../../src/vaults/aave/AlignmentEndowmentVaultFactory.sol";
import { CypherAlignmentVaultFactory } from "../../src/vaults/cypher/CypherAlignmentVaultFactory.sol";
import { CypherAlignmentVault } from "../../src/vaults/cypher/CypherAlignmentVault.sol";
import { SafeOwnable } from "../../src/shared/SafeOwnable.sol";
import { ProtocolTreasuryV1 } from "../../src/treasury/ProtocolTreasuryV1.sol";
import { ProtocolOwnedLiquidityV1 } from "../../src/treasury/ProtocolOwnedLiquidityV1.sol";
import { IVaultPriceValidator } from "../../src/interfaces/IVaultPriceValidator.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { MockAlignmentRegistry } from "../mocks/MockAlignmentRegistry.sol";
import { MockEXECToken } from "../mocks/MockEXECToken.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";

/// @notice Findings B/L-2 (role renounce), C/D (seizable implementations), E/L-4 (the treasury setter
///         no address could call), F/L-3 (renounce on the vault factories).
contract AccessControlClusterTest is Test {
    address internal protocol = address(0xDA0);
    address internal attacker = address(0xBAD);

    // ── B / L-2: PROTOCOL_ROLE cannot be renounced out of existence ────────────

    function _factory() internal returns (ERC404Factory f) {
        // The constructor only non-zero-checks these; it makes no external calls.
        f = new ERC404Factory(
            ERC404Factory.CoreConfig({
                implementation: address(0x1111),
                masterRegistry: address(0x2222),
                protocol: protocol,
                weth: address(0x3333)
            }),
            ERC404Factory.ModuleConfig({
                globalMessageRegistry: address(0x4444),
                componentRegistry: address(0x5555),
                launchManager: address(0x6666)
            })
        );
    }

    function test_B_renounceRolesCannotDestroyProtocolRole() public {
        ERC404Factory f = _factory();
        uint256 ROLE = f.PROTOCOL_ROLE();
        assertTrue(f.hasAllRoles(protocol, ROLE), "protocol starts with the role");
        assertEq(f.owner(), protocol, "and is the owner");

        // The code hardens grantRoles/revokeRoles against PROTOCOL_ROLE ...
        vm.prank(protocol);
        vm.expectRevert(ERC404Factory.ProtocolRoleNotTransferable.selector);
        f.grantRoles(address(0xC0FFEE), ROLE);

        // ... and now the holder's own side too. Without this override one ordinary solady call
        // destroyed the role for every address including the owner, with no way to re-grant it.
        vm.prank(protocol);
        vm.expectRevert(ERC404Factory.ProtocolRoleNotTransferable.selector);
        f.renounceRoles(ROLE);

        // The role survives, and so does every lever it gates.
        assertTrue(f.hasAllRoles(protocol, ROLE), "role intact");
        vm.startPrank(protocol);
        f.setProtocolTreasury(address(0x7777));
        f.setDeployBondEscrow(address(0x7777));
        f.setWeth(address(0x7777));
        f.setBondingFeeBps(1);
        f.setMinPoolEth(1);
        vm.stopPrank();
    }

    /// @dev A renounce that bundles PROTOCOL_ROLE with anything else is refused whole — the guard is
    ///      on the bitmask, so it cannot be slipped past by renouncing a superset in one call.
    function test_B_renounceCannotSmuggleProtocolRoleInsideABiggerMask() public {
        ERC404Factory f = _factory();
        uint256 ROLE = f.PROTOCOL_ROLE();
        uint256 OTHER = 1 << 200;

        vm.prank(protocol);
        f.grantRoles(protocol, OTHER);
        assertTrue(f.hasAllRoles(protocol, OTHER));

        vm.prank(protocol);
        vm.expectRevert(ERC404Factory.ProtocolRoleNotTransferable.selector);
        f.renounceRoles(ROLE | OTHER);
        assertTrue(f.hasAllRoles(protocol, ROLE | OTHER), "neither role dropped");

        // An unrelated role still renounces normally: the base behaviour is narrowed, not replaced.
        vm.prank(protocol);
        f.renounceRoles(OTHER);
        assertFalse(f.hasAnyRole(protocol, OTHER), "unrelated role renounced");
        assertTrue(f.hasAllRoles(protocol, ROLE), "PROTOCOL_ROLE untouched");
    }

    /// @dev The role is not frozen, only undestroyable: `transferProtocolRole` still hands it on.
    function test_B_protocolRoleStillMovesToANewHolder() public {
        ERC404Factory f = _factory();
        uint256 ROLE = f.PROTOCOL_ROLE();
        address successor = address(0xC0FFEE);

        vm.prank(protocol);
        f.transferProtocolRole(successor);

        assertFalse(f.hasAnyRole(protocol, ROLE), "old holder released");
        assertTrue(f.hasAllRoles(successor, ROLE), "new holder has it");
        vm.prank(successor);
        f.setBondingFeeBps(1);
    }

    // ── C: seizing a UUPS IMPLEMENTATION buys nothing ──────────────────────────

    function test_C_seizedUupsImplementationCannotUpgradeOrHoldValue() public {
        ProtocolTreasuryV1 impl = new ProtocolTreasuryV1();
        ProtocolOwnedLiquidityV1 polImpl = new ProtocolOwnedLiquidityV1();

        // The implementations really are seizable ...
        vm.prank(attacker);
        impl.initialize(attacker);
        vm.prank(attacker);
        polImpl.initialize(attacker);
        assertEq(impl.owner(), attacker);
        assertEq(polImpl.owner(), attacker);

        // ... and it gets them nothing. upgradeToAndCall is onlyProxy (solady CallContextChecker):
        // the only route from "owner of an implementation" to arbitrary code — and thus to
        // selfdestruct or delegatecall — is closed before _authorizeUpgrade is even consulted.
        vm.prank(attacker);
        vm.expectRevert();
        impl.upgradeToAndCall(address(0xDEAD), "");
        vm.prank(attacker);
        vm.expectRevert();
        polImpl.upgradeToAndCall(address(0xDEAD), "");

        assertEq(address(impl).balance, 0);
        assertEq(address(polImpl).balance, 0);

        // A proxy deployed and initialized atomically (the shape DeployCore uses) is unaffected.
        ProtocolTreasuryV1 proxy = ProtocolTreasuryV1(payable(LibClone.deployERC1967(address(impl))));
        proxy.initialize(protocol);
        assertEq(proxy.owner(), protocol, "proxy owner is the protocol, not the impl's squatter");
    }

    // ── D: seizing a CLONE implementation buys nothing ─────────────────────────

    function test_D_seizedCloneImplementationDoesNotReachTheClones() public {
        UniAlignmentVaultFactory f = new UniAlignmentVaultFactory(
            address(0xE7),
            address(0x4444),
            address(0x5555),
            3000,
            60,
            address(0xFEE),
            IVaultPriceValidator(address(0)),
            IAlignmentRegistry(address(0)),
            address(0)
        );
        address impl = f.vaultImplementation();

        // Every check in `initialize` is answered by the CALLER's own registry, so the attacker
        // supplies one that says yes. The seizure itself is real.
        MockAlignmentRegistry reg = new MockAlignmentRegistry();
        address tok = address(new MockEXECToken(1e24));
        reg.setTargetActive(1, true);
        reg.setTokenInTarget(1, tok, true);

        vm.prank(attacker);
        UniAlignmentVault(payable(impl))
            .initialize(
                attacker,
                address(0xE7),
                address(0x4444),
                tok,
                address(0x5555),
                3000,
                60,
                IVaultPriceValidator(address(0)),
                IAlignmentRegistry(address(reg)),
                1,
                attacker
            );
        assertEq(UniAlignmentVault(payable(impl)).owner(), attacker, "impl IS seizable");
        assertEq(UniAlignmentVault(payable(impl)).protocolTreasury(), attacker);

        // ... and it reaches nothing. A clone has its OWN storage: EIP-1167 delegatecalls INTO the
        // impl's code, never its state.
        address clone = LibClone.clone(impl);
        assertEq(UniAlignmentVault(payable(clone)).owner(), address(0), "clone unaffected by impl state");
        assertEq(UniAlignmentVault(payable(clone)).protocolTreasury(), address(0));

        // The impl holds nothing, and carries no selfdestruct/delegatecall to brick the clones with.
        assertEq(impl.balance, 0);

        // A real clone still initializes normally afterwards.
        vm.prank(address(f));
        UniAlignmentVault(payable(clone))
            .initialize(
                address(f),
                address(0xE7),
                address(0x4444),
                tok,
                address(0x5555),
                3000,
                60,
                IVaultPriceValidator(address(0)),
                IAlignmentRegistry(address(reg)),
                1,
                address(0xFEE)
            );
        assertEq(UniAlignmentVault(payable(clone)).owner(), address(f), "seizing the impl did not block a real clone");
    }

    // ── E / L-4: the documented treasury setter is reachable by its owner ──────

    function _zammFactory() internal returns (ZAMMAlignmentVaultFactory) {
        return new ZAMMAlignmentVaultFactory(
            address(0x1111),
            address(0x2222),
            address(0xE7),
            address(0xFEE),
            IVaultPriceValidator(address(0)),
            IAlignmentRegistry(address(0)),
            address(0)
        );
    }

    /// @dev A clone initialized BY the factory, which is the shape `deployVault` produces: the vault's
    ///      owner is the factory and nothing else.
    function _cloneOwnedByFactory(ZAMMAlignmentVaultFactory f) internal returns (address clone) {
        clone = LibClone.clone(f.vaultImplementation());
        IZAMM.PoolKey memory key;
        vm.prank(address(f));
        ZAMMAlignmentVault(payable(clone))
            .initialize(
                address(0x1111),
                address(0x2222),
                address(0xE7),
                address(0x9999),
                key,
                address(0xFEE),
                address(0),
                IAlignmentRegistry(address(0)),
                1
            );
        assertEq(ZAMMAlignmentVault(payable(clone)).owner(), address(f), "factory owns the vault");
    }

    /// @dev The vault's `setProtocolTreasury` is onlyOwner and the factory is the owner, so the
    ///      factory is the only address that could ever reach it. Without a passthrough nobody could,
    ///      while the vault's own docstring promised that "only `setProtocolTreasury` moves the
    ///      destination" — a documented lever no address could pull.
    function test_E_zammTreasuryIsReachableThroughItsOwner() public {
        ZAMMAlignmentVaultFactory f = _zammFactory();
        address clone = _cloneOwnedByFactory(f);
        assertEq(ZAMMAlignmentVault(payable(clone)).protocolTreasury(), address(0xFEE), "born with the sink");

        // Raw-called on purpose: this assertion is what was false before the passthrough existed,
        // and a typed call would have been a compile error rather than a red test.
        (bool ok,) = address(f)
            .call(abi.encodeWithSignature("setVaultProtocolTreasury(address,address)", clone, address(0xC0FFEE)));
        assertTrue(ok, "the factory can reach the vault's documented treasury setter");
        assertEq(ZAMMAlignmentVault(payable(clone)).protocolTreasury(), address(0xC0FFEE), "destination moved");
    }

    /// @dev The passthrough is the factory owner's, and only the factory's own call reaches the vault.
    function test_E_zammTreasuryPassthroughIsOwnerGated() public {
        ZAMMAlignmentVaultFactory f = _zammFactory();
        address clone = _cloneOwnedByFactory(f);

        vm.prank(attacker);
        (bool ok,) =
            address(f).call(abi.encodeWithSignature("setVaultProtocolTreasury(address,address)", clone, address(0xBAD)));
        assertFalse(ok, "the passthrough is the factory owner's");

        // And going at the vault directly still fails: the factory is its only owner.
        vm.prank(attacker);
        vm.expectRevert(Ownable.Unauthorized.selector);
        ZAMMAlignmentVault(payable(clone)).setProtocolTreasury(address(0xBAD));
        assertEq(ZAMMAlignmentVault(payable(clone)).protocolTreasury(), address(0xFEE), "nothing moved");
    }

    /// @dev Cypher and Uni genuinely have no setter — their sink is written once at `initialize`.
    ///      What L-4 names there is a docstring that claimed otherwise, copied from the ZAMM sibling.
    ///      Whether those two families should gain a setter is a separate question and is not touched:
    ///      `test/vaults/ProtocolFeeExitParity.t.sol` still pins the table as it stands.
    function test_E_cypherAndUniStillCarryNoSetter() public {
        CypherAlignmentVault cypher = new CypherAlignmentVault();
        UniAlignmentVault uni = new UniAlignmentVault();

        (bool cypherOk,) = address(cypher).call(abi.encodeWithSignature("setProtocolTreasury(address)", address(0xFEE)));
        (bool uniOk,) = address(uni).call(abi.encodeWithSignature("setProtocolTreasury(address)", address(0xFEE)));
        assertFalse(cypherOk, "CypherAlignmentVault has no setProtocolTreasury");
        assertFalse(uniOk, "UniAlignmentVault has no setProtocolTreasury");
    }

    // ── F / L-3: the vault factories sit under the no-renounce policy ──────────

    function _uniFactory() internal returns (UniAlignmentVaultFactory) {
        return new UniAlignmentVaultFactory(
            address(0xE7),
            address(0x4444),
            address(0x5555),
            3000,
            60,
            address(0xFEE),
            IVaultPriceValidator(address(0)),
            IAlignmentRegistry(address(0)),
            address(0)
        );
    }

    function test_F_allFourVaultFactoriesRefuseRenounce() public {
        UniAlignmentVaultFactory uni = _uniFactory();
        ZAMMAlignmentVaultFactory zamm = new ZAMMAlignmentVaultFactory(
            address(0x1111),
            address(0x2222),
            address(0xE7),
            address(0xFEE),
            IVaultPriceValidator(address(0)),
            IAlignmentRegistry(address(0)),
            address(0)
        );
        AlignmentEndowmentVaultFactory aave = new AlignmentEndowmentVaultFactory(
            address(0xE7), address(0x57A7A), address(0xFEE), address(0x4444), IAlignmentRegistry(address(0))
        );
        CypherAlignmentVaultFactory cypher = new CypherAlignmentVaultFactory(
            address(0xC0DE),
            IVaultPriceValidator(address(0)),
            address(0xA16),
            address(0x2222),
            address(0),
            IAlignmentRegistry(address(0))
        );

        address[4] memory factories = [address(uni), address(zamm), address(aave), address(cypher)];
        for (uint256 i; i < factories.length; i++) {
            assertEq(Ownable(factories[i]).owner(), address(this), "deployer owns it");
            vm.expectRevert(SafeOwnable.RenounceDisabled.selector);
            Ownable(factories[i]).renounceOwnership();
            assertEq(Ownable(factories[i]).owner(), address(this), "still owned after the refusal");

            // The refusal is unconditional, so it is not a question of who is calling: the owner
            // itself cannot renounce, and neither can anyone who ever came to hold the key.
            vm.prank(attacker);
            vm.expectRevert(SafeOwnable.RenounceDisabled.selector);
            Ownable(factories[i]).renounceOwnership();
        }
    }

    /// @dev The capability the renounce used to kill: with the factory still owned, the owner can
    ///      wire a vault's pool key and deploy another vault. This is what L-3 cost permanently.
    function test_F_uniFactoryStaysAbleToWireAndDeploy() public {
        UniAlignmentVaultFactory f = _uniFactory();

        vm.expectRevert(SafeOwnable.RenounceDisabled.selector);
        f.renounceOwnership();

        PoolKey memory k = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(0x9999)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        // Reaches the vault rather than the owner gate: the call fails INSIDE the (nonexistent)
        // vault, not with Unauthorized. That is the whole difference the fix makes.
        vm.expectRevert();
        f.setVaultPoolKey(address(0x1234), k);
        vm.prank(attacker);
        vm.expectRevert(Ownable.Unauthorized.selector);
        f.setVaultPoolKey(address(0x1234), k);
    }

    /// @dev Single-step `transferOwnership` is deliberately kept — `script/MigrateOwnership.s.sol`
    ///      hands these four to the governance Timelock with it, and a Timelock cannot broadcast
    ///      solady's handover request leg. Narrowing this would break the documented migration.
    function test_F_singleStepTransferIsStillAvailableForTheTimelockMigration() public {
        UniAlignmentVaultFactory f = _uniFactory();
        address timelock = address(0x71E10C4);
        f.transferOwnership(timelock);
        assertEq(f.owner(), timelock, "migration path intact");

        // And the new owner inherits the same policy.
        vm.prank(timelock);
        vm.expectRevert(SafeOwnable.RenounceDisabled.selector);
        f.renounceOwnership();
    }

    /// @dev Control: the UUPS contracts refuse it through the same `SafeOwnable` base.
    function test_F_control_uupsRenounceIsBanned() public {
        ProtocolTreasuryV1 t = new ProtocolTreasuryV1();
        t.initialize(address(this));
        vm.expectRevert(SafeOwnable.RenounceDisabled.selector);
        t.renounceOwnership();
        assertEq(t.owner(), address(this), "one policy, nine UUPS contracts and four vault factories");
    }
}
