# ADR-0001 — Web3 library stack

**Status:** Proposed (pending human lock)
**Date:** 2026-06-22
**Decision owner:** Mony
**Supersedes:** the bespoke `micro-web3` (ethers v5 wrapper) being retired with the re-platform.

> Evidence-based comparison of the libraries we depend on for chain access and React
> integration. Written because "everyone uses it" is not a defense.

---

## Context & constraints

The app is **statically hosted, onchain-only (no backend), "walk-awayable" (no hosted/vendor
services or relays on the core path), lean, strict-TS, and must lower the bus-factor** that
killed the bespoke stack. Wallet priority is **EIP-6963 injected wallets**; we **hand-roll the
brutalist connect UI** (no prebuilt modal kit). Two layers to decide:

1. **Low-level** — RPC, ABI encode/decode, types, signing, reads/writes.
2. **React integration** — connectors, account/chain state, read/write hooks, tx lifecycle, caching.

---

## Decision (proposed)

**Low-level: `viem`. React: `wagmi`, configured injected-only** — own/public RPC transports,
`multiInjectedProviderDiscovery: true`, **no `walletConnect` connector, no `projectId`/`clientId`,
no vendor account.** Brutalist UI is hand-authored on wagmi's headless hooks. Both are by **wevm**,
**MIT**, the same team as `abitype`/`ox`/`mipd`.

**Fallbacks, named explicitly:** if wevm shows abandonment signals, **ethers v6** is the
low-level fallback; if our contract surface turns out genuinely tiny, **viem-only + a thin
`mipd`-backed discovery hook** is an acceptable, leaner React-layer alternative.

---

## Options considered — evidence (observed 2026-06-22)

### Low-level layer

| | viem | ethers v6 | web3.js | ox / micro-eth-signer |
|---|---|---|---|---|
| Latest | 2.53.1 (Jun 2026) | 6.17.0 (Jun 2026) | **archived Mar 4 2025** | ox 0.14.x (pre-1.0) |
| Maintenance | very active (~2 rel/wk) | active, slowing | dead | active / active |
| npm weekly | ~4.8M | ~1.7–2.1M | ~566k (falling) | transitive / low |
| ABI-typed | best (abitype) | manual annotation | inferior | n/a |
| Bundle | ~27–35 kB | ~130–200 kB | bloated | tiny |
| API stability | 2.x since Jan 2024 | stable now; v5→v6 was rough (40+ breaks) | frozen | pre-1.0, can break |
| Bus-factor | 2 (wevm) | **1 (ricmoo)** | — | 2 / 1 |

- **web3.js: disqualified** — ChainSafe archived it 2025-03-04 (custodial transfer to the EF, not a revival). No upstream fixes.
- **ox / micro-eth-signer: wrong altitude** — primitives for library authors / minimal apps; viem already sits on ox. Reach below viem only if we need *only* signing/encoding.
- **ethers v6: the real alternative** — mature, incumbent, but heavier, weaker ABI typing, and a *worse* bus-factor (single maintainer) than viem.

### React integration layer

| | viem-only + hooks | **wagmi** | thirdweb v5 | Reown AppKit | Privy/Dynamic |
|---|---|---|---|---|---|
| Vendor coupling (core path) | **none** | **none** (projectId only for *optional* WC) | **mandatory clientId + hosted RPC** | **mandatory projectId + relay** | **mandatory hosted backend** |
| EIP-6963 | you build (or +mipd) | **native, default-on** | native | native | as connector |
| Hand-rolled UI fit | perfect | excellent (headless) | ok | **poor (modal kit)** | connector-only |
| Bundle | leanest | viem + TanStack Query + ~19 kB | self-claimed lean | **>1 MB** | medium-heavy |
| License | MIT | **MIT** | Apache (code only) | custom | Apache/MIT |
| Walk-awayable? | **yes** | **yes** | **no** | **no** | **no** |

**The vendor options fail our hard constraint, not a preference:** thirdweb requires a
`clientId` baked into the static bundle + metered hosted RPC; Reown AppKit *throws* without a
Cloud `projectId` even in injected-only mode and ships a >1 MB modal we'd use none of;
Privy/Dynamic require a hosted signing enclave. All three break "walk-awayable / no servers."
That leaves only the two wevm options.

---

## Why wagmi over viem-only (given we hand-roll the UI)

Hand-rolling the **UI** does not mean hand-rolling the **state machine**. wagmi is *headless* —
it imposes zero UI, so the brutalist constraint removes its only redundant layer (connect
components) while keeping the part that is genuinely subtle to build correctly:

- EIP-6963 discovery (default-on via `mipd`),
- reconnect-with-`rdns` persistence,
- EIP-1193 `accountsChanged`/`chainChanged`/`disconnect` → React state without stale closures,
- multi-tab sync, and read caching via TanStack Query.

viem already gives the one genuinely hard primitive — `waitForTransactionReceipt` (block
polling, confirmations, timeout, repriced-tx `onReplaced`) — so the gap is *not* tx lifecycle;
it's discovery + reconnect + event plumbing + caching. Going viem-only "properly" means pulling
in `mipd` + TanStack Query and re-implementing ~70% of wagmi **without its tests/hardening** —
which *raises* bus-factor risk, the opposite of our goal and a return to the bespoke trap.

---

## Consequences

**Good:** smallest defensible bundle with full ABI-typed reads/writes; zero vendor coupling;
MIT/forkable; the ecosystem default (easy hiring/AI-assist/examples); deletes whole categories
of code we'd otherwise hand-maintain (the micro-web3 reason for existing).

**The honest risk — bus-factor:** viem + wagmi + abitype + ox + mipd are effectively driven by
~two people at wevm, funded by sponsors/grants (the team has publicly noted funding
unpredictability). This is the single real knock.

**Why we accept it:** (1) the alternative low-level lib, ethers, is a *one*-person project — worse;
(2) the alternative React approach, roll-your-own, is the exact bespoke single-maintainer trap we
are fleeing; (3) MIT + ecosystem-standard means a community fork is viable if wevm stops; (4) we
pin versions and adopt upgrades deliberately. Net: the most-defensible choice *for our values*,
risk acknowledged not hidden.

---

## Revisit if

- wevm shows abandonment signals (release cadence collapses, security issues unaddressed) → evaluate **ethers v6**.
- A breaking **viem 3.0 / wagmi 4.0** lands → assess migration cost before adopting; pin until then.
- We need **mobile/remote wallets** → add the `walletConnect` connector, *consciously* accepting its hosted-relay + `projectId` vendor coupling for that path only.
- Contract surface proves tiny → consider dropping wagmi for **viem-only + mipd hook**.
