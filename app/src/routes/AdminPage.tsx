/**
 * AdminPage (W-K) — the protocol operator console at `/admin`. Renders the registry-admin panels;
 * each self-gates on its registry's `owner()` (via useOwnerGate) and renders null for non-owners, so
 * a non-operator sees only the heading + a note. The nav link is likewise gated (App.tsx).
 *
 * NOTE: the platform registries are owned by the deployer until the protocol-admin ownership handover
 * runs (deploy.ts, deferred) — so on the dev fork the panels are live for whoever owns the registries.
 */
import { useOwnerGate } from '../components/ui/useOwnerGate'
import { forkAddresses } from '../lib/addresses'
import { MasterRegistryPanel } from '../components/admin/MasterRegistryPanel'
import { AlignmentPanel } from '../components/admin/AlignmentPanel'
import { ComponentRegistryPanel } from '../components/admin/ComponentRegistryPanel'
import { PlatformConfigPanel } from '../components/admin/PlatformConfigPanel'
import { TreasuryPanel } from '../components/admin/TreasuryPanel'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './AdminPage.module.css'

export function AdminPage() {
  const { isOwner } = useOwnerGate(forkAddresses.MasterRegistryV1)

  return (
    <div className={styles.page} data-testid="admin-console">
      <h1 className={`${styles.title} text-chromatic-medium`}>ADMIN</h1>
      {!isOwner && (
        <StateBlock variant="empty">
          you are not the platform operator — admin actions are gated to each registry&apos;s owner.
        </StateBlock>
      )}
      <div className={styles.panels}>
        <MasterRegistryPanel />
        <AlignmentPanel />
        <ComponentRegistryPanel />
        <PlatformConfigPanel />
        <TreasuryPanel />
      </div>
    </div>
  )
}
