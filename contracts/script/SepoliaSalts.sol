// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title  SepoliaSalts
/// @notice The CreateX CREATE3 salt set for the six registry proxies. It is named for the chain it
///         is spent on first, not for the only chain it serves: ONE deployer and THIS ONE SET serve
///         both Sepolia and Ethereum mainnet, and no second set is ever mined.
///
///         **This is the one place a salt set is edited.** `DeploySepolia` reads every salt from
///         here, and `test/coverage/SepoliaSaltSet.t.sol` re-derives the addresses from these
///         constants, so replacing the six literals below is the whole of a re-mine.
///
/// ── One set, both chains ─────────────────────────────────────────────────────────────
///         `block.chainid` is not an input to the derivation below — byte 20 is `0x00`, so the same
///         deployer under the same salt yields the SAME six addresses on every chain. What is
///         per-chain is only the CREATE2 proxy that collides, so a set spent on Sepolia is still
///         unspent on mainnet. That is why `DeployMainnet` reuses these constants instead of mining
///         its own: the rehearsal then proves the literal addresses mainnet will carry, and nothing
///         about the address set is done for the first time with real money behind it.
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
    address internal constant DEPLOYER = 0x000888695d3e361434f67D9dbd110f1A443822b9;

    /// @notice The leading nibbles every address in this set carries, written the way an address is
    ///         read. `ADDRESS_PREFIX` is the digits and `ADDRESS_PREFIX_NIBBLES` is how many of them
    ///         are meant, which is the only way a prefix whose own leading digit is `0` can state its
    ///         width: `0x000888` and `0x888` are the same number, and only the count says the first
    ///         is six nibbles rather than three. The salt-set test shifts each derived address down
    ///         to that width and compares, so a hand-edited constant that does not meet it fails the
    ///         suite. A run of zero bytes is just a prefix that happens to be zero — the miner's
    ///         `--prefix-bytes N` is sugar for `--prefix-hex` over 2N zeroes.
    uint256 internal constant ADDRESS_PREFIX = 0x0000000000;
    uint256 internal constant ADDRESS_PREFIX_NIBBLES = 10;

    // ── Mined salt set ────────────────────────────────────────────────────────────────────────
    // Replace all six together; a partially replaced set mixes spent and fresh salts. The trailing
    // comment on each line is the address CreateX will produce — it is documentation, and the
    // salt-set test re-derives it rather than trusting it.
    bytes32 internal constant MASTER_REGISTRY = 0x000888695d3e361434f67d9dbd110f1a443822b900708d0c5af3e71502f0f4de; // => 0x0000000000666868b0a9ec07fa495da351718bce
    bytes32 internal constant TREASURY = 0x000888695d3e361434f67d9dbd110f1a443822b900d17f0a8efcfa0d012c46f0; // => 0x00000000004c604d01a8a75106e62365b0ca6d18
    bytes32 internal constant QUEUE_MANAGER = 0x000888695d3e361434f67d9dbd110f1a443822b9001243d4c1d89685031c66ab; // => 0x0000000000d63383941e33a38082ff446712b259
    bytes32 internal constant GLOBAL_MSG_REG = 0x000888695d3e361434f67d9dbd110f1a443822b9005be4d9c2a863ae00d9d263; // => 0x000000000016f898e9a381d0638c215df95d3259
    bytes32 internal constant ALIGNMENT_REG = 0x000888695d3e361434f67d9dbd110f1a443822b900002ab78bc281260274e961; // => 0x00000000005d8eb87dab4ff3d6aa9b7c6381fea3
    bytes32 internal constant COMPONENT_REG = 0x000888695d3e361434f67d9dbd110f1a443822b900160692b83cadc5017b17c1; // => 0x0000000000a0022a42827319be7f3cd40b5fef9c
}
