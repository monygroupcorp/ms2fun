// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Test } from "forge-std/Test.sol";
import { PointNoesisNames, INameNFT } from "../../script/PointNoesisNames.s.sol";

/**
 * @title PointNoesisNamesForkTest
 * @notice Proves against the real noesis.gwei and noesis.wei contracts on mainnet that one run of
 *         PointNoesisNames, signed by the names' owner, updates both contenthash records, and that
 *         every refusal it makes holds before anything is sent.
 *
 * @dev Fork-gated: `MAINNET_RPC_URL` unset -> skipped. Run:
 *      MAINNET_RPC_URL=<url> forge test --mp test/fork/PointNoesisNamesFork.t.sol -vv
 *
 *      The owner's key is not available here, so the test calls `point(owner, hash)`, the function
 *      `run(hash)` calls with the `--account` address as `msg.sender`. A test broadcast needs no key:
 *      it sends each call from `owner`, which is all the names check.
 */
contract PointNoesisNamesForkTest is Test {
    PointNoesisNames script;
    address owner;

    // ENSIP-7 contenthash of a CIDv1 dag-pb sha2-256 CID that is not live on either name.
    bytes constant NEW_HASH = hex"e301017012201234567890123456789012345678901234567890123456789012345678901234";

    function setUp() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) vm.skip(true);
        vm.createSelectFork(rpc);

        script = new PointNoesisNames();
        owner = script.GWEI_NAMES().ownerOf(script.GWEI_TOKEN_ID());
    }

    function gweiRecord() internal view returns (bytes memory) {
        return script.GWEI_NAMES().contenthash(script.GWEI_TOKEN_ID());
    }

    function weiRecord() internal view returns (bytes memory) {
        return script.WEI_NAMES().contenthash(script.WEI_TOKEN_ID());
    }

    function test_bothNamesHaveOneOwner() public view {
        assertEq(script.WEI_NAMES().ownerOf(script.WEI_TOKEN_ID()), owner, "noesis.wei owner == noesis.gwei owner");
    }

    function test_oneRunByTheOwnerUpdatesBothRecords() public {
        assertNotEq(gweiRecord(), NEW_HASH, "the new hash must not already be live");
        assertNotEq(weiRecord(), NEW_HASH, "the new hash must not already be live");

        script.point(owner, NEW_HASH);

        assertEq(gweiRecord(), NEW_HASH, "noesis.gwei contenthash");
        assertEq(weiRecord(), NEW_HASH, "noesis.wei contenthash");
    }

    function test_aRunByAnyoneElseIsRefusedAndChangesNothing() public {
        address stranger = makeAddr("stranger");
        bytes memory gweiBefore = gweiRecord();
        bytes memory weiBefore = weiRecord();

        vm.expectRevert(abi.encodeWithSelector(PointNoesisNames.NotOwner.selector, "noesis.gwei", owner, stranger));
        script.point(stranger, NEW_HASH);

        assertEq(gweiRecord(), gweiBefore, "noesis.gwei unchanged");
        assertEq(weiRecord(), weiBefore, "noesis.wei unchanged");
    }

    function test_aHashThatIsNotDagPbIsRefused() public {
        // Same digest, raw codec (0x55) in place of dag-pb (0x70).
        bytes memory raw = hex"e301015512201234567890123456789012345678901234567890123456789012345678901234";
        vm.expectRevert(abi.encodeWithSelector(PointNoesisNames.NotDagPbContenthash.selector, raw));
        script.point(owner, raw);
    }

    function test_anExpiredNameIsRefused() public {
        uint256 expiry = script.GWEI_NAMES().expiresAt(script.GWEI_TOKEN_ID());
        vm.warp(expiry + 1);

        vm.expectRevert(abi.encodeWithSelector(PointNoesisNames.NameExpired.selector, "noesis.gwei", expiry));
        script.point(owner, NEW_HASH);
    }
}
