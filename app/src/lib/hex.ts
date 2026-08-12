/**
 * Shared hex sentinels used across the app.
 *
 * These live in `lib/` because both `lib/` and `components/` need them, and the dependency
 * direction is one-way (`routes → components → lib → generated`).
 */

/** bytes32 zero — the "open tier" sentinel (no password) the password module treats as tier 0. */
export const ZERO_BYTES32 =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as const
