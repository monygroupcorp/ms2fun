/**
 * Option 1: pin the collection on the holder's own IPFS node (IPFS Desktop, or kubo).
 *
 * One click: find the node, build and check the CAR, send it with `dag import --pin-roots`, and ask
 * the node to confirm each root is pinned. Nothing goes to the node before that click. A node that
 * will not answer this page gets the one-time setup, spelled out for this page's origin.
 */
import { useState } from 'react'

import type { KeepCar } from '../../../lib/art/keep/build'
import {
  DEFAULT_NODE_API,
  detectNode,
  importCar,
  normaliseEndpoint,
  originsToAllow,
  pinType,
  PUBLISHED_ORIGINS,
  setupCommands,
  type NodeIdentity,
} from '../../../lib/art/keep/kubo'
import { ROLE_LABEL, type KeepRoot } from '../../../lib/art/keep/plan'
import { nodeApiStore } from '../../../lib/storage/keys'
import { formatBytes } from './useKeepAlive'
import styles from './KeepAlive.module.css'

type Run =
  | { kind: 'idle' }
  | { kind: 'detecting' }
  | { kind: 'setup'; reason: 'blocked' | 'unreachable'; endpoint: string }
  | { kind: 'building' }
  | { kind: 'sending'; sent: number; total: number }
  | { kind: 'importing' }
  | { kind: 'confirming' }
  | { kind: 'done'; node: NodeIdentity; pinned: { root: KeepRoot; type: string }[] }
  | { kind: 'failed'; message: string }

export function NodeOption({
  enabled,
  disabledReason,
  build,
  building,
  filename,
}: {
  enabled: boolean
  disabledReason: string
  build: () => Promise<KeepCar | null>
  /** The shared CAR's progress line, while it builds. */
  building: string | null
  filename: (keep: KeepCar) => string
}) {
  const [typed, setTyped] = useState(() => nodeApiStore.get() ?? DEFAULT_NODE_API)
  const [run, setRun] = useState<Run>({ kind: 'idle' })
  const endpoint = normaliseEndpoint(typed)
  const busy =
    run.kind === 'detecting' ||
    run.kind === 'building' ||
    run.kind === 'sending' ||
    run.kind === 'importing' ||
    run.kind === 'confirming'

  async function pin() {
    if (endpoint === null) return
    setRun({ kind: 'detecting' })
    const found = await detectNode(endpoint)
    if (found.kind !== 'ready') {
      setRun({ kind: 'setup', reason: found.kind, endpoint })
      return
    }
    nodeApiStore.set(endpoint === DEFAULT_NODE_API ? null : endpoint)
    setRun({ kind: 'building' })
    const keep = await build()
    if (keep === null) {
      setRun({ kind: 'idle' })
      return
    }
    try {
      setRun({ kind: 'sending', sent: 0, total: keep.car.size })
      const imported = await importCar(endpoint, keep.car, filename(keep), (sent, total) =>
        setRun(sent >= total ? { kind: 'importing' } : { kind: 'sending', sent, total }),
      )
      const refused = imported.roots.find((root) => root.pinError !== '')
      if (refused !== undefined)
        throw new Error(`the node did not pin ${refused.cid}: ${refused.pinError}`)
      setRun({ kind: 'confirming' })
      const pinned: { root: KeepRoot; type: string }[] = []
      for (const root of keep.roots) {
        const type = await pinType(endpoint, root.cid)
        if (type === null) throw new Error(`the node does not list ${root.cid} as pinned`)
        pinned.push({ root, type })
      }
      setRun({ kind: 'done', node: found.node, pinned })
    } catch (error) {
      setRun({
        kind: 'failed',
        message: error instanceof Error ? error.message : 'the node did not take the CAR',
      })
    }
  }

  return (
    <li data-testid="keep-node">
      <strong>Pin to my IPFS node.</strong> For IPFS Desktop or a kubo node on this computer: the
      art is checked here, block by block, then sent to your node, which pins it and keeps serving
      it to the network while it is online.
      <label className={styles.field}>
        Your node&apos;s API address
        <input
          className={styles.input}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          spellCheck={false}
          autoComplete="off"
          data-testid="keep-node-endpoint"
        />
      </label>
      {endpoint === null && typed.trim() !== '' && (
        <p className={styles.error} role="alert">
          Enter an http:// or https:// address, such as {DEFAULT_NODE_API}.
        </p>
      )}
      <div className={styles.row}>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!enabled || endpoint === null || busy}
          onClick={() => void pin()}
          data-testid="keep-node-pin"
        >
          Pin to my IPFS node
        </button>
        <RunLine run={run} building={building} />
      </div>
      {!enabled && <p className={styles.note}>{disabledReason}</p>}
      {run.kind === 'setup' && <SetupBox reason={run.reason} endpoint={run.endpoint} />}
      {run.kind === 'failed' && (
        <p className={styles.error} role="alert">
          {run.message}
        </p>
      )}
      {run.kind === 'done' && (
        <div className={styles.box} data-testid="keep-node-done">
          <p className={styles.note}>
            Pinned on your node <code>{run.node.id.slice(0, 16)}…</code> ({run.node.agentVersion}):
          </p>
          <ul className={styles.roots}>
            {run.pinned.map(({ root, type }) => (
              <li key={root.cid}>
                <span className={styles.mark}>✓</span> {ROLE_LABEL[root.role]}{' '}
                <code>{root.cid}</code> <span className={styles.note}>({type})</span>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            Your node serves it to anyone who asks while it is running. To keep it for good, keep
            the node, or give the CIDs to a pinning service too.
          </p>
        </div>
      )}
    </li>
  )
}

function RunLine({ run, building }: { run: Run; building: string | null }) {
  const text = (() => {
    switch (run.kind) {
      case 'detecting':
        return 'Looking for your node…'
      case 'building':
        return building ?? 'Getting the art…'
      case 'sending':
        return `Sending to your node… ${formatBytes(run.sent)} of ${formatBytes(run.total)}`
      case 'importing':
        return 'Your node is importing and pinning…'
      case 'confirming':
        return 'Asking your node to confirm the pins…'
      default:
        return null
    }
  })()
  return text === null ? null : (
    <span className={styles.note} role="status">
      {text}
    </span>
  )
}

/** The one-time setup: let this page talk to the node. */
export function SetupBox({
  reason,
  endpoint,
}: {
  reason: 'blocked' | 'unreachable'
  endpoint: string
}) {
  const here = typeof window === 'undefined' ? '' : window.location.origin
  const commands = setupCommands(endpoint, originsToAllow(here, PUBLISHED_ORIGINS))
  return (
    <div className={styles.box} role="alert" data-testid="keep-node-setup">
      {reason === 'blocked' ? (
        <p className={styles.note}>
          Your node is there, but it does not answer web pages until you allow them. This is a
          one-time setup.
        </p>
      ) : (
        <p className={styles.note}>
          Nothing answered at <code>{endpoint}</code>. Check that IPFS Desktop or{' '}
          <code>ipfs daemon</code> is running. If it is, it most likely needs this one-time setup.
        </p>
      )}
      <p className={styles.note}>Run these once, in a terminal:</p>
      <pre data-testid="keep-node-commands">{commands.join('\n')}</pre>
      <p className={styles.note}>
        Then restart IPFS: quit and reopen IPFS Desktop, or stop and start <code>ipfs daemon</code>.
        In IPFS Desktop you can make the same change under Settings, in the IPFS config, at{' '}
        <code>API.HTTPHeaders</code>. The first command replaces the list of allowed pages; if you
        have added your own, keep them in it.
      </p>
      <p className={styles.note}>
        If your browser asks whether this site may reach devices on your local network, allow it:
        that is the request to your own node. Then press the button again.
      </p>
    </div>
  )
}
