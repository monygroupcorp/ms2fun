# legacy/scripts — quarantined

The pre-viem ethers-v5 dev tooling. **Nothing here is imported by the live app** (see the
top-level `legacy/README.md` quarantine policy).

- `local-chain/` — the old ethers-v5 anvil deploy **and seed** loop. Phase 1 task-zero replaced
  the **deploy bridge** with the viem version at `app/scripts/dev-chain/`. The **seed scenarios**
  (`local-chain/scenarios/*`, `local-chain/seed-common.mjs`) are NOT yet reimplemented — they are
  the reference for the Phase 3 reseed on the typed viem domain layer. Delete at that parity.
- `verify-seed-data.mjs` — old seed verifier, paired with the above.
