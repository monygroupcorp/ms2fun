# Contracts — Agent Boundary Notice

**If you are working on a frontend task, stop here.**

This directory contains Solidity contracts, Foundry tests, deployment scripts, and build artifacts. Frontend workers — human or AI — do not modify anything in this directory.

## The Rule

Frontend work never touches contracts. If a frontend task surfaces a need to change a contract, ABI, or deployment config:

1. **Make a note** of what needs to change and why
2. **Continue the frontend task** with the current contract state (mock, stub, or skip the blocked behavior)
3. **Hand off the note** to whoever owns contracts work

Do not edit `.sol` files, deployment scripts, ABIs, or config to unblock a frontend task. The separation is intentional.

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
