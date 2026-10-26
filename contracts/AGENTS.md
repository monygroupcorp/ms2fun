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

Frontend code, component logic, CSS, route handlers, adapters, or anything imported by the browser app. Those live in `app/`.

## For Contract Workers

See `docs/ARCHITECTURE.md` for architecture and file layout, and the README for build commands.

## Comments

A comment says what a thing is and why it is that way, and nothing else. The code and its tests say the rest.

- **Present tense.** Describe the contract as it is. No history: not what it used to be, what a fix changed, what was collapsed or removed, or what is "now" true. A reader has the code; git has the past.
- **Minimal.** One line where one line carries it; a short paragraph only for an invariant, a trust boundary or a non-obvious reason. Do not restate the code, and do not narrate a function line by line.
- **The why, stated as a fact.** "Pooled, so a withdrawal lands pro-rata" rather than "we pool because the old design…". Cite the invariant, the standard or the test that pins it, by name.
- **No chatter.** No ticket, PR, issue or audit-finding numbers, dates, or names of who ruled. A rule that matters is stated as the rule.
- **No apology, hedge or warning of work to come.** None of TODO, FIXME, XXX, HACK, "for now", "later", "eventually", "temporary", "parked", "deferred", "not yet", "re-audit", "audit required", "before deploy", or the same idea in other words. If a comment carried a real obligation, do it, file it as a goal, or delete the comment.
- **Trust statements are facts.** Say who can do what and what gates it ("only a seated ambassador for the target, while it is curated, can withdraw"). Do not say an audit is owed or done; audit status lives in `audits/`.
- **NatSpec** (`@notice`, `@dev`, `@param`, `@return`) follows the same rules; `@notice` is one sentence for a reader of the ABI.
- A comment change leaves the build output identical but for metadata.
