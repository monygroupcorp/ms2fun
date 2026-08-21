/**
 * GatewayNotice — what a person sees when the public IPFS gateways have started refusing this
 * browser.
 *
 * Two tiers, mounted once at the app shell:
 *
 *  1. The honest notice. Public gateways rate-limit per client IP, so a throttle is a fact about
 *     THIS browser for the next few minutes — not a fault in the app and not a collection with
 *     missing art. Said plainly, with roughly how long, instead of a silent grey box. Non-blocking
 *     and dismissible: a visitor who will never own a gateway can wave it away and keep browsing
 *     whatever is already cached.
 *
 *  2. The door. A personal gateway (a pinning provider's free tier, or your own node) is the only
 *     unmetered path, and the app has always been able to use one — there was simply nowhere to
 *     enter it. The input writes the same store the resolver reads, so a saved gateway takes effect
 *     on the next fetch with no reload. It is checked against a known block before being saved: a
 *     typo'd gateway would sit at the head of the list and fail everything, which is worse than
 *     having none.
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  cooldownEndsAt,
  CUSTOM_GATEWAY_PRIVACY_NOTICE,
  gatewayHealthVersion,
  getIpfsGateways,
  normalizeGateway,
  probeGateway,
  subscribeGatewayHealth,
} from '../../lib/metadata'
import { customGatewayStore } from '../../lib/storage'
import { useLocalStorage } from '../../lib/storage/useLocalStorage'
import styles from './GatewayNotice.module.css'

/** Plain-language remaining time — a countdown to the second would be false precision. */
function humanWait(ms: number): string {
  if (ms <= 45_000) return 'under a minute'
  const minutes = Math.ceil(ms / 60_000)
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`
}

/** A pasted gateway must at least be an absolute http(s) URL before we spend a probe on it. */
function looksLikeGateway(value: string): boolean {
  try {
    const url = new URL(value.trim())
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname !== ''
  } catch {
    return false
  }
}

type SaveState = 'idle' | 'checking' | 'invalid' | 'unreachable' | 'saved'

export function GatewayNotice() {
  const [customGateway, setCustomGateway, removeCustomGateway] = useLocalStorage(customGatewayStore)
  const health = useSyncExternalStore(subscribeGatewayHealth, gatewayHealthVersion, () => 0)
  const [dismissed, setDismissed] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const [draft, setDraft] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('idle')

  // Every gateway cooling → nothing can be requested. A single ready gateway (including the user's
  // own) means fetches are still going out and there is nothing to tell anyone.
  const readyAt = cooldownEndsAt(getIpfsGateways(customGateway), now)
  const waiting = readyAt !== null

  // Only tick while the notice is up: the health store pushes the transition INTO this state, but
  // coming out of it is the clock passing, which nothing else would notice.
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(timer)
  }, [waiting, health])

  // A new throttle window after a dismissal is new information — show it again.
  useEffect(() => {
    if (!waiting) setDismissed(false)
  }, [waiting])

  if (!waiting || dismissed) return null

  async function save(): Promise<void> {
    const value = draft.trim()
    if (!looksLikeGateway(value)) {
      setSaveState('invalid')
      return
    }
    setSaveState('checking')
    const ok = await probeGateway(value)
    if (!ok) {
      setSaveState('unreachable')
      return
    }
    setCustomGateway(normalizeGateway(value))
    setSaveState('saved')
    setDraft('')
  }

  return (
    <div className={styles.notice} role="status" data-testid="gateway-notice">
      <div className={styles.row}>
        <div className={styles.text}>
          <span className={styles.label}>Loading paused</span>
          <span className={styles.msg}>
            The public IPFS gateways are rate-limiting this browser, so new artwork and metadata
            can&rsquo;t be fetched for {humanWait(Math.max((readyAt ?? now) - now, 0))}. This is a
            limit on your connection, not a problem with this app or with the collection — anything
            already loaded stays on screen, and it resumes on its own.
          </span>
        </div>
        <button
          type="button"
          className={styles.dismiss}
          onClick={() => setDismissed(true)}
          data-testid="gateway-notice-dismiss"
        >
          dismiss
        </button>
      </div>

      <div className={styles.door}>
        {customGateway !== null && customGateway.trim() !== '' ? (
          <p className={styles.help} data-testid="gateway-notice-current">
            Your gateway: <code className={styles.code}>{customGateway}</code>{' '}
            <button
              type="button"
              className={styles.linkBtn}
              onClick={() => {
                removeCustomGateway()
                setSaveState('idle')
              }}
              data-testid="gateway-notice-remove"
            >
              remove
            </button>
          </p>
        ) : (
          <>
            <label className={styles.help} htmlFor="custom-gateway-input">
              Have your own IPFS gateway? Paste it here and it will be used first, ahead of the
              public ones. A personal gateway from a pinning provider&rsquo;s free tier or your own
              node both work.
            </label>
            <div className={styles.formRow}>
              <input
                id="custom-gateway-input"
                className={styles.input}
                type="url"
                inputMode="url"
                placeholder="https://your-gateway.example/ipfs/"
                value={draft}
                onChange={(e) => {
                  setDraft(e.currentTarget.value)
                  setSaveState('idle')
                }}
                data-testid="gateway-notice-input"
              />
              <button
                type="button"
                className={styles.saveBtn}
                onClick={() => void save()}
                disabled={saveState === 'checking' || draft.trim() === ''}
                data-testid="gateway-notice-save"
              >
                {saveState === 'checking' ? 'checking…' : 'use it'}
              </button>
            </div>
            <p className={styles.help}>{CUSTOM_GATEWAY_PRIVACY_NOTICE}</p>
          </>
        )}
        {saveState === 'invalid' && (
          <p className={styles.error} data-testid="gateway-notice-error">
            That doesn&rsquo;t look like a URL. It should start with https:// and point at a gateway
            host.
          </p>
        )}
        {saveState === 'unreachable' && (
          <p className={styles.error} data-testid="gateway-notice-error">
            That gateway didn&rsquo;t return a test file we could read, so it hasn&rsquo;t been
            saved. Check the address and try again.
          </p>
        )}
      </div>
    </div>
  )
}
