// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { console2 } from "forge-std/console2.sol";

/// @notice EIP-170 runtime-bytecode size guard for the ERC1155 and ERC721 edition families.
/// @dev Reads the BUILT artifact via `vm.getDeployedCode` rather than deploying on the fork: the
///      fork config raises `--code-size-limit` to 30000, which would MASK an over-limit contract if
///      we deployed and measured on-chain. Reading the compiled deployed bytecode measures the real
///      mainnet-relevant size (EIP-170 = 24_576 bytes).
///
///      The FACTORIES are the subject, and were missing here. ERC721AuctionFactory embeds its whole
///      instance through `type(ERC721AuctionInstance).creationCode` (ERC721AuctionFactory.sol:104),
///      so a byte added to that instance is a byte off the FACTORY's margin, not off the instance's.
///      Guarding only the instances read green while the deployable contract nearest the limit was
///      unwatched: on 2026-09-18 ERC1155Instance had 7,820B of apparent headroom and ERC1155Factory
///      had 624B. Sizing a change against the instance's room lands the factory over the limit, and
///      the first signal would be a red build with nothing naming the cause.
///
///      ERC1155 NO LONGER HAS THAT SHAPE. Collections are EIP-1167 clones of one implementation and
///      the factory embeds nothing, so ERC1155Instance's headroom is its own budget and the
///      factory's is not the scarce one any more. The two rows are logged separately for that
///      reason; do not read the ERC1155 pair the way the ERC721 pair still has to be read.
///
///      There is no headroom FLOOR here — only the ceiling. The ERC404 family has two floors (a
///      2,000B instance floor and a 500B Ops floor, test/factories/erc404/eip170-diet-gate.sh); each
///      is a ruling about how much room to keep in reserve, and no such ruling has been made for
///      these two families. Until one is, the sizes logged below are evidence and the EIP-170 limit
///      is the only line that blocks. Run with -vv to read them.
///
///      THE -vv IS THE CATCH, and it is why the numbers live somewhere else too. `foundry.toml` sets
///      `verbosity = 2` under `[profile.fork]` ONLY, so the contracts gate and contracts-ci.yml both
///      run this suite at the default verbosity, where `console2.log` prints nothing: the run that
///      decides whether a change lands shows four green PASS lines and not one byte figure. A margin
///      nobody is shown is a margin nobody defends, which is the whole disease restated one level up.
///      `test/factories/eip170-embed-gate.sh` prints the same accounting unconditionally, adds the
///      third factory with this shape (UniTitheHookFactory, embedding UniAlignmentV4Hook), proves the
///      instance initcode really is one contiguous blob inside the factory runtime rather than
///      assuming it, and holds the empty slot a headroom floor goes into once one is ruled. These
///      assertions stay because they run inside the sharded `forge test` and block there.
///
///      ERC404BondingInstance is excluded: it carries its own gate, which holds both a ceiling and
///      the floors above.
contract InstanceBytecodeSizeTest is Test {
    uint256 internal constant EIP170_LIMIT = 24_576;

    /// @dev Its headroom is REAL, unlike ERC721AuctionInstance's below: nothing embeds this contract,
    ///      so nothing else spends these bytes. `test/factories/eip170-embed-gate.sh` carries it as a
    ///      graduate row, which is where a headroom floor for it would be typed.
    function test_ERC1155Instance_underEip170() public view {
        uint256 size = vm.getDeployedCode("ERC1155Instance.sol:ERC1155Instance").length;
        _logStandalone("ERC1155Instance", size);
        assertLt(size, EIP170_LIMIT, "ERC1155Instance runtime bytecode exceeds EIP-170");
    }

    function test_ERC721AuctionInstance_underEip170() public view {
        uint256 size = vm.getDeployedCode("ERC721AuctionInstance.sol:ERC721AuctionInstance").length;
        _logInstance("ERC721AuctionInstance", size);
        assertLt(size, EIP170_LIMIT, "ERC721AuctionInstance runtime bytecode exceeds EIP-170");
    }

    /// @dev Reported without an embedded-initcode line because there is none to report: the factory
    ///      deploys a 45-byte EIP-1167 proxy. `_report` would have printed the instance's creation
    ///      size beside it as if the factory still carried it, which was true until it was not.
    function test_ERC1155Factory_underEip170() public view {
        uint256 size = vm.getDeployedCode("ERC1155Factory.sol:ERC1155Factory").length;
        _logStandalone("ERC1155Factory", size);
        assertLt(size, EIP170_LIMIT, "ERC1155Factory runtime bytecode exceeds EIP-170");
    }

    function test_ERC721AuctionFactory_underEip170() public view {
        _report(
            "ERC721AuctionFactory",
            vm.getDeployedCode("ERC721AuctionFactory.sol:ERC721AuctionFactory").length,
            vm.getCode("ERC721AuctionInstance.sol:ERC721AuctionInstance").length
        );
    }

    /// @dev A contract nothing embeds. Its headroom is a budget, so it is logged without the word
    ///      APPARENT and without a blob line that would be zero.
    function _logStandalone(string memory name, uint256 size) private pure {
        console2.log(name);
        console2.log("  runtime bytes         ", size);
        console2.log("  EIP-170 headroom      ", EIP170_LIMIT - size);
    }

    /// @dev An instance is deployed by its factory, so it has its own EIP-170 ceiling and this is a
    ///      real guard. Its headroom is logged as APPARENT because it is not a budget: spending it
    ///      spends the factory's, at roughly a byte for a byte. Read it next to the factory row.
    function _logInstance(string memory name, uint256 size) private pure {
        console2.log(name);
        console2.log("  runtime bytes         ", size);
        console2.log("  apparent headroom     ", EIP170_LIMIT - size);
    }

    /// @dev Logs the factory's size, its remaining EIP-170 headroom, and the embedded instance
    ///      initcode that accounts for most of it, then asserts the ceiling. The lever when this
    ///      trips is getting that initcode out of the factory — an EIP-1167 clone off a master
    ///      implementation, the way the ERC404 family already deploys, or a separate deployer
    ///      contract the factory calls. Both change deployed addresses and the deploy scripts, so
    ///      neither is a diff to land under time pressure; the headroom is logged so the room runs
    ///      out on somebody's screen before it runs out in a build.
    function _report(string memory name, uint256 factorySize, uint256 embeddedInitCode) private pure {
        console2.log(name);
        console2.log("  runtime bytes         ", factorySize);
        console2.log("  EIP-170 headroom      ", EIP170_LIMIT - factorySize);
        console2.log("  embedded instance init", embeddedInitCode);
        assertLt(factorySize, EIP170_LIMIT, "factory runtime bytecode exceeds EIP-170");
    }
}
