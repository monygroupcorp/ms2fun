# legacy/ — quarantined old frontend

This is the old **microact / micro-web3** frontend, moved here wholesale during Phase 0.

- **Do not import from `legacy/` in `app/`.** This is enforced (invariant G6: ESLint
  `no-restricted-imports` + a CI grep). It is dead code kept only for reference.
- It is **not built, not tested, not shipped.** The live app is in `app/`.
- It will be **deleted wholesale** once `app/` reaches fossil-parity (the new app can do
  everything we need EXEC404 + the MVP to do). No slice-by-slice strangling — see
  `docs/WAR_PATH.md` and `docs/ARCHITECTURE.md`.

If you need a value or pattern from here, *reimplement it cleanly in `app/`* — do not wire
the old code back in.
