# Claude Code Rules for ms2fun

Project-specific rules and conventions for AI-assisted development.

---

## North Star (current direction)

ms2fun is a **lean, onchain-only, statically-hosted boutique launchpad.** No servers,
no backend — all state lives onchain, the app is static, and the whole thing is
**walk-awayable from day 0.**

We are building toward an MVP that has room to grow into the full vision without
building it all at once:

- **Onchain profiles** — one account owns many collections under it (us included, as a creator).
- **Modular collections** — swappable whitelists, vaults, and components.
- **Aave vault** (replaces the old alignment-vault/LP model): 20% of mint/liquidity
  proceeds are deposited to a safe Aave pool; on withdrawal, 20% is tithed to the
  creator's chosen alignment target and 1% to the platform, the rest to the creator.
  A maturity period / pay-to-unlock-early option is a fun future add.
- **Thin owner-operated governance wrapper** — a contract that is the protocol owner's
  decision interface (treasury is a multisig). It can later grow into sellable governance.
  No DAO, no voting, no Moloch — that's all retired.
- **Agent/API surface** — collections can be created and managed programmatically so the
  sister platform **NOEMA** (AI agents that create/manage collections) can hook in.
- **ERC-8244 micro-build** — a parallel, self-contained minified-HTML build of the app
  that can be hosted on-chain. This is a *build target*, not a framework choice.

**Name:** stays **ms2fun** until explicitly changed.

**The fossil:** **EXEC404 / Cult Executives** is the only thing ever deployed live. It uses
the legacy alignment-vault model and is **grandfathered in, preserved no matter what.**
That legacy model is being retired for everything else — but never delete or break EXEC404.

---

## Re-platform in progress

The bespoke **microact** (component framework) and **micro-web3** (web3 layer) are being
**dropped.** Do not build new features on microact patterns — no `h()` lifecycle hacks,
no `shouldUpdate()` overrides to prevent child destruction, no manual-DOM or `setTimeout`
mounting workarounds.

Legacy microact code still exists (including ~83 `.microact.js` twin files) and is being
removed slice by slice as flows are rebuilt. The target stack is not yet locked — see
`docs/plans/NEW_DIRECTION_HANDOFF.md` (recommends Preact + Vite + wagmi/viem). Until it is,
do not start new microact work; ask if a task forces the question.

---

## Mandatory Rules

### 1. One Monorepo — Contracts and Frontend Are One Domain

`contracts/` and the frontend live in the same repo and are worked on together. There is
no boundary: contract changes that a task needs are made directly, in the same effort,
with the same care (tests, deliberate interfaces, simple defensible code). This reversed
the earlier "frontend never touches contracts" rule when we took ownership of the contracts
into this monorepo.

For contracts specifically: lean on the **simplest, most defensible** implementations and
the best-known versions of standard building blocks. Simple beats clever.

---

### 2. No Co-Authored-By in Commits

Do NOT add "Co-Authored-By" lines to git commit messages.

---

### 3. Documentation Discipline — Sacred vs Scratch

Two zones, so generated idea-state docs never pollute (or embarrass) the canonical set:

- **Canonical (tracked, sacred):** top-level `docs/*.md` and `contracts/docs/*.md`.
  Current-truth only — curated, reviewed, kept accurate. Keep this set small.
- **Working (gitignored, local):** `docs/plans/`, `docs/scratch/`, `contracts/docs/plans/`.
  Dated plans, handoffs, audits, generated drafts, session notes. Local until **deliberately
  promoted** — edited down and moved up into the canonical zone.

Default new throwaway/generated docs to the working zone. Only place a doc in the canonical
zone when it is blessed current truth. Don't let canonical docs describe retired models
(governance/DAO, the 1/19/80 alignment-LP split) as if they were live.

---

### 4. Follow Naming Conventions

See `docs/NAMING_CONVENTIONS.md` for component, route, and service naming patterns.

**Quick reference:**
- `*Page` / `*Route` - Route-level components
- `*View` - Major view sections
- `*Panel` - Self-contained UI sections
- `*Card` - Compact display units for lists
- `*Form` - User input collection
- `*Interface` - Complex interactive UI

---

## Design

The **Gallery Brutalism** aesthetic is the design direction (`docs/DESIGN_SYSTEM_V2.md`),
and the HTML demos in `docs/examples/` remain the visual source of truth — match their
structure, spacing, and class names rather than inventing conventional patterns. This is a
design-fidelity rule, independent of whatever rendering stack we land on. (The old
microact-specific "convert HTML to `h()` line-by-line" workflow no longer applies.)

The aesthetic is intentionally minimal and opinionated: desktop nav is sparse, discovery
happens via the homepage, brutalist rejection of decoration/shadows/rounded corners. Don't
add "helpful" conventional features the demos don't have.

---

## Guidelines

### Debug Logging

When debugging component issues, add temporary logs with a component-name prefix:
```javascript
console.log('[ComponentName] description:', data);
```
Remove debug logs before committing unless they provide ongoing value.

---

## Reference Docs

- `docs/NAMING_CONVENTIONS.md` — Component and file naming
- `docs/DESIGN_SYSTEM_V2.md` — Gallery Brutalism design system (current)
- `docs/examples/*.html` — HTML demos (visual source of truth)
- `docs/plans/NEW_DIRECTION_HANDOFF.md` — Re-platform analysis & direction (working zone)
- `docs/DESIGN_SYSTEM.md` — Temple of Capital UI patterns (v1, deprecated)
- `docs/FRONTEND_ARCHITECTURE.md` — System architecture (legacy; describes the retired model)
- `contracts/docs/ARCHITECTURE.md` — Contracts architecture (legacy; pending rewrite for the Aave model)
