// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { LibClone } from "solady/utils/LibClone.sol";
import { DN404Mirror } from "dn404/src/DN404Mirror.sol";
import { MasterRegistryV1 } from "../../src/master/MasterRegistryV1.sol";
import { AlignmentRegistryV1 } from "../../src/master/AlignmentRegistryV1.sol";
import { IAlignmentRegistry } from "../../src/master/interfaces/IAlignmentRegistry.sol";
import { GlobalMessageRegistry } from "../../src/registry/GlobalMessageRegistry.sol";
import { ERC404BondingInstance } from "../../src/factories/erc404/ERC404BondingInstance.sol";
import { ERC404BondingOps } from "../../src/factories/erc404/ERC404BondingOps.sol";
import { CurveParamsComputer } from "../../src/factories/erc404/CurveParamsComputer.sol";
import { BondingCurveMath } from "../../src/factories/erc404/libraries/BondingCurveMath.sol";
import { ERC1155Instance } from "../../src/factories/erc1155/ERC1155Instance.sol";
import { ERC721AuctionInstance } from "../../src/factories/erc721/ERC721AuctionInstance.sol";

/// @dev Minimal vault surface: `registerVault` needs `alignmentToken()`, and no path under test
///      (buy / sell / mint / bid) calls a vault at all.
contract RevocationVault {
    address public alignmentToken;

    constructor(address token) {
        alignmentToken = token;
    }
}

/// @dev Stand-in for a registered factory. Only used as the `msg.sender` `registerInstance` demands.
contract RevocationFactory {
    address public creator;
    address public protocol;

    constructor(address _creator, address _protocol) {
        creator = _creator;
        protocol = _protocol;
    }
}

/// @title GlobalMessageRegistryRevocation
/// @notice noesis-289: pins that revoking an instance stops its comments and NOT its trades.
/// @dev `GlobalMessageRegistry.postForAction` refuses any caller for which
///      `isInstanceFromApprovedFactory` is false, and `revokeInstance` is exactly that flip. Every
///      ERC-404 / ERC-1155 / ERC-721 instance forwards a user's comment through that call on its
///      buy / sell / mint / bid path, so while the call was made bare a revoked collection's
///      commented buy reverted and the identical uncommented buy went through — the same trade
///      succeeding or failing on whether the buyer typed something.
///
///      Every test here asserts the FIXED behaviour: the trade settles either way, and the comment
///      is the only thing revocation takes. Nothing here asserts a revert on a trade path; that
///      would encode the defect. The complement — that factory DEACTIVATION must not touch this
///      path — is pinned in `test/master/MasterRegistryDeactivationScope.t.sol`.
contract GlobalMessageRegistryRevocationTest is Test {
    MasterRegistryV1 registry;
    AlignmentRegistryV1 alignmentRegistry;
    GlobalMessageRegistry msgReg;
    CurveParamsComputer curveComputer;

    address dao = makeAddr("dao");
    address creator = makeAddr("creator");
    address buyer = makeAddr("buyer");
    address treasury = makeAddr("treasury");
    address weth = makeAddr("weth");
    address alignmentToken = makeAddr("alignmentToken");

    address factory;
    address vaultAddr;

    ERC404BondingInstance bonding;
    ERC1155Instance editions;
    ERC721AuctionInstance auction;

    uint256 constant MAX_SUPPLY = 10_000_000 ether;
    uint256 constant BUY_AMOUNT = 1000 ether;
    uint256 constant MINT_PRICE = 0.05 ether;
    uint256 constant MIN_BID = 0.1 ether;

    function setUp() public {
        MasterRegistryV1 impl = new MasterRegistryV1();
        registry = MasterRegistryV1(LibClone.deployERC1967(address(impl)));
        registry.initialize(dao);

        alignmentRegistry = new AlignmentRegistryV1(weth);
        alignmentRegistry.initialize(dao);
        vm.prank(dao);
        registry.setAlignmentRegistry(address(alignmentRegistry));

        factory = address(new RevocationFactory(creator, dao));
        vm.prank(dao);
        registry.registerFactory(
            factory, "ERC404", "Test", "Test Factory", "ipfs://factory", new bytes32[](0), address(0)
        );

        vaultAddr = address(new RevocationVault(alignmentToken));
        IAlignmentRegistry.AlignmentAsset[] memory assets = new IAlignmentRegistry.AlignmentAsset[](1);
        assets[0] =
            IAlignmentRegistry.AlignmentAsset({ token: alignmentToken, symbol: "ALIGN", info: "", metadataURI: "" });
        vm.prank(dao);
        uint256 targetId = alignmentRegistry.registerAlignmentTarget("Test Target", "", "", assets);
        vm.prank(dao);
        registry.registerVault(vaultAddr, dao, "Shared Vault", "ipfs://vault", targetId);

        msgReg = new GlobalMessageRegistry();
        msgReg.initialize(dao, address(registry));

        curveComputer = new CurveParamsComputer(address(this));

        bonding = _deployBonding();
        editions = _deployEditions();
        auction = _deployAuction();

        _register(address(bonding), "revokebonding");
        _register(address(editions), "revokeeditions");
        _register(address(auction), "revokeauction");
    }

    // ── Fixture ───────────────────────────────────────────────────────────────

    function _deployBonding() internal returns (ERC404BondingInstance inst) {
        ERC404BondingInstance implementation = new ERC404BondingInstance(address(new ERC404BondingOps()));
        inst = ERC404BondingInstance(payable(LibClone.clone(address(implementation))));

        vm.startPrank(creator);
        inst.initialize(
            creator,
            vaultAddr,
            ERC404BondingInstance.BondingParams({
                maxSupply: MAX_SUPPLY,
                unit: 1_000_000 ether,
                liquidityReserveBps: 1000,
                declaredMaxAllowanceBps: 0,
                curve: BondingCurveMath.Params({ kCoeff: 0.025 ether, poleWad: 1.0438e18, normalizationFactor: 1e7 })
            }),
            makeAddr("liquidityDeployer"),
            address(0),
            address(new DN404Mirror(creator))
        );
        inst.initializeProtocol(
            ERC404BondingInstance.ProtocolParams({
                globalMessageRegistry: address(msgReg),
                protocolTreasury: treasury,
                masterRegistry: address(registry),
                bondingFeeBps: 100,
                weth: weth
            })
        );
        inst.initializeMetadata("Revocation Bonding", "RVK", "", "", "");
        inst.setBondingOpenTime(block.timestamp + 1);
        inst.setBondingActive(true);
        vm.stopPrank();

        vm.warp(block.timestamp + 1);
    }

    function _deployEditions() internal returns (ERC1155Instance inst) {
        inst = new ERC1155Instance(
            "Revocation Editions",
            creator,
            factory,
            vaultAddr,
            "",
            ERC1155Instance.InstanceInit({
                globalMessageRegistry: address(msgReg),
                protocolTreasury: treasury,
                masterRegistry: address(registry),
                gatingModule: address(0),
                dynamicPricingModule: address(0),
                weth: weth
            }),
            false,
            "ipfs://editions",
            "RVK"
        );

        vm.prank(creator);
        inst.addEdition("Piece", MINT_PRICE, 0, "ipfs://piece", ERC1155Instance.PricingModel.UNLIMITED, 0, 0, 0);
    }

    function _deployAuction() internal returns (ERC721AuctionInstance inst) {
        inst = new ERC721AuctionInstance(
            ERC721AuctionInstance.ConstructorParams({
                vault: vaultAddr,
                protocolTreasury: treasury,
                owner: creator,
                name: "Revocation Auction",
                symbol: "RVK",
                metadataURI: "ipfs://auction",
                lines: 1,
                baseDuration: 1 days,
                timeBuffer: 15 minutes,
                bidIncrement: 0.01 ether,
                globalMessageRegistry: address(msgReg),
                masterRegistry: address(registry),
                factory: factory,
                weth: weth
            })
        );

        vm.deal(creator, MIN_BID);
        vm.prank(creator);
        inst.queuePiece{ value: MIN_BID }("ipfs://piece");
    }

    function _register(address instance, string memory name) internal {
        vm.prank(factory);
        registry.registerInstance(instance, factory, creator, name, "ipfs://proj", vaultAddr);
    }

    function _revoke(address instance) internal {
        vm.prank(dao);
        registry.revokeInstance(instance);
        assertFalse(
            registry.isInstanceFromApprovedFactory(instance), "precondition: revocation un-approves the instance"
        );
    }

    function _comment(string memory content) internal pure returns (bytes memory) {
        return abi.encode(uint8(0), uint256(0), bytes32(0), bytes32(0), content);
    }

    function _buyCost(uint256 amount) internal view returns (uint256) {
        (uint256 k, uint256 pole, uint256 norm) = bonding.curveParams();
        uint256 cost = curveComputer.calculateCost(
            BondingCurveMath.Params({ kCoeff: k, poleWad: pole, normalizationFactor: norm }),
            bonding.totalBondingSupply(),
            amount
        );
        return cost + (cost * bonding.bondingFeeBps()) / 10_000;
    }

    function _buy(uint256 amount, bytes memory messageData) internal {
        uint256 cost = _buyCost(amount);
        vm.deal(buyer, cost);
        vm.prank(buyer);
        bonding.buyBonding{ value: cost }(amount, cost, false, bytes(""), messageData, 0);
    }

    function _mint(bytes memory messageData) internal {
        vm.deal(buyer, MINT_PRICE);
        vm.prank(buyer);
        editions.mint{ value: MINT_PRICE }(1, 1, bytes(""), messageData, 0);
    }

    function _bid(uint256 value, bytes memory messageData) internal {
        vm.deal(buyer, value);
        vm.prank(buyer);
        auction.createBid{ value: value }(1, messageData);
    }

    // ── A revoked instance's commented trade still settles ──────────────────

    /// @dev The whole finding in one test: the same buy, once with a comment and once without,
    ///      on a revoked instance. Before the fix the commented one reverted and the bare one did not.
    function test_revokedBondingBuySettlesWithAndWithoutAComment() public {
        _revoke(address(bonding));

        _buy(BUY_AMOUNT, _comment("gm"));
        assertEq(bonding.totalBondingSupply(), BUY_AMOUNT, "commented buy settled on a revoked instance");

        _buy(BUY_AMOUNT, bytes(""));
        assertEq(bonding.totalBondingSupply(), BUY_AMOUNT * 2, "uncommented buy settled too");
    }

    function test_revokedBondingSellSettlesWithAComment() public {
        _buy(BUY_AMOUNT, bytes(""));
        _revoke(address(bonding));

        vm.prank(buyer);
        bonding.sellBonding(BUY_AMOUNT, 0, bytes32(0), _comment("cashing out"), 0);

        assertEq(bonding.totalBondingSupply(), 0, "commented sell settled on a revoked instance");
        assertGt(buyer.balance, 0, "the seller was paid");
    }

    function test_revokedEditionMintSettlesWithAComment() public {
        _revoke(address(editions));

        _mint(_comment("nice piece"));

        assertEq(editions.balanceOf(buyer, 1), 1, "commented mint settled on a revoked instance");
    }

    function test_revokedAuctionBidSettlesWithAComment() public {
        _revoke(address(auction));

        _bid(MIN_BID, _comment("bidding"));

        (,,, address highBidder, uint256 highBid,,,) = auction.auctions(1);
        assertEq(highBidder, buyer, "commented bid settled on a revoked instance");
        assertEq(highBid, MIN_BID, "the bid was recorded at its full value");
    }

    // ── What revocation still takes: the comment, and only the comment ────────

    /// @dev Non-vacuity, stated as behaviour rather than as a note: the same instance posts the
    ///      message while it is live and stops posting it once revoked, with both trades settling.
    ///      Delete the `isInstanceFromApprovedFactory` pre-check at the call site and the second
    ///      buy reverts instead, taking this test and the four above with it.
    function test_revocationDropsTheMessageAndNothingElse() public {
        _buy(BUY_AMOUNT, _comment("before"));
        assertEq(msgReg.messageCount(), 1, "a live instance posts its buyer's comment");
        assertEq(bonding.totalBondingSupply(), BUY_AMOUNT, "and settles the buy");

        _revoke(address(bonding));

        _buy(BUY_AMOUNT, _comment("after"));
        assertEq(msgReg.messageCount(), 1, "a revoked instance posts no comment");
        assertEq(bonding.totalBondingSupply(), BUY_AMOUNT * 2, "but still settles the buy");
    }

    /// @dev The skip is at the call site, not in the registry: the message registry's own gate is
    ///      untouched, so a revoked instance calling it directly is still refused.
    function test_messageRegistryStillRefusesARevokedInstanceDirectly() public {
        _revoke(address(bonding));

        vm.prank(address(bonding));
        vm.expectRevert(GlobalMessageRegistry.NotFromApprovedFactory.selector);
        msgReg.postForAction(buyer, address(bonding), _comment("gm"));
    }

    /// @dev Scope control: only revocation drops comments. Deactivating the factory leaves
    ///      `registeredFactories` true, so an instance it already produced keeps posting.
    function test_factoryDeactivationLeavesTheCommentedTradeIntact() public {
        vm.prank(dao);
        registry.deactivateFactory(factory);
        assertTrue(
            registry.isInstanceFromApprovedFactory(address(bonding)),
            "precondition: deactivation leaves existing instances approved"
        );

        _buy(BUY_AMOUNT, _comment("still here"));

        assertEq(msgReg.messageCount(), 1, "comment still posted after factory deactivation");
        assertEq(bonding.totalBondingSupply(), BUY_AMOUNT, "and the buy settled");
    }
}
