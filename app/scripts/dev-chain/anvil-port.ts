/**
 * The mainnet dev channel's port, resolved from ANVIL_PORT.
 *
 * `fork.sh`, `stop.sh`, `deploy.ts`, `check.ts` and the dev server's `/__rpc/mainnet` proxy all read
 * the same variable, so one export moves the whole channel and no file is edited to run a second
 * one. Unset or empty means 8545 — the historical port — so the default loop is untouched.
 *
 * The shell half of this lives in `port.sh` (`dev_chain_port`); the two agree on default and on
 * what counts as valid.
 */

export const DEFAULT_ANVIL_PORT = 8545

/**
 * Resolves a port from a raw env value. Exported for the test; callers want {@link anvilPort}.
 *
 * An unset or empty value yields the default. Anything that is not a decimal port number throws
 * rather than reaching anvil or viem, where it would surface later as a connection error that says
 * nothing about the typo that caused it.
 */
export function resolveAnvilPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_ANVIL_PORT

  if (!/^\d+$/.test(raw)) {
    throw new Error(`ANVIL_PORT must be a port number, got '${raw}'`)
  }
  const port = Number(raw)
  if (port < 1 || port > 65535) {
    throw new Error(`ANVIL_PORT must be between 1 and 65535, got '${raw}'`)
  }
  return port
}

/** The port this process should talk to. */
export function anvilPort(): number {
  return resolveAnvilPort(process.env.ANVIL_PORT)
}

/** The JSON-RPC URL for {@link anvilPort}. */
export function anvilRpcUrl(): string {
  return `http://127.0.0.1:${anvilPort()}`
}
