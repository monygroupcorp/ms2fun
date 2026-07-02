import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'wouter'
import { useAccount } from 'wagmi'
import { ProfileView } from '../components/ProfileView'
import { ProfileEditForm } from '../components/ProfileEditForm'
import { CreatorCollections } from '../components/CreatorCollections'
import { MessageFeed } from '../components/MessageFeed'
import { MessageComposer } from '../components/MessageComposer'
import { useProfileMetadata } from '../components/useProfileMetadata'
import { usePortfolio } from '../components/portfolio/usePortfolio'
import { HeldPanel, VaultsPanel } from '../components/portfolio/PortfolioPanels'
import { heldCount, fmtEth } from '../components/portfolio/portfolioFormat'
import { TxButton } from '../components/ui/TxButton'
import { useTxAction } from '../components/ui/useTxAction'
import {
  profileRegistryAbi,
  useReadProfileRegistryProfileUri,
  useWriteProfileRegistrySetProfile,
} from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { profileToDataUri, type ProfileMetadata } from '../lib/metadata'
import { StateBlock } from '../components/ui/StateBlock'
import styles from './ProfilePage.module.css'

/** Validate and normalize a param string to `0x${string}` or undefined. */
function toAddress(raw: string | undefined): `0x${string}` | undefined {
  if (!raw) return undefined
  if (/^0x[0-9a-fA-F]{40}$/.test(raw)) return raw as `0x${string}`
  return undefined
}

/**
 * Profile route — handles both `/profile` (own profile when wallet is connected) and
 * `/profile/:address` (any address). Read-path is wallet-independent; edit controls appear only
 * when the connected wallet matches the displayed address.
 */
export function ProfilePage() {
  const params = useParams<{ address?: string }>()
  const { address: connected } = useAccount()

  const paramAddress = toAddress(params.address)
  const target: `0x${string}` | undefined = paramAddress ?? connected

  const { data, isPending, isError, queryKey } = useReadProfileRegistryProfileUri({
    address: forkAddresses.ProfileRegistry,
    chainId: forkChainId,
    args: [target ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!target },
  })

  const uri = data || undefined
  const metadata = useProfileMetadata(uri)
  // The profileURI read resolves fast; the metadata fetch (IPFS/data) lands later. While a URI
  // exists but its metadata hasn't resolved, the edit form would init blank — gate editing on this
  // so a save can't overwrite the profile with empties.
  const metadataPending = !!uri && metadata === undefined

  const {
    writeContract,
    isPending: isSaving,
    isSuccess: isSaved,
  } = useWriteProfileRegistrySetProfile()

  // After a successful write, refetch the on-chain URI + its metadata so the view reflects the save
  // (the fork mines instantly; on a slow chain this refetch races the receipt — acceptable here).
  const queryClient = useQueryClient()
  const refetchProfile = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey })
    void queryClient.invalidateQueries({ queryKey: ['profile-metadata'] })
  }, [queryClient, queryKey])
  useEffect(() => {
    if (!isSaved) return
    refetchProfile()
  }, [isSaved, refetchProfile])

  // clearProfile() — wipes the connected wallet's on-chain profile URI; own-profile only. On a
  // confirmed receipt, refetch the URI + metadata so the view drops back to the empty/setup state.
  const clearTx = useTxAction({ onSuccess: refetchProfile })

  const isOwn = !!connected && !!target && connected.toLowerCase() === target.toLowerCase()

  // Held / Vaults tabs read the target's portfolio (own or a visitor's — the aggregator is
  // address-parameterized). The plate leads with the work, so Made is the default tab.
  const portfolio = usePortfolio(target)
  const [tab, setTab] = useState<'made' | 'held' | 'vaults'>('made')

  const [editing, setEditing] = useState(false)

  function handleSave(m: ProfileMetadata) {
    writeContract({
      address: forkAddresses.ProfileRegistry,
      chainId: forkChainId,
      args: [profileToDataUri(m)],
    })
    setEditing(false)
  }

  // No wallet and no param — the region-level connect gate (NOESIS .noesis-gate device).
  if (!target) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← ms2.fun
          </Link>
        </nav>
        <div className={`noesis-gate ${styles.gate}`}>
          <span className="big">Connect to see your plate</span>
          <span className="cap">Your made work, your holdings, and your alignment standing.</span>
        </div>
      </div>
    )
  }

  // Malformed param — surface a clear message rather than crashing
  if (params.address !== undefined && paramAddress === undefined) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← ms2.fun
          </Link>
        </nav>
        <StateBlock variant="empty">invalid address in URL</StateBlock>
      </div>
    )
  }

  const claimable = portfolio.data?.[3] ?? 0n
  const vaultCount = (portfolio.data?.[2] ?? []).filter(
    (v) => v.contribution > 0n || v.shares > 0n || v.claimable > 0n,
  ).length

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>

      {isPending && <StateBlock variant="loading">hanging the work…</StateBlock>}
      {isError && (
        <StateBlock variant="error">could not reach registry — is the fork up?</StateBlock>
      )}

      {/* Own profile, not yet set up: prompt to set up the plate. NB this is about the PROFILE, not
          the work — your made collections still render in the "Made" tab below regardless. */}
      {isOwn && !uri && !isPending && !isError && !editing && (
        <StateBlock variant="empty" boxed>
          <span className="big">Your profile isn&rsquo;t set up yet</span>
          <span className="cap">
            Add a name and avatar so collectors can find you. Your collections are already shown below.
          </span>
          <button className={styles.setupBtn} onClick={() => setEditing(true)}>
            Set up your profile
          </button>
        </StateBlock>
      )}

      {isOwn && !uri && !isPending && !isError && editing && (
        <ProfileEditForm key="new" saving={isSaving} onSave={handleSave} />
      )}

      {/* The plate: framed identity + a standing strip, then the tabbed galleries. */}
      {!isPending && !isError && (!isOwn || !!uri) && (
        <div className={styles.plate}>
          <ProfileView
            address={target}
            metadata={metadata}
            {...(isOwn ? { onEdit: () => setEditing(true) } : {})}
          />
          <div className="noesis-standing">
            <div className="sr">
              <span className="k">Works held</span>
              <span className="v">{heldCount(portfolio.data)}</span>
            </div>
            <div className="sr">
              <span className="k">Vault positions</span>
              <span className="v">{vaultCount}</span>
            </div>
            <button
              type="button"
              className={`sr claim ${styles.claimRow}`}
              onClick={() => setTab('vaults')}
            >
              <span className="k">Claimable →</span>
              <span className="v">{fmtEth(claimable)} ETH</span>
            </button>
          </div>
        </div>
      )}

      {!isPending && !isError && (
        <>
          <nav className="noesis-tabs">
            <button
              type="button"
              className={`${styles.tab} ${tab === 'made' ? styles.tabOn : ''}`}
              onClick={() => setTab('made')}
            >
              Made
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'held' ? styles.tabOn : ''}`}
              onClick={() => setTab('held')}
            >
              Held
            </button>
            <button
              type="button"
              className={`${styles.tab} ${tab === 'vaults' ? styles.tabOn : ''}`}
              onClick={() => setTab('vaults')}
            >
              Vaults
            </button>
          </nav>

          <div className={styles.tabBody}>
            {tab === 'made' && (
              <div data-testid="profile-collections">
                <CreatorCollections creator={target} />
              </div>
            )}
            {tab === 'held' && (
              <HeldPanel
                data={portfolio.data}
                isPending={portfolio.isPending}
                isError={portfolio.isError}
                truncated={portfolio.truncated}
              />
            )}
            {tab === 'vaults' && (
              <VaultsPanel
                data={portfolio.data}
                isPending={portfolio.isPending}
                isError={portfolio.isError}
                isOwn={isOwn}
              />
            )}
          </div>
        </>
      )}

      {/* The wall — a comment section beneath the work (reuses the salon devices). */}
      {!isPending && !isError && (
        <section className={styles.wall}>
          <h2 className={styles.wallHead}>The wall</h2>
          {isOwn && <MessageComposer channel={target} />}
          <MessageFeed filter={{ sender: target }} />
        </section>
      )}

      {/* Edit bar: only when the profile is already set up */}
      {isOwn && !!uri && !isPending && !isError && (
        <div className={styles.editBar}>
          <button
            className="btn"
            onClick={() => setEditing((e) => !e)}
            disabled={isSaving || (metadataPending && !editing)}
          >
            {editing ? 'Cancel' : 'Edit profile'}
          </button>
          {isSaving && <span className={styles.savingNote}>saving…</span>}
          {isSaved && !isSaving && !editing && <span className={styles.savedNote}>saved</span>}
          {!editing && (
            <TxButton
              state={clearTx.state}
              onClick={() =>
                clearTx.send({
                  address: forkAddresses.ProfileRegistry,
                  chainId: forkChainId,
                  abi: profileRegistryAbi,
                  functionName: 'clearProfile',
                })
              }
              label="clear profile"
              successLabel="profile cleared"
              onReset={clearTx.reset}
              disabled={isSaving}
              className="btn"
              testId="profile-clear"
            />
          )}
        </div>
      )}

      {isOwn && !!uri && editing && (
        <ProfileEditForm
          key={uri}
          {...(metadata !== undefined ? { initial: metadata } : {})}
          saving={isSaving}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
