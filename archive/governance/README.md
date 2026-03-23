# Governance (Archived)

DAO governance UI and services for ms2.fun, built around the GrandCentral contract.

Archived 2026-03-22. Removed from active routing to simplify launch scope.

## Contents

- `GovernancePage.js` — Consolidated single-page governance hub with 8 tabs
- `route-governance-v2.css` — Route-specific styles
- `GovernanceEventIndexer.js` — Event indexer for proposals, votes, shares, treasury
- `GrandCentralAdapter.js` — Contract adapter for GrandCentral DAO
- `seed-governance.js` — Local chain seeding script
- `demos/` — 9 HTML demo files (source of truth for UI design)
- `plans/` — Implementation planning docs

## Contracts

The GrandCentral contract and related governance contracts still exist in `contracts/src/`. Only the frontend was archived.

## Restoring

To restore, move files back to their original locations and re-add the route registrations in `src/index.js`, the nav link in `MobileNav.js`, and the service imports in `ServiceFactory.js`.
