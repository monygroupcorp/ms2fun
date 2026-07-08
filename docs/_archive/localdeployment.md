## Local Fork Deployment Methodology (npm run betatype)

This document summarizes the procedure we use to deploy smart contracts onto a locally forked mainnet (Anvil) when running `npm run betatype`. The same approach can be adapted to other projects that need deterministic local state while mirroring mainnet context.

### 1. Prerequisites

- **Tooling**: Foundry (for `forge` and `anvil`), Node.js 18+, npm, and `browser-sync`/`serve` via `npx`.
- **Environment variables**: `MAINNET_RPC_URL` must point to an HTTPS mainnet provider (Alchemy, Infura, etc.). Optionally set `COLASSEUM_LIVE_RELOAD=false` to disable BrowserSync.
- **Dependencies**: Run `npm install` once so `start-colasseum-betatype.mjs` can import ethers, filesystem helpers, etc.
- **Artifacts**: `forge build` must succeed so the `out/` directory contains the JSON artifacts for every contract we deploy.

### 2. Build Contracts

`npm run betatype` triggers `forge build` first. This guarantees Solidity sources and ABIs/bytecode in `out/`. If adapting this process, make sure each contract you intend to deploy has a corresponding compiled artifact and is included in the deploy list.

### 3. Start an Anvil Mainnet Fork

We launch Anvil with:

```bash
anvil --fork-url "$MAINNET_RPC_URL" --chain-id 1337
```

Key characteristics:

- RPC endpoint lives at `http://127.0.0.1:8545`.
- Chain ID is fixed to 1337 so MetaMask and the frontend agree on the network.
- The script polls the RPC (`ethers.JsonRpcProvider.getNetwork()`) until Anvil is responsive.
- A control server on port 8788 is started to expose `/colasseum-warp` (time travel), `/colasseum-log` (log ingestion), and `/milady-metadata` (resource proxy). These helpers ensure the frontend can manipulate block timestamps and record UI telemetry without leaving the local environment.

### 4. Configure Wallets & Provider

- Provider: `new ethers.JsonRpcProvider("http://127.0.0.1:8545")`.
- Deployer: default Anvil key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` (Address `0xf39F...92266`).
- Additional actors: `PLAYER_ADDRESS`, `USER_WALLET_ADDRESS`, and `CHARITY_ADDRESS` are hardcoded to deterministic Anvil accounts so the frontend can simulate both challengers and participants consistently.

Before deploying contracts we fund the non-deployer actors via `anvil_setBalance`, e.g.:

```javascript
await provider.send("anvil_setBalance", [PLAYER_ADDRESS, "0x56BC75E2D63100000"]); // 100 ETH
```

This gives each account ample ETH for interactions without needing faucets.

### 5. Deployment Sequence

Using ethers.js `ContractFactory`, we deploy contracts sequentially while manually tracking nonce values to avoid race conditions:

1. **MockBeaconOracle** – provides deterministic randomness.
2. **Groth16Verifier** – verifies zk proofs.
3. **FortressColasseum** – core protocol, constructed with oracle/verifier addresses plus charity info.
4. **CoolNFT** – mock NFT collection for trial collateral.
5. **ColasseumDebug** – helper contract for testing utilities.

For each artifact we:

```javascript
const artifact = JSON.parse(await fs.readFile("./out/Path/Contract.json"));
const Factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, deployer);
const contract = await Factory.deploy(constructorArgs..., { nonce: nonce++ });
await contract.waitForDeployment();
```

Tracking nonce manually keeps deployment order deterministic and reproducible. After deployment we log the addresses and capture them for frontend consumption.

### 6. Initialize On-Chain State

After all contracts are live we perform several actions so the frontend has meaningful data immediately:

- **Oracle seeding**: compute `keccak256("colasseum-betatype", latestBlock.timestamp)` and call `oracle.setSeed(...)`. This ensures consistent randomness per run.
- **NFT Minting**: mint one showcase NFT to the user wallet (for UI previews) and another to the deployer so it can be used as collateral.
- **Approval & Trial Creation**:
  1. Approve the Colasseum contract to transfer the deployer’s freshly minted NFT.
  2. Calculate a deposit equal to 5% of the appraisal value (`APPRAISAL_VALUE = 0.2 ETH`).
  3. Call `colasseum.challenge(...)` with the NFT address, token ID, appraisal, lore, and `value` deposit to open a “Genesis” trial.
- **Record trial ID**: read `colasseum.nextTrialId()` after the transaction so we know which trial to display by default.

These steps can be adapted to any project: mint or seed the minimum viable data set that your frontend/tests expect before users interact.

### 7. Persist Deployment Metadata for Frontend

We write `app-colasseum/config.json` containing:

- All deployed contract addresses
- RPC URL & chain ID (1337)
- Control server endpoints (time warp, log capture, metadata proxy)
- Player/user wallet addresses, funding level, and charity parameters
- Oracle seed, appraisal price, ticket price, default lore, and genesis trial ID

The UI reads this file at startup, so updating it is the final synchronization step. For other projects, mirror this approach by having your backend/deployment script emit a JSON config the frontend can ingest.

### 8. Serve the Frontend

- If `COLASSEUM_LIVE_RELOAD` is unset or any value except `false`, BrowserSync runs on port 3333 with live reload watching `app-colasseum/**`.
- Otherwise, we fall back to `npx serve --no-etag app-colasseum` for a static server.

The script prints final instructions: ensure MetaMask points to `http://127.0.0.1:8545` with chain ID 1337, import an Anvil key, and open the BrowserSync URL.

### 9. Adapting the Method

To reuse this methodology for another project:

1. Compile contracts with Foundry or your preferred tool and collect artifacts.
2. Fork mainnet (or any network) with Anvil, specifying the RPC URL and chain ID you plan to emulate.
3. Programmatically deploy each contract with ethers.js, capturing addresses and maintaining a deterministic order.
4. Seed any required on-chain state (fund accounts, mint tokens, initialize protocols) to match your frontend/test expectations.
5. Emit a machine-readable manifest (JSON) describing contract addresses, network configuration, helper endpoints, and default entities.
6. Serve your frontend pointing at that manifest and the local RPC.

Following these steps ensures a reproducible local environment that mirrors production dependencies while remaining fully deterministic for integration testing and demo purposes.
