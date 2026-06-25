/**
 * ComponentRegistryPanel (W-K3, Interface K — protocol admin console) — owner-only management for the
 * ComponentRegistry, the on-chain allowlist of component singletons (gating / liquidity / staking /
 * curve computers) that factories may wire into new instances. Gated on
 * `useOwnerGate(forkAddresses.ComponentRegistry).isOwner` (re-asserts the on-chain Solady `owner()`);
 * renders nothing for non-owners.
 *
 * Actions go through the Phase-0 useTxAction + TxButton idiom inside AdminSection / ActionRow:
 *  - approveComponent(address component, bytes32 tag, string name) — the tag is a bytes32 identifier.
 *    The admin enters it as a plain string (e.g. "curve_computer") which is encoded right-padded via
 *    `toHex(value, { size: 32 })`; an "advanced" toggle accepts a raw 0x… 32-byte value verbatim
 *    (e.g. a keccak256 feature tag).
 *  - revokeComponent(address component).
 *
 * The current state is rendered from `getApprovedComponents()` → `address[]` so the admin sees the
 * live allowlist; it refetches after each confirmed approve/revoke.
 */
import { useState } from 'react'
import { isAddress, toHex } from 'viem'
import { componentRegistryAbi } from '../../generated/contracts'
import { useReadComponentRegistryGetApprovedComponents } from '../../generated/contracts'
import { AdminSection, ActionRow } from '../ui/AdminSection'
import { TxButton } from '../ui/TxButton'
import { useOwnerGate } from '../ui/useOwnerGate'
import { useTxAction } from '../ui/useTxAction'
import { forkAddresses, forkChainId } from '../../lib/addresses'
import styles from './ComponentRegistryPanel.module.css'

const registry = forkAddresses.ComponentRegistry
const RAW_BYTES32 = /^0x[0-9a-fA-F]{64}$/

/** Build the bytes32 tag from admin input: a raw 0x…(64 hex) verbatim, else a plain string right-padded. */
function encodeTag(value: string, raw: boolean): `0x${string}` | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (raw) return RAW_BYTES32.test(trimmed) ? (trimmed as `0x${string}`) : undefined
  // `toHex(string, { size: 32 })` rejects strings longer than 32 bytes — guard so the UI can disable.
  try {
    return toHex(trimmed, { size: 32 })
  } catch {
    return undefined
  }
}

export function ComponentRegistryPanel() {
  const { isOwner } = useOwnerGate(registry)

  const { data: approved, refetch } = useReadComponentRegistryGetApprovedComponents({
    address: registry,
    chainId: forkChainId,
    query: { enabled: isOwner },
  })

  if (!isOwner) return null

  return (
    <AdminSection title="component registry" testId="admin-component">
      <ApprovedList components={approved} />
      <ApproveComponentRow onDone={() => void refetch()} />
      <RevokeComponentRow onDone={() => void refetch()} />
    </AdminSection>
  )
}

// ── current state: getApprovedComponents() → address[] ──────────────────────────

function ApprovedList({ components }: { components: readonly `0x${string}`[] | undefined }) {
  return (
    <ActionRow
      label="approved components"
      hint="the live allowlist factories may wire into instances"
    >
      <div className={styles.list} data-testid="admin-component-list">
        {components === undefined ? (
          <span className={styles.empty}>loading…</span>
        ) : components.length === 0 ? (
          <span className={styles.empty}>none approved yet</span>
        ) : (
          <ul className={styles.addrList}>
            {components.map((addr) => (
              <li key={addr} className={styles.addr}>
                {addr}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ActionRow>
  )
}

// ── approveComponent(address component, bytes32 tag, string name) ────────────────

function ApproveComponentRow({ onDone }: { onDone: () => void }) {
  const [component, setComponent] = useState('')
  const [tag, setTag] = useState('')
  const [name, setName] = useState('')
  const [rawTag, setRawTag] = useState(false)
  const tx = useTxAction({
    onSuccess: () => {
      setComponent('')
      setTag('')
      setName('')
      onDone()
    },
  })

  const addr = component.trim()
  const addrValid = isAddress(addr)
  const encodedTag = encodeTag(tag, rawTag)
  const trimmedName = name.trim()
  const canSubmit = addrValid && encodedTag !== undefined && trimmedName !== '' && !tx.isBusy

  function handleApprove(): void {
    if (!addrValid || encodedTag === undefined || trimmedName === '') return
    tx.send({
      address: registry,
      abi: componentRegistryAbi,
      functionName: 'approveComponent',
      args: [addr as `0x${string}`, encodedTag, trimmedName],
      chainId: forkChainId,
    })
  }

  const tagInvalid = tag.trim() !== '' && encodedTag === undefined

  return (
    <ActionRow
      label="approve component"
      hint="allowlist a gating / liquidity / staking / curve component singleton"
    >
      <div className={styles.form}>
        <input
          className={styles.input}
          type="text"
          value={component}
          onChange={(e) => setComponent(e.target.value)}
          placeholder="component address (0x…)"
          disabled={tx.isBusy}
          aria-label="component address"
          data-testid="admin-component-address"
        />
        <input
          className={styles.input}
          type="text"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          placeholder={rawTag ? 'raw bytes32 (0x… 64 hex)' : 'tag — e.g. curve_computer'}
          disabled={tx.isBusy}
          aria-label="component tag"
          data-testid="admin-component-tag"
        />
        {encodedTag !== undefined && !rawTag && (
          <span className={styles.preview} data-testid="admin-component-tag-preview">
            tag bytes32: {encodedTag}
          </span>
        )}
        {tagInvalid && (
          <span className={styles.invalid}>
            {rawTag ? 'enter a 0x-prefixed 32-byte (64 hex) value' : 'tag must be ≤ 32 bytes'}
          </span>
        )}
        <label className={styles.advanced}>
          <input
            type="checkbox"
            checked={rawTag}
            onChange={(e) => setRawTag(e.target.checked)}
            disabled={tx.isBusy}
            data-testid="admin-component-tag-raw"
          />
          advanced: raw 0x bytes32
        </label>
        <input
          className={styles.input}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="display name"
          disabled={tx.isBusy}
          aria-label="component name"
          data-testid="admin-component-name"
        />
        <TxButton
          state={tx.state}
          onClick={handleApprove}
          label="approve component"
          successLabel="component approved — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="approve failed — try again"
          testId="admin-approve-component"
        />
      </div>
    </ActionRow>
  )
}

// ── revokeComponent(address component) ───────────────────────────────────────────

function RevokeComponentRow({ onDone }: { onDone: () => void }) {
  const [component, setComponent] = useState('')
  const tx = useTxAction({
    onSuccess: () => {
      setComponent('')
      onDone()
    },
  })

  const addr = component.trim()
  const addrValid = isAddress(addr)

  function handleRevoke(): void {
    if (!addrValid) return
    tx.send({
      address: registry,
      abi: componentRegistryAbi,
      functionName: 'revokeComponent',
      args: [addr as `0x${string}`],
      chainId: forkChainId,
    })
  }

  return (
    <ActionRow label="revoke component" hint="remove a component from the allowlist">
      <div className={styles.form}>
        <input
          className={styles.input}
          type="text"
          value={component}
          onChange={(e) => setComponent(e.target.value)}
          placeholder="component address (0x…)"
          disabled={tx.isBusy}
          aria-label="component address to revoke"
          data-testid="admin-revoke-component-address"
        />
        <TxButton
          state={tx.state}
          onClick={handleRevoke}
          label="revoke component"
          className="btn btn-secondary"
          successLabel="component revoked — tx confirmed."
          onReset={tx.reset}
          disabled={!addrValid || tx.isBusy}
          errorText="revoke failed — try again"
          testId="admin-revoke-component"
        />
      </div>
    </ActionRow>
  )
}
