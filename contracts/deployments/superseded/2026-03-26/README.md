# Superseded Sepolia deployment record — 2026-03-26

These three files describe a Sepolia deployment that **is no longer the deployment the tooling
targets**. They are kept as history and are read by nothing.

| File | What it is |
|---|---|
| `sepolia.json` | `DeploySepolia` output for the 2026-03-26 run |
| `sepolia-seed.json` | phase-1 seed hand-off state written against that run |
| `sepolia.md` | the human-readable address table for that run |

## Why they moved

Two independent reasons, either of which is sufficient:

1. **The salt set that produced those proxy addresses is spent.** The registry proxies were
   deployed through CreateX's CREATE3 entry point under permissioned salts. A salt is single-use
   per deployer: CreateX derives a CREATE2 proxy from the guarded salt, and once that proxy address
   carries code the next `deployCreate3` with the same salt reverts `CreateCollision`. The next
   deploy therefore runs the fresh salt set in `script/SepoliaSalts.sol` and lands on different
   addresses, so nothing in this directory can describe it.

2. **The record predates the current `DeployCore` output shape.** It is missing entries the current
   deploy writes (`DeployBondEscrow` among them), so a consumer that resolves addresses by key
   against it fails partway through rather than at the first read.

## What replaces them

`contracts/deployments/sepolia.json` — written by the deploy run itself
(`cfg.jsonOutputPath` in `script/DeploySepolia.s.sol`). It is a broadcast artifact, so it does not
exist in this tree until that broadcast happens; the seed and validation scripts read it from that
path and fail loudly while it is absent, which is the intended behaviour. Nothing here is a
substitute for it, and none of it should be copied into that path.
