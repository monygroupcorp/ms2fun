// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console } from "forge-std/Script.sol";
import { ERC1155Factory } from "../src/factories/erc1155/ERC1155Factory.sol";
import { ERC1155Instance } from "../src/factories/erc1155/ERC1155Instance.sol";
import { ERC404Factory } from "../src/factories/erc404/ERC404Factory.sol";
import { ERC404BondingInstance } from "../src/factories/erc404/ERC404BondingInstance.sol";
import { BondingCurveMath } from "../src/factories/erc404/libraries/BondingCurveMath.sol";
import { RevenueSplitLib } from "../src/shared/libraries/RevenueSplitLib.sol";
import { FreeMintParams } from "../src/interfaces/IFactoryTypes.sol";
import { GatingScope } from "../src/gating/IGatingModule.sol";
import { MainnetAddresses } from "./MainnetAddresses.sol";

interface IBondAmount {
    function bondAmount() external view returns (uint256);
}

interface IAlignmentHookFactorySlot {
    function alignmentHookFactory() external view returns (address);
}

/// @title ForkRehearsalCollections
/// @notice The collection half of the mainnet fork rehearsal (`docs/MAINNET-DEPLOY-RUNBOOK.md` §3):
///         one ERC-1155 created, minted once and withdrawn; one ERC-404 bought out and graduated,
///         with the liquidity module's residual (audit finding A-C5) measured at the graduation.
///
/// @dev Fork only. It is driven by `app/scripts/dev-chain/fork-rehearsal-mainnet.ts` after the
///      protocol has been deployed by `DeployMainnet` and handed to the Timelock; it broadcasts from
///      addresses the fork impersonates (`--unlocked`), none of which holds a key.
///
///      Two entry points because the bonding curve opens only after a future `bondingOpenTime`, and a
///      forge script cannot move the chain's clock between its own transactions:
///        `create()`   — both collections, the edition, and the curve armed to open shortly;
///        `exercise()` — after the orchestrator has advanced the fork past the open time: the mint,
///                       the withdraw, the buy-out, the graduation and the measurement.
///
///      Environment: `REHEARSAL_RECORD` (the deploy record `DeployMainnet` wrote), `REHEARSAL_STATE`
///      (where `create()` leaves the two instance addresses and `exercise()` writes its figures, under
///      `./deployments/`), `REHEARSAL_CREATOR`, `REHEARSAL_BUYER`.
contract ForkRehearsalCollections is Script {
    /// @dev The ERC-404 rung the rehearsal graduates: preset 0, the smallest raise (5 ETH), so the
    ///      whole curve is bought out at the cost of a single preset target.
    uint8 internal constant PRESET = 0;
    uint256 internal constant NFT_COUNT = 100;

    /// @dev The edition shape chosen for the first mainnet collection (runbook §5): a timed open
    ///      edition at 0.01 ETH, 72 hours, open supply.
    uint256 internal constant EDITION_PRICE = 0.01 ether;
    uint256 internal constant EDITION_WINDOW = 72 hours;

    struct Deployed {
        ERC1155Factory erc1155;
        ERC404Factory erc404;
        address vault;
        address uniDeployer;
        address treasury;
    }

    function _deployed() internal view returns (Deployed memory d) {
        string memory json = vm.readFile(vm.envString("REHEARSAL_RECORD"));
        d.erc1155 = ERC1155Factory(vm.parseJsonAddress(json, ".factories.ERC1155"));
        d.erc404 = ERC404Factory(vm.parseJsonAddress(json, ".factories.ERC404"));
        // The first roster target's Uniswap vault: a liquidity-family vault, so both collections
        // settle on the 1/19/80 rail.
        d.vault = vm.parseJsonAddress(json, ".contracts.SeedUniVault");
        d.uniDeployer = vm.parseJsonAddress(json, ".contracts.ModuleUniV4Deployer");
        d.treasury = vm.parseJsonAddress(json, ".contracts.ProtocolTreasury");
        require(d.vault != address(0), "rehearsal: the deploy record names no Uniswap vault");
    }

    function _meta(string memory name) internal pure returns (string memory) {
        return string.concat(
            "data:application/json;utf8,{\"name\":\"", name, "\",\"description\":\"Fork rehearsal collection.\"}"
        );
    }

    // ───────────────────────────── create ─────────────────────────────

    function create() external {
        Deployed memory d = _deployed();
        address creator = vm.envAddress("REHEARSAL_CREATOR");
        string memory tag = vm.toString(block.timestamp);

        vm.startBroadcast(creator);

        address edition = d.erc1155
            .createInstance(
                keccak256(abi.encode("fork-rehearsal-1155", block.timestamp)),
                ERC1155Factory.CreateParams({
                    name: string.concat("rehearsal-edition-", tag),
                    symbol: "",
                    metadataURI: _meta("Rehearsal edition"),
                    creator: creator,
                    vault: d.vault,
                    styleUri: "",
                    gatingModule: address(0),
                    freeMint: FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
                })
            );
        ERC1155Instance(payable(edition))
            .addEdition(
                "Rehearsal piece",
                EDITION_PRICE,
                0,
                _meta("Rehearsal piece"),
                ERC1155Instance.PricingModel.UNLIMITED,
                0,
                0,
                0,
                block.timestamp + EDITION_WINDOW,
                0
            );

        uint256 bond =
            d.erc404.deployBondEscrow() == address(0) ? 0 : IBondAmount(d.erc404.deployBondEscrow()).bondAmount();
        address curve = d.erc404.createInstance{ value: bond }(
            ERC404Factory.CreateParams({
                salt: keccak256(abi.encode("fork-rehearsal-404", block.timestamp)),
                name: string.concat("rehearsal-curve-", tag),
                symbol: "RHSL",
                styleUri: "",
                tokenBaseURI: "ipfs://rehearsal/",
                owner: creator,
                vault: d.vault,
                nftCount: NFT_COUNT,
                presetId: PRESET,
                stakingModule: address(0),
                declaredMaxAllowanceBps: 0
            }),
            _meta("Rehearsal curve"),
            d.uniDeployer,
            address(0),
            FreeMintParams({ allocation: 0, scope: GatingScope.BOTH })
        );
        ERC404BondingInstance b = ERC404BondingInstance(payable(curve));
        b.setBondingOpenTime(block.timestamp + 60);
        b.setBondingActive(true);

        vm.stopBroadcast();

        string memory s = "state";
        vm.serializeAddress(s, "erc1155", edition);
        string memory out = vm.serializeAddress(s, "erc404", curve);
        vm.writeJson(out, vm.envString("REHEARSAL_STATE"));
        console.log("ERC-1155 instance:", edition);
        console.log("ERC-404 instance:", curve);
    }

    // ───────────────────────────── exercise ─────────────────────────────

    struct Snapshot {
        uint256 moduleEth;
        uint256 moduleCoin;
        uint256 poolManagerEth;
        uint256 poolManagerCoin;
        uint256 treasuryEth;
        uint256 creatorEth;
        uint256 instanceEth;
        uint256 totalSupply;
    }

    function _snapshot(Deployed memory d, ERC404BondingInstance b, address creator)
        internal
        view
        returns (Snapshot memory s)
    {
        s.moduleEth = d.uniDeployer.balance;
        s.moduleCoin = b.balanceOf(d.uniDeployer);
        s.poolManagerEth = MainnetAddresses.V4_POOL_MANAGER.balance;
        s.poolManagerCoin = b.balanceOf(MainnetAddresses.V4_POOL_MANAGER);
        s.treasuryEth = d.treasury.balance;
        s.creatorEth = creator.balance;
        s.instanceEth = address(b).balance;
        s.totalSupply = b.totalSupply();
    }

    /// @dev Amounts are written as decimal strings: forge's JSON writer carries numbers through a
    ///      float, which rounds anything past 2^53 and would misstate a wei figure.
    function _uint(string memory obj, string memory key, uint256 value) internal returns (string memory) {
        return vm.serializeString(obj, key, vm.toString(value));
    }

    function exercise() external {
        Deployed memory d = _deployed();
        address creator = vm.envAddress("REHEARSAL_CREATOR");
        address buyer = vm.envAddress("REHEARSAL_BUYER");
        string memory statePath = vm.envString("REHEARSAL_STATE");
        string memory state = vm.readFile(statePath);
        ERC1155Instance edition = ERC1155Instance(payable(vm.parseJsonAddress(state, ".erc1155")));
        ERC404BondingInstance b = ERC404BondingInstance(payable(vm.parseJsonAddress(state, ".erc404")));

        // ── ERC-1155: one mint from a second wallet, then the creator withdraws all of it ──
        uint256 mintCost = edition.calculateMintCost(1, 1);
        vm.startBroadcast(buyer);
        edition.mint{ value: mintCost }(1, 1, "", "", mintCost);
        vm.stopBroadcast();
        require(edition.balanceOf(buyer, 1) == 1, "rehearsal: the mint did not land");

        uint256 proceeds = edition.totalProceeds() - edition.totalWithdrawn();
        uint256 creatorBefore = creator.balance;
        vm.startBroadcast(creator);
        edition.withdraw(proceeds);
        vm.stopBroadcast();
        uint256 creatorPaid = creator.balance - creatorBefore;
        require(edition.totalWithdrawn() == edition.totalProceeds(), "rehearsal: proceeds left unwithdrawn");

        // ── ERC-404: buy the whole bondable supply, then graduate ──
        uint256 bondable = b.maxSupply() - b.liquidityReserve() - (b.freeMintAllocation() * b.unit());
        (uint256 kCoeff, uint256 poleWad, uint256 normalizationFactor) = b.curveParams();
        BondingCurveMath.Params memory p =
            BondingCurveMath.Params({ kCoeff: kCoeff, poleWad: poleWad, normalizationFactor: normalizationFactor });
        uint256 cost = BondingCurveMath.calculateCost(p, b.totalBondingSupply(), bondable);
        uint256 total = cost + (cost * b.bondingFeeBps()) / 10000;
        vm.startBroadcast(buyer);
        b.buyBonding{ value: total }(bondable, total, false, bytes(""), "", 0);
        vm.stopBroadcast();
        require(b.totalBondingSupply() == bondable, "rehearsal: the curve is not fully bought");

        uint256 raise = b.reserve();
        Snapshot memory pre = _snapshot(d, b, creator);
        vm.startBroadcast(creator);
        b.deployLiquidity(0);
        vm.stopBroadcast();
        require(b.graduated(), "rehearsal: graduation did not land");
        Snapshot memory post = _snapshot(d, b, creator);

        // ── The A-C5 measurement ──
        // The LP leg is the 80% remainder of the raise; with a zero carve it is all offered to the
        // pool. What the pool did not take either rode the rail home or stayed in the module; the
        // second is the finding.
        uint256 lpLeg = RevenueSplitLib.split(raise).remainder;
        uint256 poolTookEth = post.poolManagerEth - pre.poolManagerEth;
        uint256 poolTookCoin = post.poolManagerCoin - pre.poolManagerCoin;
        uint256 moduleEthResidual = post.moduleEth - pre.moduleEth;
        uint256 moduleCoinResidual = post.moduleCoin - pre.moduleCoin;
        uint256 coinBurned = pre.totalSupply - post.totalSupply;

        string memory m = "measure";
        vm.serializeAddress(m, "erc1155", address(edition));
        _uint(m, "erc1155MintCost", mintCost);
        _uint(m, "erc1155Withdrawn", proceeds);
        _uint(m, "erc1155CreatorPaid", creatorPaid);
        vm.serializeAddress(m, "erc404", address(b));
        _uint(m, "erc404Preset", PRESET);
        _uint(m, "erc404BuyCost", total);
        _uint(m, "erc404Raise", raise);
        _uint(m, "erc404LpLeg", lpLeg);
        vm.serializeBool(
            m, "erc404Hooked", IAlignmentHookFactorySlot(d.uniDeployer).alignmentHookFactory() != address(0)
        );
        _uint(m, "poolTookEth", poolTookEth);
        _uint(m, "poolTookCoin", poolTookCoin);
        _uint(m, "lpLegEthNotPlaced", lpLeg - poolTookEth);
        _uint(m, "coinBurned", coinBurned);
        _uint(m, "treasuryGainedEth", post.treasuryEth - pre.treasuryEth);
        _uint(m, "creatorGainedEth", post.creatorEth - pre.creatorEth);
        _uint(m, "instanceEthAfter", post.instanceEth);
        _uint(m, "moduleEthResidual", moduleEthResidual);
        string memory out = _uint(m, "moduleCoinResidual", moduleCoinResidual);
        vm.writeJson(out, statePath);

        console.log("A-C5 module ETH residual (wei):", moduleEthResidual);
        console.log("A-C5 module coin residual (wei):", moduleCoinResidual);
        console.log("LP leg ETH not placed in the pool (wei):", lpLeg - poolTookEth);
    }
}
