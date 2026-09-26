# CREATE3 vanity salt miner

`create3-vanity.c` mines CreateX permissioned CREATE3 salts whose deployed address begins with a
chosen run of hex digits. It exists because a CreateX salt is **single-use per deployer** — the
CREATE2 proxy CreateX derives from the guarded salt is what collides, so once that proxy carries
code the next `deployCreate3` under the same salt reverts `CreateCollision` — which makes a fresh
salt set a prerequisite for every redeploy, not a one-time setup step.

**This mines SALTS, not keys.** The deployer's own address is a different search — a keypair hunt,
one secp256k1 point per candidate, whose output is a private key — and it is not this tool's job.
Use `cast wallet vanity` for that, and do not extend this file to do it: its search is seeded from
64 bits with a `time(NULL)` fallback and an explicit reproducible `--seed`, all of which is harmless
for a public salt and is the Profanity failure mode for a key.

## Build and run

```sh
cd contracts/script/salt-miner
cc -O3 -march=native -pthread -o create3-vanity create3-vanity.c

# the six salts a full protocol deploy needs. Five zero bytes is what ships; on this CPU that is
# a multi-day run, so the real mine goes to createXcrunch on a GPU — see Cost.
./create3-vanity --deployer 0x<broadcasting address> --prefix-bytes 5 --count 6

# check a set somebody else's miner produced, one salt at a time, before a deploy spends it
./create3-vanity --verify 0x<32-byte salt>
```

| flag | meaning |
|---|---|
| `--deployer` | the address that will broadcast. **Required** — it is embedded in the salt and CreateX rejects any other sender. |
| `--prefix-hex` | the leading hex digits required of the address, e.g. `000888`. A `0x` prefix is optional and an odd number of digits is fine — the last one constrains only the high nibble of its byte. Wins over `--prefix-bytes`. |
| `--prefix-bytes` | leading `0x00` **bytes** required of the address (default 5, matching the shipped set). Sugar for `--prefix-hex` over `2N` zeroes. |
| `--count` | how many distinct salts to mine (default 6). |
| `--threads` | worker threads (default: all online CPUs). |
| `--seed` | 64-bit entropy seed (default: `/dev/urandom`). |
| `--verify 0x…` | derive and print the address for one 32-byte salt and exit. No mining. |

Output ends with a paste-ready constant block for `script/SepoliaSalts.sol`, which is the only file
the deploy reads salts from. Swapping the set is: run the miner, paste the six literals, run
`forge test --match-path test/coverage/SepoliaSaltSet.t.sol` to re-derive and re-check them.

**What you mine must match the salt set's own declaration.** `SepoliaSalts` declares
`ADDRESS_PREFIX` and `ADDRESS_PREFIX_NIBBLES` — the digits and how many of them are meant, because
`0x000888` and `0x888` are the same number and only the count says the first is six nibbles — and the
salt-set test shifts every derived address down to that width and compares. A set mined to a
different prefix is rejected by the suite rather than silently accepted. Change the declaration and
the six literals together.

**One set serves both chains.** The derivation takes no chain id (byte 20 is `0x00`), so the same
deployer under the same salt yields the same address on every chain, and the CREATE2 proxy that
collides is per-chain — so a set spent on Sepolia is still unspent on mainnet. Mine once, deploy the
same six addresses twice.

The binary is a build artifact and is not committed.

## Cost

A prefix of `N` nibbles is one hit per `2^(4N)` candidates, and each candidate costs three
keccak-f1600 permutations (guarded salt, CREATE2 proxy, RLP of the proxy's first CREATE). Each
additional nibble costs 16x, so each additional whole byte costs 256x.

**THE SHIPPED SETS ARE MINED ON A GPU, AND THIS MINER IS NOT WHAT MINED THEM.** The five-zero-byte
set in `SepoliaSalts.sol` was produced with [createXcrunch](https://github.com/HrikB/createXcrunch),
a Rust CreateX salt miner with an OpenCL kernel, and it took **hours**. Plan a mine against that
number. The table below is this C miner on a CPU, which is between two and three orders of magnitude
slower, and reading it as the cost of a re-mine is how a one-evening job gets budgeted as a
multi-day one — or, worse, how a set gets mined shorter than it needed to be to fit an imaginary
deadline.

Measured on this repository's reference box, 32 cores, idle: **~27 M candidates/s** (26.7–26.9 across runs).

| prefix | nibbles | candidates per hit | one hit (CPU) | a set of six (CPU) |
|---|---|---|---|---|
| `000888` | 6 | `2^24` ≈ 1.7e7 | under a second | a few seconds |
| 4 bytes | 8 | `2^32` ≈ 4.3e9 | ~2.7 min | ~16 min |
| 5 bytes | 10 | `2^40` ≈ 1.1e12 | ~11 h | ~2.7 days |
| 6 bytes | 12 | `2^48` ≈ 2.8e14 | ~16 weeks | out of reach |

**5 bytes is what shipped**, and it is the default above. 6 bytes is the wall on any hardware.

So what is this miner for? Two things, and neither is the bulk mine:

- **Verifying somebody else's output.** `--verify` re-derives the address from a 32-byte salt using
  the documented derivation and nothing else. A salt is public and guarded by `msg.sender`, so the
  risk a vanity miner carries is not theft but a salt that does not produce the address it claims —
  and that risk is closed by re-deriving it here, and again in Solidity by
  `test/coverage/SepoliaSaltSet.t.sol`, which asserts every address off the constants. **Whatever
  mines a set, check it with both before a deploy spends one.**
- **A mine short enough not to need a GPU.** At four nibbles or fewer this is done before a GPU has
  finished initialising.

The deployer address is an input to every salt, so changing the broadcasting wallet re-mines the
whole set from scratch — on whichever tool, that is the cost that actually bites.

What the surrendered zero bytes buy back is calldata gas, at 4 per zero byte against 16 per
non-zero: an address in calldata is 260 gas at five leading zero bytes, 272 at four, and 308 at
`0x000888`'s one. So dropping a byte to shorten a mine is worth **12 gas per address appearance** —
which is a reason to mine the longer prefix when the hardware makes it an evening rather than a
week.

These are means of a memoryless search, not deadlines — an individual hit can take several times the
figure above. `--count 6` mines the six independently, so a set's total is the sum and not the max.

## What it computes

A CreateX salt packs three fields into 32 bytes:

| bytes | field |
|---|---|
| `0..19` | the deployer address — CreateX's permissioned-deploy guard |
| `20` | cross-chain redeploy-protection flag: `0x00` off (mined here), `0x01` mixes `block.chainid` in |
| `21..31` | free entropy, 88 bits — the only field the miner varies |

With the flag off:

```
guardedSalt = keccak256(abi.encodePacked(uint256(uint160(deployer)), salt))
proxy       = last20(keccak256(0xff ++ CREATEX ++ guardedSalt ++ PROXY_INITCODE_HASH))
address     = last20(keccak256(0xd6 ++ 0x94 ++ proxy ++ 0x01))
```

`PROXY_INITCODE_HASH` is `keccak256(hex"67363d3d37363d34f03d5260086018f3")`, the CreateX CREATE3
proxy init code. The deployed contract's bytecode is not an input to any of this, so a mined salt
produces the same address whatever is deployed through it — which is why one set of six salts
serves six different registry proxies.

`--verify` reproduces a known salt/address pair end-to-end, so the derivation can be checked
against any already-deployed CreateX CREATE3 address before trusting a freshly mined set.
