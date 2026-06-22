# dev-chain

Local anvil mainnet-fork dev loop for the new platform contracts (registries, factories,
modules). This is the viem replacement for the retired ethers-v5 loop now in
`legacy/scripts/local-chain/`.

> Scope: the **new platform** only. The EXEC404 / Cult Executives fossil is already deployed
> elsewhere and is read directly at its mainnet address on the fork — it is not deployed here.

## Usage

```bash
# 1. Start the fork (reads MAINNET_RPC_URL from repo-root .env; never prints it).
pnpm chain:fork            # leave running in its own terminal

# 2. In another terminal: deploy + write src/config/local-deployment.json.
pnpm chain:deploy
```

## Notes

- **Addresses are non-deterministic.** `DeployAnvil.s.sol` derives CreateX salts from
  `block.timestamp`, so every deploy yields fresh addresses. `chain:deploy` rewrites
  `src/config/local-deployment.json` each time — never trust the committed snapshot.
- The committed `local-deployment.json` is a zero-address placeholder so typecheck/build pass
  without a live fork. To stop the regenerated file from showing as dirty in git:
  `git update-index --skip-worktree app/src/config/local-deployment.json`.
- **Seeding is intentionally not ported.** Task-zero ports only the deploy bridge. The demo
  collection world (the old `scenarios/*`) is rebuilt in Phase 3 on the typed viem domain layer
  - the real create flows.
