# ADR-0002 — Router

**Status:** Locked (2026-06-22)
**Date:** 2026-06-22
**Decision owner:** Mony

> Which client router for the React app.

---

## Context

Static SPA, lean, strict-TS, brutalist. ~4 MVP routes (home, profile, collection, wizard). We
want shareable/deep-linkable URLs — notably **referral links for mints** (`?ref=…`), and
possibly wizard-step / edition selectors. Candidates: **wouter** (~1.5KB minimal), **TanStack
Router** (fully type-safe routes/search), **React Router** (standard, heavier).

## Decision

**wouter**, paired with a small **validated-param helper** (zod / viem validators) on the few
URL params that carry meaning.

## Reasoning

- **URL-state capability ≠ router choice.** Shareable links, referral params, refresh-survival,
  back/forward — *every* router provides these. They are not what TanStack Router uniquely sells.
- **TanStack Router's actual premium is compile-time param type-safety.** For ~2–3 meaningful
  params that premium is small, and it is **swappable later** in an app this size.
- **It doesn't even cover the case we care about most.** A `ref` is user-supplied URL input
  touching money, so it must be **runtime-validated** (`viem.isAddress`) — compile-time types do
  nothing against a malformed/malicious value. We hand-write that validation regardless of router,
  which neutralizes TanStack Router's advantage for exactly the referral-link feature.
- **Heavy wizard state doesn't belong in the URL anyway** (uploaded art, long metadata) — that
  wants draft persistence (localStorage / onchain draft), not query params. So the wizard is not
  a URL-routing problem; it's the Phase 2 information-architecture crux.
- **On-ethos:** wouter is ~1.5KB; we own ~10 lines of validated param parsing instead of renting
  a framework and its file-based-routing conventions for them.

## Consequences

- Tiny dependency; trivial hash/history routing that behaves on static hosting (GitHub Pages).
- We own a `validatedSearch()`-style helper (runtime-validated, typed at the boundary) — this is
  where the safety that matters lives (money-bearing `ref`, etc.). Build it in Phase 1/3.

## Revisit if

- URL-encoded state proliferates (many params across many routes) such that compiler-enforced
  links genuinely pay → evaluate **TanStack Router** (it rides the TanStack Query wagmi includes).
