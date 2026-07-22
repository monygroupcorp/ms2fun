// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test, console, console2 } from "forge-std/Test.sol";
import { ERC1155Factory } from "../../../src/factories/erc1155/ERC1155Factory.sol";
import {
    ERC1155Instance,
    ExceedsSupply,
    EditionNotOpen,
    GatingCheckFailed,
    NoDynamicPricingModule
} from "../../../src/factories/erc1155/ERC1155Instance.sol";
import { DynamicPricingModule } from "../../../src/factories/erc1155/DynamicPricingModule.sol";
import { UniAlignmentVault } from "../../../src/vaults/uni/UniAlignmentVault.sol";
import { MockEXECToken } from "../../mocks/MockEXECToken.sol";
import { MockMasterRegistry } from "../../mocks/MockMasterRegistry.sol";
import { MockZRouter } from "../../mocks/MockZRouter.sol";
import { MockVaultPriceValidator } from "../../mocks/MockVaultPriceValidator.sol";
import { IVaultPriceValidator } from "../../../src/interfaces/IVaultPriceValidator.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { ComponentRegistry } from "../../../src/registry/ComponentRegistry.sol";
import { Currency } from "v4-core/types/Currency.sol";
import { PoolKey } from "v4-core/types/PoolKey.sol";
import { IHooks } from "v4-core/interfaces/IHooks.sol";
import { GlobalMessagingTestBase } from "../../base/GlobalMessagingTestBase.sol";
import { GlobalMessageRegistry } from "../../../src/registry/GlobalMessageRegistry.sol";
import { MockAlignmentRegistry } from "../../mocks/MockAlignmentRegistry.sol";
import { IAlignmentRegistry } from "../../../src/master/interfaces/IAlignmentRegistry.sol";
import { ICreateX, CREATEX } from "../../../src/shared/CreateXConstants.sol";
import { CREATEX_BYTECODE } from "createx-forge/script/CreateX.d.sol";
import { FreeMintParams } from "../../../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../../../src/gating/IGatingModule.sol";
import { MerkleGatingModule } from "../../../src/gating/MerkleGatingModule.sol";
import { MerkleConfig } from "../../../src/gating/IMerkleGatingModule.sol";
import { MerkleAllowlistHelper } from "../../gating/MerkleAllowlistHelper.sol";

contract MockRejectGatingModule {
    function canMint(address, uint256, uint256, uint256, bytes calldata)
        external
        pure
        returns (bool allowed, bool permanent)
    {
        allowed = false;
        permanent = false;
    }
    function onMint(address, uint256, uint256) external { }
}

contract MockAllowGatingModule {
    function canMint(address, uint256, uint256, uint256, bytes calldata)
        external
        pure
        returns (bool allowed, bool permanent)
    {
        allowed = true;
        permanent = false;
    }
    function onMint(address, uint256, uint256) external { }
}

/**
 * @title ERC1155FactoryTest
 * @notice Comprehensive test suite for ERC1155 Factory
 */
contract ERC1155FactoryTest is GlobalMessagingTestBase {
    ERC1155Factory public factory;
    UniAlignmentVault public vault;
    MockEXECToken public token;
    ComponentRegistry public componentRegistry;
    DynamicPricingModule public dynamicPricingModule;
    MockAlignmentRegistry public mockAlignmentRegistry;
    MockMasterRegistry public mockRegistry;

    uint256 internal _saltCounter;

    uint256 constant TARGET_ID = 1;

    address public owner = address(0x1);
    address public creator = address(0x2);
    address public minter1 = address(0x3);
    address public minter2 = address(0x4);
    address public artist = address(0x5);
    address public registryOwner = address(0x6);

    function _nextSalt() internal returns (bytes32) {
        _saltCounter++;
        return bytes32(abi.encodePacked(address(factory), uint8(0x00), bytes11(uint88(_saltCounter))));
    }

    /// @dev Default CreateParams with no gating and no free mint
    function _params(string memory _name, address _creator, address _vault)
        internal
        pure
        returns (ERC1155Factory.CreateParams memory)
    {
        return ERC1155Factory.CreateParams({
            name: _name,
            metadataURI: "ipfs://test",
            creator: _creator,
            vault: _vault,
            styleUri: "",
            gatingModule: address(0),
            freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
        });
    }

    function setUp() public {
        vm.startPrank(owner);
        vm.etch(CREATEX, CREATEX_BYTECODE);

        // Deploy mock token for vault
        token = new MockEXECToken(1000000e18);

        // Deploy mock alignment registry
        mockAlignmentRegistry = new MockAlignmentRegistry();
        mockAlignmentRegistry.setTargetActive(TARGET_ID, true);
        mockAlignmentRegistry.setTokenInTarget(TARGET_ID, address(token), true);

        // Deploy vault (WETH, PoolManager, V3Router, V2Router, V2Factory, V3Factory, AlignmentToken)
        {
            UniAlignmentVault _impl = new UniAlignmentVault();
            vault = UniAlignmentVault(payable(LibClone.clone(address(_impl))));
            vault.initialize(
                owner,
                address(0x2222222222222222222222222222222222222222), // WETH
                address(0x4444444444444444444444444444444444444444), // V4 pool manager
                address(token), // alignment target
                address(new MockZRouter()),
                3000,
                60,
                IVaultPriceValidator(address(new MockVaultPriceValidator())),
                IAlignmentRegistry(address(mockAlignmentRegistry)),
                TARGET_ID
            );
        }

        // Set V4 pool key
        // H-02: Hook requires native ETH (address(0)), not WETH
        PoolKey memory mockPoolKey = PoolKey({
            currency0: Currency.wrap(address(0)), // Native ETH
            currency1: Currency.wrap(address(token)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        vault.setV4PoolKey(mockPoolKey);

        // Create a mock registry that doesn't revert on registerInstance/registerFactory
        mockRegistry = new MockMasterRegistry();

        // Set up global messaging
        _setUpGlobalMessaging(address(mockRegistry));

        // Deploy ComponentRegistry
        ComponentRegistry compRegImpl = new ComponentRegistry();
        address compRegProxy = LibClone.deployERC1967(address(compRegImpl));
        componentRegistry = ComponentRegistry(compRegProxy);
        componentRegistry.initialize(registryOwner);

        // Deploy factory (no instanceTemplate param in new constructor)
        factory = new ERC1155Factory(
            address(mockRegistry), address(globalRegistry), address(componentRegistry), address(0xBEEF)
        );

        // Deploy and wire up the dynamic pricing module
        vm.startPrank(registryOwner);
        dynamicPricingModule = new DynamicPricingModule();
        componentRegistry.approveComponent(
            address(dynamicPricingModule), keccak256("dynamic_pricing"), "ExponentialPricing"
        );
        vm.stopPrank();

        vm.startPrank(owner);
        factory.setDynamicPricingModule(address(dynamicPricingModule));
        vm.stopPrank();

        // Authorize creator and artist as agents for addEdition calls
        mockRegistry.setAgent(creator, true);
        mockRegistry.setAgent(artist, true);

        vm.stopPrank();
    }

    /// @dev Helper: creates instance. agentDelegation is auto-enabled when created by an agent.
    ///      Since creator == msg.sender == params.creator, agentDelegation is NOT auto-enabled.
    ///      Call setAgentDelegation(true) separately if needed, or use _createInstanceAndEnableAgent.
    function _createInstanceAndEnableAgent(string memory _name, address _creator, address _vault)
        internal
        returns (address instance)
    {
        instance = factory.createInstance{ value: 0 }(_nextSalt(), _params(_name, _creator, _vault));
        vm.prank(_creator);
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
    }

    function test_FactoryCreation() public view {
        // Factory should have been created and linked to the mock registry
        assertEq(address(factory.masterRegistry()), address(mockRegistry));
        assertEq(factory.globalMessageRegistry(), address(globalRegistry));
    }

    function test_computeInstanceAddress() public {
        bytes32 salt = _nextSalt();
        // Salt is bound to the creator (deployer) — preview must pass the same creator.
        address predicted = factory.computeInstanceAddress(creator, salt);

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        address actual = factory.createInstance{ value: 0 }(salt, _params("PredictTest", creator, address(vault)));
        assertEq(actual, predicted, "Instance should deploy at predicted CREATE3 address");
    }

    function test_CreateInstance() public {
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);

        address instance = factory.createInstance{ value: 0.01 ether }(
            _nextSalt(),
            ERC1155Factory.CreateParams({
                name: "Test Collection",
                metadataURI: "ipfs://test",
                creator: creator,
                vault: address(vault),
                styleUri: "",
                gatingModule: address(0),
                freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            })
        );

        assertTrue(instance != address(0));

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));
        assertEq(instanceContract.name(), "Test Collection");
        assertEq(instanceContract.creator(), creator);
        assertEq(address(instanceContract.vault()), address(vault));

        vm.stopPrank();
    }

    function test_CreateInstance_NoFeeRequired() public {
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);

        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        assertTrue(instance != address(0));

        vm.stopPrank();
    }

    function test_CreateInstance_FeeGoesDirectlyToTreasury() public {
        address treasury = address(0xBEEF);
        vm.startPrank(owner);
        factory.setProtocolTreasury(treasury);
        vm.stopPrank();

        uint256 fee = 0.01 ether;
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);
        factory.createInstance{ value: fee }(_nextSalt(), _params("Fee Collection", creator, address(vault)));
        vm.stopPrank();

        // Fee goes directly to treasury — factory holds no ETH
        assertEq(treasury.balance, fee, "Treasury should receive fee directly");
        assertEq(address(factory).balance, 0, "Factory must hold no ETH");
    }

    function test_AddEdition_Unlimited() public {
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);

        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);

        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 1",
                0.1 ether,
                0, // Unlimited
                "ipfs://piece1",
                ERC1155Instance.PricingModel.UNLIMITED,
                0,
                0 // openTime
            );

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));
        ERC1155Instance.Edition memory edition = instanceContract.getEdition(1);
        assertEq(edition.id, 1);
        assertEq(edition.pieceTitle, "Piece 1");
        assertEq(edition.basePrice, 0.1 ether);
        assertEq(edition.supply, 0);
        assertEq(uint256(edition.pricingModel), uint256(ERC1155Instance.PricingModel.UNLIMITED));

        vm.stopPrank();
    }

    function test_AddEdition_LimitedFixed() public {
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);

        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);

        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 2",
                0.2 ether,
                100, // Limited
                "ipfs://piece2",
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0 // openTime
            );

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));
        ERC1155Instance.Edition memory edition = instanceContract.getEdition(1);
        assertEq(uint256(edition.pricingModel), uint256(ERC1155Instance.PricingModel.LIMITED_FIXED));
        assertEq(edition.supply, 100);

        vm.stopPrank();
    }

    function test_AddEdition_LimitedDynamic() public {
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);

        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);

        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 3",
                0.1 ether,
                50, // Limited
                "ipfs://piece3",
                ERC1155Instance.PricingModel.LIMITED_DYNAMIC,
                100, // 1% increase per mint
                0 // openTime
            );

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));
        ERC1155Instance.Edition memory edition = instanceContract.getEdition(1);
        assertEq(uint256(edition.pricingModel), uint256(ERC1155Instance.PricingModel.LIMITED_DYNAMIC));
        assertEq(edition.priceIncreaseRate, 100);

        vm.stopPrank();
    }

    function test_Mint_Unlimited() public {
        vm.deal(creator, 1 ether);
        vm.deal(minter1, 10 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 1",
                0.1 ether,
                0, // Unlimited
                "ipfs://piece1",
                ERC1155Instance.PricingModel.UNLIMITED,
                0,
                0 // openTime
            );
        vm.stopPrank();

        vm.startPrank(minter1);
        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        // Mint 5 tokens
        instanceContract.mint{ value: 0.5 ether }(1, 5, bytes(""), bytes(""), 0);

        assertEq(instanceContract.balanceOf(minter1, 1), 5);
        ERC1155Instance.Edition memory edition = instanceContract.getEdition(1);
        assertEq(edition.minted, 5);

        vm.stopPrank();
    }

    function test_Mint_LimitedFixed() public {
        vm.deal(creator, 1 ether);
        vm.deal(minter1, 10 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 2",
                0.2 ether,
                10, // Limited to 10
                "ipfs://piece2",
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0 // openTime
            );
        vm.stopPrank();

        vm.startPrank(minter1);
        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        // Mint 5 tokens
        instanceContract.mint{ value: 1 ether }(1, 5, bytes(""), bytes(""), 0);
        assertEq(instanceContract.balanceOf(minter1, 1), 5);
        ERC1155Instance.Edition memory edition1 = instanceContract.getEdition(1);
        assertEq(edition1.minted, 5);

        // Try to mint 6 more (would exceed supply)
        vm.expectRevert(ExceedsSupply.selector);
        instanceContract.mint{ value: 1.2 ether }(1, 6, bytes(""), bytes(""), 0);

        // Mint remaining 5
        instanceContract.mint{ value: 1 ether }(1, 5, bytes(""), bytes(""), 0);
        ERC1155Instance.Edition memory edition2 = instanceContract.getEdition(1);
        assertEq(edition2.minted, 10);

        vm.stopPrank();
    }

    function test_Mint_LimitedDynamic() public {
        vm.deal(creator, 1 ether);
        vm.deal(minter1, 10 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 3",
                0.1 ether,
                10, // Limited to 10
                "ipfs://piece3",
                ERC1155Instance.PricingModel.LIMITED_DYNAMIC,
                100, // 1% increase per mint
                0 // openTime
            );
        vm.stopPrank();

        vm.startPrank(minter1);
        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        // Get current price (should be base price for first mint)
        uint256 price1 = instanceContract.getCurrentPrice(1);
        assertEq(price1, 0.1 ether);

        // Mint 1 token
        instanceContract.mint{ value: 0.2 ether }(1, 1, bytes(""), bytes(""), 0);

        // Price should increase for next mint
        uint256 price2 = instanceContract.getCurrentPrice(1);
        assertGt(price2, price1);

        vm.stopPrank();
    }

    function test_MintWithMessage() public {
        vm.deal(creator, 1 ether);
        vm.deal(minter1, 10 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 1",
                0.1 ether,
                0,
                "ipfs://piece1",
                ERC1155Instance.PricingModel.UNLIMITED,
                0,
                0 // openTime
            );
        vm.stopPrank();

        vm.startPrank(minter1);
        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        instanceContract.mint{ value: 0.1 ether }(1, 1, bytes(""), _buildPostMessage("Hello from minter!"), 0);

        // Check message count in global registry
        _assertMessageCount(1);

        vm.stopPrank();
    }

    function test_Withdraw_Tax() public {
        address treasury = address(0xF00D);

        // Wire up a named treasury so protocol cut is non-zero
        vm.prank(owner);
        factory.setProtocolTreasury(treasury);

        vm.deal(creator, 1 ether);
        vm.deal(minter1, 10 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 1",
                1 ether,
                0,
                "ipfs://piece1",
                ERC1155Instance.PricingModel.UNLIMITED,
                0,
                0 // openTime
            );
        vm.stopPrank();

        vm.startPrank(minter1);
        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));
        instanceContract.mint{ value: 1 ether }(1, 1, bytes(""), bytes(""), 0);
        vm.stopPrank();

        uint256 treasuryBefore = treasury.balance;
        uint256 vaultBefore = address(vault).balance;
        uint256 creatorBefore = creator.balance;

        vm.startPrank(creator);
        // Withdraw 1 ETH — UniAlignmentVault ("UniswapV4LP") is liquidity-family, so the split flips
        // to 1% protocol / 19% vault / 80% creator (family-aware split, ADR-0003).
        instanceContract.withdraw(1 ether);
        vm.stopPrank();

        uint256 amount = 1 ether;
        uint256 expectedProtocol = amount / 100; // 1%
        uint256 expectedVault = (amount * 19) / 100; // 19%
        uint256 expectedCreator = amount - expectedProtocol - expectedVault; // 80% (absorbs dust)

        assertEq(treasury.balance - treasuryBefore, expectedProtocol, "protocol cut should be 1%");
        assertEq(address(vault).balance - vaultBefore, expectedVault, "vault cut should be 19%");
        assertEq(creator.balance - creatorBefore, expectedCreator, "creator cut should be ~80%");
    }

    function test_GetMessagesBatch() public {
        vm.deal(creator, 1 ether);
        vm.deal(minter1, 10 ether);
        vm.deal(minter2, 10 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 1",
                0.1 ether,
                0,
                "ipfs://piece1",
                ERC1155Instance.PricingModel.UNLIMITED,
                0,
                0 // openTime
            );
        vm.stopPrank();

        vm.startPrank(minter1);
        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));
        instanceContract.mint{ value: 0.1 ether }(1, 1, bytes(""), _buildPostMessage("Message 1"), 0);
        vm.stopPrank();

        vm.startPrank(minter2);
        instanceContract.mint{ value: 0.1 ether }(1, 1, bytes(""), _buildPostMessage("Message 2"), 0);
        vm.stopPrank();

        // Verify message count (messages are now event-only)
        _assertMessageCount(2);
    }

    function test_UpdateEditionMetadata() public {
        vm.deal(creator, 1 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 1",
                0.1 ether,
                0,
                "ipfs://piece1",
                ERC1155Instance.PricingModel.UNLIMITED,
                0,
                0 // openTime
            );

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));
        instanceContract.updateEditionMetadata(1, "ipfs://piece1-updated");

        ERC1155Instance.Edition memory edition = instanceContract.getEdition(1);
        assertEq(edition.metadataURI, "ipfs://piece1-updated");

        vm.stopPrank();
    }

    function test_CalculateMintCost_Dynamic() public {
        vm.deal(creator, 1 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 3",
                0.1 ether,
                10,
                "ipfs://piece3",
                ERC1155Instance.PricingModel.LIMITED_DYNAMIC,
                100, // 1% increase
                0 // openTime
            );

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        // Calculate cost for minting 3 tokens
        uint256 cost = instanceContract.calculateMintCost(1, 3);
        assertGt(cost, 0.3 ether); // Should be more than base price * 3 due to increases

        vm.stopPrank();
    }

    function test_GetEditionMetadata() public {
        vm.deal(creator, 1 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Test Piece",
                0.1 ether,
                100,
                "ipfs://test-piece",
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0 // openTime
            );

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        ERC1155Instance.Edition memory ed = instanceContract.getEdition(1);
        uint256 currentPrice = instanceContract.getCurrentPrice(1);

        assertEq(ed.id, 1);
        assertEq(ed.pieceTitle, "Test Piece");
        assertEq(ed.basePrice, 0.1 ether);
        assertEq(currentPrice, 0.1 ether);
        assertEq(ed.supply, 100);
        assertEq(ed.minted, 0);
        assertEq(ed.metadataURI, "ipfs://test-piece");
        assertEq(uint256(ed.pricingModel), uint256(ERC1155Instance.PricingModel.LIMITED_FIXED));
        assertEq(ed.priceIncreaseRate, 0);

        vm.stopPrank();
    }

    function test_GetAllEditionIds() public {
        vm.deal(creator, 1 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition("Piece 1", 0.1 ether, 0, "ipfs://1", ERC1155Instance.PricingModel.UNLIMITED, 0, 0);
        ERC1155Instance(payable(instance))
            .addEdition("Piece 2", 0.2 ether, 100, "ipfs://2", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0);
        ERC1155Instance(payable(instance))
            .addEdition("Piece 3", 0.3 ether, 50, "ipfs://3", ERC1155Instance.PricingModel.LIMITED_DYNAMIC, 100, 0);

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        uint256[] memory editionIds = instanceContract.getAllEditionIds();
        assertEq(editionIds.length, 3);
        assertEq(editionIds[0], 1);
        assertEq(editionIds[1], 2);
        assertEq(editionIds[2], 3);

        assertEq(instanceContract.getEditionCount(), 3);

        vm.stopPrank();
    }

    function test_GetEditionsBatch() public {
        vm.deal(creator, 1 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition("Piece 1", 0.1 ether, 0, "ipfs://1", ERC1155Instance.PricingModel.UNLIMITED, 0, 0);
        ERC1155Instance(payable(instance))
            .addEdition("Piece 2", 0.2 ether, 100, "ipfs://2", ERC1155Instance.PricingModel.LIMITED_FIXED, 0, 0);

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        ERC1155Instance.Edition memory ed1 = instanceContract.getEdition(1);
        ERC1155Instance.Edition memory ed2 = instanceContract.getEdition(2);

        assertEq(ed1.id, 1);
        assertEq(ed1.pieceTitle, "Piece 1");
        assertEq(ed1.basePrice, 0.1 ether);
        assertEq(ed2.id, 2);
        assertEq(ed2.pieceTitle, "Piece 2");
        assertEq(ed2.basePrice, 0.2 ether);

        vm.stopPrank();
    }

    function test_GetInstanceMetadata() public {
        vm.deal(creator, 1 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        assertEq(instanceContract.name(), "Test Collection");
        assertEq(instanceContract.creator(), creator);
        assertEq(instanceContract.factory(), address(factory));
        assertEq(address(instanceContract.vault()), address(vault));
        assertEq(instanceContract.getEditionCount(), 0);
        assertEq(instanceContract.totalProceeds(), 0);

        vm.stopPrank();
    }

    function test_GetPricingInfo() public {
        vm.deal(creator, 1 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 1",
                0.1 ether,
                100,
                "ipfs://piece1",
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0 // openTime
            );

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        ERC1155Instance.Edition memory ed = instanceContract.getEdition(1);
        uint256 currentPrice = instanceContract.getCurrentPrice(1);
        uint256 available = ed.supply > ed.minted ? ed.supply - ed.minted : 0;

        assertEq(ed.basePrice, 0.1 ether);
        assertEq(currentPrice, 0.1 ether);
        assertEq(uint256(ed.pricingModel), uint256(ERC1155Instance.PricingModel.LIMITED_FIXED));
        assertEq(ed.supply, 100);
        assertEq(ed.minted, 0);
        assertEq(available, 100);

        vm.stopPrank();
    }

    function test_GetMintStats() public {
        vm.deal(creator, 1 ether);
        vm.deal(minter1, 10 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 1",
                0.1 ether,
                10,
                "ipfs://piece1",
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0 // openTime
            );
        vm.stopPrank();

        vm.startPrank(minter1);
        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));
        instanceContract.mint{ value: 0.5 ether }(1, 5, bytes(""), bytes(""), 0);
        vm.stopPrank();

        ERC1155Instance.Edition memory ed = instanceContract.getEdition(1);
        uint256 available = ed.supply > ed.minted ? ed.supply - ed.minted : 0;
        bool isSoldOut = ed.minted >= ed.supply;

        assertEq(ed.minted, 5);
        assertEq(ed.supply, 10);
        assertEq(available, 5);
        assertFalse(isSoldOut);
    }

    // ========================
    // Protocol Treasury Tests
    // ========================

    function test_SetProtocolTreasury() public {
        vm.startPrank(owner);
        factory.setProtocolTreasury(address(0xBEEF));
        assertEq(factory.protocolTreasury(), address(0xBEEF));
        vm.stopPrank();
    }

    function test_SetProtocolTreasury_RevertNonOwner() public {
        vm.startPrank(creator);
        vm.expectRevert();
        factory.setProtocolTreasury(address(0xBEEF));
        vm.stopPrank();
    }

    function test_SetProtocolTreasury_RevertZeroAddress() public {
        vm.startPrank(owner);
        vm.expectRevert(ERC1155Factory.InvalidAddress.selector);
        factory.setProtocolTreasury(address(0));
        vm.stopPrank();
    }

    function test_InstanceHasProtocolTreasury() public {
        vm.startPrank(owner);
        factory.setProtocolTreasury(address(0xBEEF));
        vm.stopPrank();

        vm.deal(creator, 1 ether);
        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Treasury Test", creator, address(vault)));
        vm.stopPrank();

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));
        assertEq(instanceContract.protocolTreasury(), address(0xBEEF));
    }

    // ========================

    function test_EditionExists() public {
        vm.deal(creator, 1 ether);

        vm.startPrank(creator);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Test Collection", creator, address(vault)));
        ERC1155Instance(payable(instance)).setAgentDelegation(true);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Piece 1",
                0.1 ether,
                100,
                "ipfs://piece1",
                ERC1155Instance.PricingModel.LIMITED_FIXED,
                0,
                0 // openTime
            );

        ERC1155Instance instanceContract = ERC1155Instance(payable(instance));

        assertTrue(1 < instanceContract.nextEditionId()); // edition 1 was added
        assertFalse(999 < instanceContract.nextEditionId()); // edition 999 was never added

        vm.stopPrank();
    }

    function test_createInstance_standardTier() public {
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);

        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("Standard Collection", creator, address(vault)));

        assertTrue(instance != address(0), "Should create instance");

        vm.stopPrank();
    }

    // ── ERC1155Instance gating and openTime ───────────────────────────────────

    function _deployGatedInstance(address gatingModuleAddr) internal returns (address instance) {
        // Register the gating module in componentRegistry before creating instance
        if (gatingModuleAddr != address(0)) {
            vm.prank(registryOwner);
            componentRegistry.approveComponent(gatingModuleAddr, keccak256("gating"), "TestGating");
        }

        vm.deal(artist, 1 ether);
        vm.prank(artist);
        instance = factory.createInstance{ value: 0 }(
            _nextSalt(),
            ERC1155Factory.CreateParams({
                name: "GatedProject",
                metadataURI: "ipfs://Qm",
                creator: artist,
                vault: address(vault),
                styleUri: "",
                gatingModule: gatingModuleAddr,
                freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            })
        );
    }

    function test_instance_openTime_blocksMintBeforeOpen() public {
        address instance = _deployGatedInstance(address(0));
        ERC1155Instance inst = ERC1155Instance(payable(instance));

        // Add edition with openTime 1 hour from now
        uint256 openTime = block.timestamp + 1 hours;
        vm.prank(artist);
        inst.addEdition("Art 1", 0.01 ether, 0, "ipfs://art1", ERC1155Instance.PricingModel.UNLIMITED, 0, openTime);
        uint256 editionId = inst.nextEditionId() - 1;

        // Attempt to mint before openTime
        vm.expectRevert(EditionNotOpen.selector);
        inst.mint{ value: 0.01 ether }(editionId, 1, bytes(""), "", 0);
    }

    function test_instance_openTime_allowsMintAfterOpen() public {
        address instance = _deployGatedInstance(address(0));
        ERC1155Instance inst = ERC1155Instance(payable(instance));

        uint256 openTime = block.timestamp + 1 hours;
        vm.prank(artist);
        inst.addEdition("Art 1", 0.01 ether, 0, "ipfs://art1", ERC1155Instance.PricingModel.UNLIMITED, 0, openTime);
        uint256 editionId = inst.nextEditionId() - 1;

        // Warp past openTime
        vm.warp(block.timestamp + 2 hours);

        // Mint should succeed
        inst.mint{ value: 0.01 ether }(editionId, 1, bytes(""), "", 0);
        assertEq(inst.balanceOf(address(this), editionId), 1);
    }

    function test_instance_openTime_zeroMeansAlwaysOpen() public {
        address instance = _deployGatedInstance(address(0));
        ERC1155Instance inst = ERC1155Instance(payable(instance));

        // openTime = 0 → no time gate
        vm.prank(artist);
        inst.addEdition("Art 1", 0.01 ether, 0, "ipfs://art1", ERC1155Instance.PricingModel.UNLIMITED, 0, 0);
        uint256 editionId = inst.nextEditionId() - 1;

        inst.mint{ value: 0.01 ether }(editionId, 1, bytes(""), "", 0);
        assertEq(inst.balanceOf(address(this), editionId), 1);
    }

    function test_instance_gating_blocksMintOnFailedCheck() public {
        MockRejectGatingModule mockModule = new MockRejectGatingModule();

        address instance = _deployGatedInstance(address(mockModule));
        ERC1155Instance inst = ERC1155Instance(payable(instance));

        vm.prank(artist);
        inst.addEdition("Art 1", 0.01 ether, 0, "ipfs://art1", ERC1155Instance.PricingModel.UNLIMITED, 0, 0);
        uint256 editionId = inst.nextEditionId() - 1;

        vm.expectRevert(GatingCheckFailed.selector);
        inst.mint{ value: 0.01 ether }(editionId, 1, bytes(""), "", 0);
    }

    function test_instance_gating_allowsMintOnPassingCheck() public {
        MockAllowGatingModule mockModule = new MockAllowGatingModule();

        address instance = _deployGatedInstance(address(mockModule));
        ERC1155Instance inst = ERC1155Instance(payable(instance));

        vm.prank(artist);
        inst.addEdition("Art 1", 0.01 ether, 0, "ipfs://art1", ERC1155Instance.PricingModel.UNLIMITED, 0, 0);
        uint256 editionId = inst.nextEditionId() - 1;

        inst.mint{ value: 0.01 ether }(editionId, 1, bytes(""), "", 0);
        assertEq(inst.balanceOf(address(this), editionId), 1);
    }

    // ── ERC1155Factory gating wiring ──────────────────────────────────────────

    function test_factory_createInstanceWithGating_revertsOnUnapprovedModule() public {
        address unapprovedModule = address(0xBAD);

        vm.deal(artist, 1 ether);
        vm.prank(artist);
        vm.expectRevert(ERC1155Factory.UnapprovedComponent.selector);
        factory.createInstance{ value: 0 }(
            _nextSalt(),
            ERC1155Factory.CreateParams({
                name: "TestProject",
                metadataURI: "ipfs://Qm",
                creator: artist,
                vault: address(vault),
                styleUri: "",
                gatingModule: unapprovedModule,
                freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            })
        );
    }

    function test_factory_createInstanceWithGating_succeedsWithApprovedModule() public {
        address mockModule = address(new MockAllowGatingModule());

        vm.prank(registryOwner);
        componentRegistry.approveComponent(mockModule, keccak256("gating"), "MockGating");

        vm.deal(artist, 1 ether);
        vm.prank(artist);
        address instance = factory.createInstance{ value: 0 }(
            _nextSalt(),
            ERC1155Factory.CreateParams({
                name: "GatedProject",
                metadataURI: "ipfs://Qm",
                creator: artist,
                vault: address(vault),
                styleUri: "",
                gatingModule: mockModule,
                freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            })
        );

        assertTrue(instance != address(0));
        assertEq(address(ERC1155Instance(payable(instance)).gatingModule()), mockModule);
    }

    // NOTE: create-time gating config (the old `createInstance(..., TierConfig)` overload) was removed
    // with PasswordTierGatingModule — the factory now attaches a gating module but threads no config.
    // The post-shed model (module attached at create, config authored post-create by the owner) is
    // exercised end-to-end by the Merkle allowlist tests below (`_createMerkleInstance` + `_configMerkle`).

    function test_factory_createInstance_noGating() public {
        vm.deal(artist, 1 ether);
        vm.prank(artist);
        address instance =
            factory.createInstance{ value: 0 }(_nextSalt(), _params("OpenProject", artist, address(vault)));
        assertTrue(instance != address(0));
        assertEq(address(ERC1155Instance(payable(instance)).gatingModule()), address(0));
    }

    function test_factory_addEdition_withOpenTime() public {
        vm.deal(artist, 1 ether);
        vm.prank(artist);
        address instance = factory.createInstance{ value: 0 }(_nextSalt(), _params("Project", artist, address(vault)));

        uint256 futureOpen = block.timestamp + 1 days;
        vm.prank(artist);
        ERC1155Instance(payable(instance))
            .addEdition("Art 1", 0.01 ether, 0, "ipfs://art1", ERC1155Instance.PricingModel.UNLIMITED, 0, futureOpen);

        // Verify openTime stored on edition
        ERC1155Instance.Edition memory ed = ERC1155Instance(payable(instance)).getEdition(1);
        assertEq(ed.openTime, futureOpen);
    }

    function test_addEdition_limitedDynamic_revertsWithoutModule() public {
        // Deploy a fresh factory with no dynamic pricing module set
        ERC1155Factory bareFactory = new ERC1155Factory(
            address(mockRegistry), address(globalRegistry), address(componentRegistry), address(0xBEEF)
        );
        vm.deal(creator, 1 ether);
        vm.startPrank(creator);
        address instance = bareFactory.createInstance{ value: 0 }(
            _nextSalt(),
            ERC1155Factory.CreateParams({
                name: "Test",
                metadataURI: "ipfs://test",
                creator: creator,
                vault: address(vault),
                styleUri: "",
                gatingModule: address(0),
                freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
            })
        );

        vm.expectRevert(NoDynamicPricingModule.selector);
        ERC1155Instance(payable(instance))
            .addEdition(
                "Dynamic Piece", 0.1 ether, 100, "ipfs://piece", ERC1155Instance.PricingModel.LIMITED_DYNAMIC, 100, 0
            );
        vm.stopPrank();
    }

    function test_setDynamicPricingModule_revertsUnapproved() public {
        address unapproved = address(0xDEAD);
        vm.startPrank(owner);
        vm.expectRevert(ERC1155Factory.UnapprovedComponent.selector);
        factory.setDynamicPricingModule(unapproved);
        vm.stopPrank();
    }

    function test_setDynamicPricingModule_acceptsZeroAddress() public {
        vm.startPrank(owner);
        factory.setDynamicPricingModule(address(0));
        assertEq(factory.dynamicPricingModule(), address(0));
        vm.stopPrank();
    }

    /// @dev F6: the deployment salt is bound to the creator, so the same salt resolves to a
    ///      different deterministic address per creator — a front-runner cannot squat the victim's
    ///      address by copying their salt.
    function test_F6_SaltBoundToCreator_DifferentPerCaller() public view {
        bytes32 salt = bytes32(uint256(0xABCDEF));
        address forCreator = factory.computeInstanceAddress(creator, salt);
        address forAttacker = factory.computeInstanceAddress(address(0xBAD), salt);
        assertTrue(forCreator != forAttacker, "same salt must map to different address per creator");
    }

    // ┌───────────────────────────────────────────────────────────────────────────┐
    // │   Merkle allowlist gating — end-to-end through a real ERC1155 instance      │
    // └───────────────────────────────────────────────────────────────────────────┘

    function _deployMerkle() internal returns (MerkleGatingModule m) {
        m = new MerkleGatingModule(address(mockRegistry));
        vm.prank(registryOwner);
        componentRegistry.approveComponent(address(m), keccak256("gating"), "Merkle Allowlist Gating");
    }

    /// @dev allowlist: minter1 cap 3, minter2 cap 1.
    function _merkleList() internal view returns (MerkleAllowlistHelper.Entry[] memory e) {
        e = new MerkleAllowlistHelper.Entry[](2);
        e[0] = MerkleAllowlistHelper.Entry(minter1, 3);
        e[1] = MerkleAllowlistHelper.Entry(minter2, 1);
    }

    function _createMerkleInstance(address merkle, uint256 allocation, GatingScope scope)
        internal
        returns (address instance)
    {
        vm.prank(creator);
        instance = factory.createInstance{ value: 0 }(
            _nextSalt(),
            ERC1155Factory.CreateParams({
                name: string(abi.encodePacked("Merkle", vm.toString(_saltCounter))),
                metadataURI: "ipfs://m",
                creator: creator,
                vault: address(vault),
                styleUri: "",
                gatingModule: merkle,
                freeMint: FreeMintParams({ allocation: allocation, scope: scope })
            })
        );
        // Edition 1: unlimited, fixed price 0.01 ETH, open immediately.
        vm.prank(creator);
        ERC1155Instance(payable(instance))
            .addEdition("Piece", 0.01 ether, 0, "ipfs://p", ERC1155Instance.PricingModel.UNLIMITED, 0, 0);
    }

    function _configMerkle(MerkleGatingModule merkle, address instance, uint256 editionId, bytes32 root) internal {
        bytes32[] memory roots = new bytes32[](1);
        roots[0] = root;
        uint256[] memory times = new uint256[](1);
        times[0] = 0;
        vm.prank(creator);
        merkle.configureFor(instance, MerkleConfig({ editionId: editionId, roots: roots, tierOpenTimes: times }));
    }

    function test_merkle_freePath_endToEnd() public {
        MerkleGatingModule merkle = _deployMerkle();
        MerkleAllowlistHelper helper = new MerkleAllowlistHelper();
        (bytes32 root, bytes32[] memory proof, uint256 q) = helper.build(_merkleList(), 0); // minter1
        bytes memory data = helper.encodeData(0, q, proof);

        address instance = _createMerkleInstance(address(merkle), 5, GatingScope.BOTH);
        _configMerkle(merkle, instance, 1, root);

        // Allowlisted minter1 claims the free mint.
        vm.prank(minter1);
        ERC1155Instance(payable(instance)).claimFreeMint(1, data);
        assertEq(ERC1155Instance(payable(instance)).balanceOf(minter1, 1), 1);
        assertEq(merkle.claimed(instance, 1, minter1), 1);

        // A non-allowlisted intruder replaying minter1's proof is rejected.
        address intruder = address(0x9999);
        vm.prank(intruder);
        vm.expectRevert(MerkleGatingModule.InvalidProof.selector);
        ERC1155Instance(payable(instance)).claimFreeMint(1, data);
    }

    function test_merkle_paidPath_endToEnd_withCumulativeCap() public {
        MerkleGatingModule merkle = _deployMerkle();
        MerkleAllowlistHelper helper = new MerkleAllowlistHelper();
        (bytes32 root, bytes32[] memory proof, uint256 q) = helper.build(_merkleList(), 0); // minter1 cap 3
        bytes memory data = helper.encodeData(0, q, proof);

        address instance = _createMerkleInstance(address(merkle), 0, GatingScope.BOTH);
        _configMerkle(merkle, instance, 1, root);

        vm.deal(minter1, 1 ether);
        vm.prank(minter1);
        ERC1155Instance(payable(instance)).mint{ value: 0.02 ether }(1, 2, data, "", 0);
        assertEq(ERC1155Instance(payable(instance)).balanceOf(minter1, 1), 2);

        // cumulative 2 + 2 = 4 > cap 3 → module reverts.
        vm.prank(minter1);
        vm.expectRevert(MerkleGatingModule.QtyCapExceeded.selector);
        ERC1155Instance(payable(instance)).mint{ value: 0.02 ether }(1, 2, data, "", 0);

        // wrong proof on paid path rejected too.
        address intruder = address(0x9999);
        vm.deal(intruder, 1 ether);
        vm.prank(intruder);
        vm.expectRevert(MerkleGatingModule.InvalidProof.selector);
        ERC1155Instance(payable(instance)).mint{ value: 0.01 ether }(1, 1, data, "", 0);
    }

    function test_merkle_scope_paidOnly_freePathOpen() public {
        // PAID_ONLY: the free-mint path is NOT gated — a non-allowlisted user may claim it FCFS.
        MerkleGatingModule merkle = _deployMerkle();
        MerkleAllowlistHelper helper = new MerkleAllowlistHelper();
        (bytes32 root,,) = helper.build(_merkleList(), 0);

        address instance = _createMerkleInstance(address(merkle), 5, GatingScope.PAID_ONLY);
        _configMerkle(merkle, instance, 1, root);

        address intruder = address(0x9999); // NOT on the allowlist
        vm.prank(intruder);
        ERC1155Instance(payable(instance)).claimFreeMint(1, bytes(""));
        assertEq(ERC1155Instance(payable(instance)).balanceOf(intruder, 1), 1);
    }

    // ============================================================
    // noesis-038 — tag-scoped approval (§3.1)
    // An approved-but-wrong-typed module must not pass a foreign slot.
    // ============================================================

    function test_tagScope_gatingSlot_rejectsWrongTag() public {
        // A module approved under LIQUIDITY_DEPLOYER, passed into the gating slot, must revert.
        MockAllowGatingModule wrongTag = new MockAllowGatingModule();
        vm.prank(registryOwner);
        componentRegistry.approveComponent(address(wrongTag), keccak256("liquidity"), "LiquidityTaggedMod");

        ERC1155Factory.CreateParams memory p = _params("GateWrong", creator, address(vault));
        p.gatingModule = address(wrongTag);

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        vm.expectRevert(ERC1155Factory.UnapprovedComponent.selector);
        factory.createInstance(_nextSalt(), p);
    }

    function test_tagScope_gatingSlot_acceptsGatingTag() public {
        // The same module, approved under GATING, passes the slot and deploys (happy path unchanged).
        MockAllowGatingModule rightTag = new MockAllowGatingModule();
        vm.prank(registryOwner);
        componentRegistry.approveComponent(address(rightTag), keccak256("gating"), "GatingTaggedMod");

        ERC1155Factory.CreateParams memory p = _params("GateRight", creator, address(vault));
        p.gatingModule = address(rightTag);

        vm.deal(creator, 1 ether);
        vm.prank(creator);
        address instance = factory.createInstance(_nextSalt(), p);
        assertTrue(instance != address(0), "right-tag gating module should deploy");
    }

    function test_tagScope_dynamicPricingSlot_rejectsWrongTag() public {
        // A module approved under GATING, set as the dynamic-pricing module, must revert.
        DynamicPricingModule wrongTag = new DynamicPricingModule();
        vm.prank(registryOwner);
        componentRegistry.approveComponent(address(wrongTag), keccak256("gating"), "GatingTaggedMod");

        vm.prank(owner);
        vm.expectRevert(ERC1155Factory.UnapprovedComponent.selector);
        factory.setDynamicPricingModule(address(wrongTag));
    }

    // ── noesis-072 — constructor weth zero-check (mirrors setWeth guard) ────────

    function test_constructor_revertsOnZeroWeth() public {
        vm.expectRevert(ERC1155Factory.InvalidAddress.selector);
        new ERC1155Factory(address(mockRegistry), address(globalRegistry), address(componentRegistry), address(0));
    }
}
