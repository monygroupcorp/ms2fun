// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  SepoliaSalts
/// @notice The CreateX CREATE3 salt set the Sepolia deploy uses for its six registry proxies.
///
///         **This is the one place a salt set is edited.** `DeploySepolia` reads every salt from
///         here, and `test/coverage/SepoliaSaltSet.t.sol` re-derives the addresses from these
///         constants, so replacing the six literals below is the whole of a re-mine.
///
/// ── Why a salt set is single-use ──────────────────────────────────────────────────────────────
///         CreateX's CREATE3 entry point deploys a CREATE2 proxy under the guarded salt and then
///         takes the address that proxy's first CREATE produces. The proxy is what collides: once
///         it carries code, `deployCreate3` with the same salt reverts `CreateCollision`. A salt is
///         therefore consumed by the deploy that used it, and re-running the deploy needs a set
///         that has never been broadcast by this deployer on this chain.
///
/// ── Salt layout ───────────────────────────────────────────────────────────────────────────────
///         A CreateX salt packs three fields into 32 bytes:
///
///           bytes  0..19   the deployer address — the permissioned-deploy guard. CreateX requires
///                          `msg.sender` to equal these bytes, so only `DEPLOYER` can consume this
///                          set and nobody else can front-run it onto the same addresses.
///           byte      20   cross-chain redeploy-protection flag. `0x00` = off, which is the form
///                          used here; `0x01` mixes `block.chainid` into the guarded salt and
///                          changes every derived address.
///           bytes 21..31   free entropy — 88 bits, the only field the miner varies.
///
///         With the flag off the address derivation is
///
///           guardedSalt = keccak256(abi.encodePacked(uint256(uint160(DEPLOYER)), salt))
///           proxy       = last20(keccak256(0xff ++ CREATEX ++ guardedSalt ++ PROXY_INITCODE_HASH))
///           address     = last20(keccak256(0xd6 ++ 0x94 ++ proxy ++ 0x01))
///
///         The deployed bytecode is not an input, so one salt yields the same address whatever is
///         deployed through it.
///
/// ── Re-mining ─────────────────────────────────────────────────────────────────────────────────
///         `script/salt-miner/` holds a parameterised miner; its README carries the build line and
///         the measured throughput. A longer prefix costs 256x per additional zero byte. Paste the
///         miner's output over the six constants below, update `DEPLOYER` if the broadcasting
///         address changed, and the salt-set test re-derives and re-checks everything.
library SepoliaSalts {
    /// @notice The address that must broadcast the deploy. It is embedded in every salt below as
    ///         the permissioned-deploy guard, so broadcasting from any other address reverts
    ///         `InvalidSalt` inside CreateX before anything is deployed.
    address internal constant DEPLOYER = 0x1821BD18CBdD267CE4e389f893dDFe7BEB333aB6;

    /// @notice How many leading zero bytes every address in this set carries. The salt-set test
    ///         asserts it, so a hand-edited constant that does not meet it fails the suite.
    uint256 internal constant ADDRESS_ZERO_PREFIX_BYTES = 4;

    // ── Mined salt set ────────────────────────────────────────────────────────────────────────
    // Replace all six together; a partially replaced set mixes spent and fresh salts. The trailing
    // comment on each line is the address CreateX will produce — it is documentation, and the
    // salt-set test re-derives it rather than trusting it.
    bytes32 internal constant MASTER_REGISTRY = 0x1821bd18cbdd267ce4e389f893ddfe7beb333ab600bdef127a418cdb9ab7357b; // => 0x00000000050b4ba28be3eb942cf274a7aed0ed3e
    bytes32 internal constant TREASURY = 0x1821bd18cbdd267ce4e389f893ddfe7beb333ab60019d9c6be2bcef61ded3b32; // => 0x000000001a48f03ab08d779d0768139bfa081e65
    bytes32 internal constant QUEUE_MANAGER = 0x1821bd18cbdd267ce4e389f893ddfe7beb333ab60084d009ae00b0f52ceb5908; // => 0x00000000eee59daf0689f4d81e1a1a0ac31545ff
    bytes32 internal constant GLOBAL_MSG_REG = 0x1821bd18cbdd267ce4e389f893ddfe7beb333ab6009ad0496ae150943c287934; // => 0x000000000c5302cffb25affec797d95dde89318f
    bytes32 internal constant ALIGNMENT_REG = 0x1821bd18cbdd267ce4e389f893ddfe7beb333ab600ae85d4acd51f103020605c; // => 0x0000000093d069bef9021f627865cead36ec9d7f
    bytes32 internal constant COMPONENT_REG = 0x1821bd18cbdd267ce4e389f893ddfe7beb333ab600eb8aa11218fc18bb3176d7; // => 0x00000000c08ac2f8fdd8702384641a5d148c210c
}
