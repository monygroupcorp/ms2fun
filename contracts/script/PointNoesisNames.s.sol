// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Script, console2 } from "forge-std/Script.sol";

/// @notice The part of the Wei/Gwei Name Service `NameNFT` contract this script calls.
interface INameNFT {
    function ownerOf(uint256 tokenId) external view returns (address);
    function expiresAt(uint256 tokenId) external view returns (uint256);
    function contenthash(uint256 tokenId) external view returns (bytes memory);
    function setContenthash(uint256 tokenId, bytes calldata hash) external;
}

/**
 * @title PointNoesisNames
 * @notice Points noesis.gwei and noesis.wei at one IPFS release by setting the same contenthash on
 *         both names, and fails unless both records equal it afterwards.
 *
 * @dev What this rests on, as measured on Ethereum mainnet at block 26444734 against the verified
 *      source of both contracts (Sourcify, exact match, contract `NameNFT`):
 *
 *        - noesis.gwei is token `GWEI_TOKEN_ID` of `GWEI_NAMES`, noesis.wei is token `WEI_TOKEN_ID`
 *          of `WEI_NAMES`. Each token id is `computeId("noesis")` on its contract, and each contract
 *          is its own resolver: the record lives on the NFT contract itself.
 *        - `setContenthash(tokenId, hash)` reverts `Expired()` unless the name is active
 *          (`block.timestamp <= expiresAt`, the grace period does not count), then reverts
 *          `Unauthorized()` unless `ownerOf(tokenId) == msg.sender`. There is no controller,
 *          operator or delegate path: an ERC-721 approval covers transfers only. So the account that
 *          signs this script must be the names' owner.
 *        - Both names had the same owner at that block, so one account reaches both.
 *
 *      Two transactions, one per name, sent by one `forge script` run. Every refusal below is
 *      checked before the first one is sent, so a run either sends both or neither (barring a
 *      transaction that fails on chain after the simulation passed). The read-back at the end runs
 *      in forge's local execution, before anything is sent; `pnpm release:point --broadcast` reads
 *      both records again from the chain once forge has the receipts.
 *
 *      `hash` is the ENSIP-7 contenthash of a CIDv1 dag-pb sha2-256 CID: `0xe301` (the varint of
 *      the ipfs namespace, 0xe3) followed by the binary CID `0x01 0x70 0x12 0x20 <32-byte digest>`.
 *      `pnpm release:point <cid>` (app/) encodes it; see app/scripts/ipfs-dist/RUNBOOK.md.
 *
 *      Simulate:  forge script script/PointNoesisNames.s.sol --sig "run(bytes)" <hash> \
 *                   --rpc-url "$MAINNET_RPC_URL" --account <keystore name>
 *      Broadcast: the same with `--broadcast`.
 */
contract PointNoesisNames is Script {
    INameNFT public constant GWEI_NAMES = INameNFT(0x9D51D507BC7264d4fE8Ad1cf7Fe191933A0a81d6);
    uint256 public constant GWEI_TOKEN_ID = 0x13f9141e9f9a586ce7d30fd429baa7462c85f6d8715610ff9259843ccb5f358a;

    INameNFT public constant WEI_NAMES = INameNFT(0x0000000000696760E15f265e828DB644A0c242EB);
    uint256 public constant WEI_TOKEN_ID = 0x2cf2bc9ace67c3ca4a9abed6121b9c7dcb19cfc9df7a911e45283ffb71e27b27;

    error NotDagPbContenthash(bytes hash);
    error NotOwner(string name, address owner, address signer);
    error NameExpired(string name, uint256 expiresAt);
    error RecordMismatch(string name, bytes record, bytes expected);

    /// @notice Set `hash` on both names, signed by the one wallet forge unlocked (`--account`).
    /// @dev `msg.sender` here is forge's default sender, not the `--account` address; the account
    ///      is the broadcaster a bare `vm.startBroadcast()` picks, so it is read from there. With no
    ///      wallet unlocked that is the default sender too, and the ownership check refuses it.
    function run(bytes calldata hash) external {
        vm.startBroadcast();
        (, address signer,) = vm.readCallers();
        vm.stopBroadcast();
        point(signer, hash);
    }

    /// @notice Set `hash` on both names, broadcast as `signer`.
    function point(address signer, bytes calldata hash) public {
        requireDagPb(hash);
        requirePointable(GWEI_NAMES, GWEI_TOKEN_ID, "noesis.gwei", signer);
        requirePointable(WEI_NAMES, WEI_TOKEN_ID, "noesis.wei", signer);

        vm.startBroadcast(signer);
        GWEI_NAMES.setContenthash(GWEI_TOKEN_ID, hash);
        WEI_NAMES.setContenthash(WEI_TOKEN_ID, hash);
        vm.stopBroadcast();

        requireRecord(GWEI_NAMES, GWEI_TOKEN_ID, "noesis.gwei", hash);
        requireRecord(WEI_NAMES, WEI_TOKEN_ID, "noesis.wei", hash);
        console2.log("both names now carry contenthash");
        console2.logBytes(hash);
    }

    /// @notice Reverts unless `hash` is `0xe301` + a CIDv1 dag-pb sha2-256 CID (38 bytes).
    function requireDagPb(bytes calldata hash) public pure {
        if (
            hash.length != 38 || hash[0] != 0xe3 || hash[1] != 0x01 || hash[2] != 0x01 || hash[3] != 0x70
                || hash[4] != 0x12 || hash[5] != 0x20
        ) revert NotDagPbContenthash(hash);
    }

    function requirePointable(INameNFT names, uint256 tokenId, string memory name, address signer) internal view {
        address owner = names.ownerOf(tokenId);
        if (owner != signer) revert NotOwner(name, owner, signer);
        uint256 expiry = names.expiresAt(tokenId);
        if (block.timestamp > expiry) revert NameExpired(name, expiry);
    }

    function requireRecord(INameNFT names, uint256 tokenId, string memory name, bytes calldata expected) internal view {
        bytes memory record = names.contenthash(tokenId);
        if (keccak256(record) != keccak256(expected)) revert RecordMismatch(name, record, expected);
    }
}
