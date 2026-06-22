# Contracts — Agent Notes

This directory contains Solidity contracts, Foundry tests, deployment scripts, and build artifacts.

## No Boundary (as of the monorepo consolidation)

Contracts and frontend are one domain in one repo and are worked on together. A frontend task that needs a contract change makes that change directly, in the same effort. The earlier "frontend never touches contracts" separation has been retired.

Treat contract changes with the care they deserve — tests, deliberate interfaces, simple defensible code — but do not avoid them.

## What Belongs Here

- Solidity source (`src/`)
- Foundry tests (`test/`)
- Deployment scripts (`script/`, `scripts/`)
- Build artifacts (`out/`, `broadcast/`, `cache/`)
- Deployment records (`deployments/`)
- Contract documentation (`docs/`, `*.md`)

## What Does Not Belong Here

Frontend code, component logic, CSS, route handlers, adapters, or anything imported by the browser app. Those live in `src/` at the repo root.

## For Contract Workers

See `CLAUDE.md` in this directory for architecture, build commands, and file layout.
