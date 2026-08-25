# CREATE3 vanity salt miner

`create3-vanity.c` mines CreateX permissioned CREATE3 salts whose deployed address begins with a
run of zero bytes. It exists because a CreateX salt is **single-use per deployer** — the CREATE2
proxy CreateX derives from the guarded salt is what collides, so once that proxy carries code the
next `deployCreate3` under the same salt reverts `CreateCollision` — which makes a fresh salt set a
prerequisite for every redeploy, not a one-time setup step.

## Build and run

```sh
cd contracts/script/salt-miner
cc -O3 -march=native -pthread -o create3-vanity create3-vanity.c

# the six salts a full protocol deploy needs
./create3-vanity --deployer 0x<broadcasting address> --prefix-bytes 4 --count 6
```

| flag | meaning |
|---|---|
| `--deployer` | the address that will broadcast. **Required** — it is embedded in the salt and CreateX rejects any other sender. |
| `--prefix-bytes` | leading `0x00` bytes required of the address (default 4). |
| `--count` | how many distinct salts to mine (default 6). |
| `--threads` | worker threads (default: all online CPUs). |
| `--seed` | 64-bit entropy seed (default: `/dev/urandom`). |
| `--verify 0x…` | derive and print the address for one 32-byte salt and exit. No mining. |

Output ends with a paste-ready constant block for `script/SepoliaSalts.sol`, which is the only file
the deploy reads salts from. Swapping the set is: run the miner, paste the six literals, run
`forge test --match-path test/coverage/SepoliaSaltSet.t.sol` to re-derive and re-check them.

The binary is a build artifact and is not committed.

## Cost

A `K`-zero-byte prefix is one hit per `2^(8K)` candidates, and each candidate costs three
keccak-f1600 permutations (guarded salt, CREATE2 proxy, RLP of the proxy's first CREATE). Each
additional zero byte costs 256x.

Measured on a 24-core desktop CPU, 30 threads: **~28 M candidates/s**, so a 4-zero-byte hit lands
in roughly 2.5 minutes of wall clock on average and a set of six in well under an hour. A fifth
zero byte would put a single hit in the ~40-hour range on the same machine; that is the wall, and
it is why 4 bytes is the shipped prefix.

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
