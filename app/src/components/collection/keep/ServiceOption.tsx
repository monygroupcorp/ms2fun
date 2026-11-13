/**
 * Option 2: ask a pinning service the holder uses to pin the collection's roots by CID, through the
 * IPFS Pinning Service API, and follow each request until the service says pinned or failed.
 *
 * Offered only when the status readout found every root on public IPFS: the service fetches by CID
 * from the network, so content the network cannot serve would sit in its queue and fail.
 */
import { useEffect, useRef, useState } from 'react'

import { ROLE_LABEL, type KeepRoot } from '../../../lib/art/keep/plan'
import {
  PSA_PRESETS,
  loadService,
  normaliseServiceEndpoint,
  pinStatus,
  requestPin,
  saveService,
  type PinState,
} from '../../../lib/art/keep/psa'
import styles from './KeepAlive.module.css'

/** How often a pending pin is asked about, and for how long before the panel stops asking. */
export const POLL_MS = 5_000
const POLL_FOR_MS = 30 * 60_000

type Request = {
  root: KeepRoot
  requestid: string | null
  status: PinState | 'error'
  error?: string
}

function presetOf(endpoint: string): string {
  return PSA_PRESETS.find((p) => p.endpoint === endpoint)?.id ?? 'other'
}

export function ServiceOption({
  enabled,
  disabledReason,
  roots,
  name,
  refused,
}: {
  enabled: boolean
  disabledReason: string
  roots: KeepRoot[]
  /** The collection's name, for the pin names the service shows. */
  name: string
  /** Origins a token must never be sent to: ours. */
  refused: readonly (string | null)[]
}) {
  const [saved] = useState(loadService)
  const [endpointText, setEndpointText] = useState(saved?.endpoint ?? PSA_PRESETS[0]!.endpoint)
  const [token, setToken] = useState(saved?.token ?? '')
  const [requests, setRequests] = useState<Request[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const endpoint = normaliseServiceEndpoint(endpointText, refused)
  const preset = presetOf(endpointText)
  const help = PSA_PRESETS.find((p) => p.id === preset)?.tokenHelp

  async function follow(target: string, secret: string, started: Request[]) {
    const deadline = Date.now() + POLL_FOR_MS
    let current = started
    while (alive.current && Date.now() < deadline) {
      if (
        current.every((r) => r.status === 'pinned' || r.status === 'failed' || r.status === 'error')
      ) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_MS))
      if (!alive.current) return
      current = await Promise.all(
        current.map(async (request) => {
          if (
            request.requestid === null ||
            request.status === 'pinned' ||
            request.status === 'failed'
          ) {
            return request
          }
          try {
            const next = await pinStatus(target, secret, request.requestid)
            return { ...request, status: next.status }
          } catch (failure) {
            return {
              ...request,
              status: 'error' as const,
              error: failure instanceof Error ? failure.message : 'the service stopped answering',
            }
          }
        }),
      )
      if (alive.current) setRequests(current)
    }
  }

  async function pin() {
    if (endpoint === null || token.trim() === '') return
    const secret = token.trim()
    setBusy(true)
    setError(null)
    saveService({ endpoint, token: secret })
    const started: Request[] = []
    for (const root of roots) {
      try {
        const status = await requestPin(endpoint, secret, {
          cid: root.cid,
          name: `${name} — ${ROLE_LABEL[root.role]}`,
        })
        started.push({ root, requestid: status.requestid, status: status.status })
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : 'the service refused'
        if (started.length === 0) {
          // The first request settles whether the endpoint and token work at all.
          setError(message)
          setBusy(false)
          return
        }
        started.push({ root, requestid: null, status: 'error', error: message })
      }
    }
    if (!alive.current) return
    setRequests(started)
    setBusy(false)
    await follow(endpoint, secret, started)
  }

  return (
    <li data-testid="keep-service">
      <strong>Pin with my pinning service.</strong> Your service fetches the collection from IPFS by
      its CIDs and keeps it in your account.
      {!enabled ? (
        <p className={styles.note} data-testid="keep-service-disabled">
          {disabledReason}
        </p>
      ) : (
        <>
          <div className={styles.row}>
            {PSA_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn btn-sm"
                aria-pressed={preset === p.id}
                onClick={() => setEndpointText(p.endpoint)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className={styles.field}>
            Pinning Service API endpoint
            <input
              className={styles.input}
              value={endpointText}
              onChange={(event) => setEndpointText(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              data-testid="keep-service-endpoint"
            />
          </label>
          {endpoint === null && endpointText.trim() !== '' && (
            <p className={styles.error} role="alert">
              Enter your service&apos;s http(s) Pinning Service API address.
            </p>
          )}
          <label className={styles.field}>
            Access token{help === undefined ? '' : ` — ${help}`}
            <input
              className={styles.input}
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              spellCheck={false}
              autoComplete="off"
              data-testid="keep-service-token"
            />
          </label>
          <p className={styles.note}>
            Your token goes from this browser straight to the service above, and nowhere else. It is
            kept for this tab only and forgotten when you close it.
          </p>
          <div className={styles.row}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={endpoint === null || token.trim() === '' || busy}
              onClick={() => void pin()}
              data-testid="keep-service-pin"
            >
              Ask my service to pin it
            </button>
            {busy && (
              <span className={styles.note} role="status">
                Sending the pin requests…
              </span>
            )}
          </div>
          {error !== null && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {requests.length > 0 && (
            <ul className={styles.roots} data-testid="keep-service-status">
              {requests.map((request) => (
                <li key={request.root.cid}>
                  <span className={styles.mark}>
                    {request.status === 'pinned'
                      ? '✓'
                      : request.status === 'failed' || request.status === 'error'
                        ? '✗'
                        : '…'}
                  </span>
                  {ROLE_LABEL[request.root.role]} <code>{request.root.cid}</code>{' '}
                  <span className={styles.note}>{request.error ?? request.status}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  )
}
