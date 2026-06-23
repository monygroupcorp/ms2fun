import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'wouter'
import { useAccount } from 'wagmi'
import { ProfileView } from '../components/ProfileView'
import { ProfileEditForm } from '../components/ProfileEditForm'
import { CreatorCollections } from '../components/CreatorCollections'
import { MessageFeed } from '../components/MessageFeed'
import { MessageComposer } from '../components/MessageComposer'
import { useProfileMetadata } from '../components/useProfileMetadata'
import {
  useReadProfileRegistryProfileUri,
  useWriteProfileRegistrySetProfile,
} from '../generated/contracts'
import { forkAddresses, forkChainId } from '../lib/addresses'
import { profileToDataUri, type ProfileMetadata } from '../lib/metadata'
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
  useEffect(() => {
    if (!isSaved) return
    void queryClient.invalidateQueries({ queryKey })
    void queryClient.invalidateQueries({ queryKey: ['profile-metadata'] })
  }, [isSaved, queryClient, queryKey])

  const isOwn = !!connected && !!target && connected.toLowerCase() === target.toLowerCase()

  const [editing, setEditing] = useState(false)

  function handleSave(m: ProfileMetadata) {
    writeContract({
      address: forkAddresses.ProfileRegistry,
      chainId: forkChainId,
      args: [profileToDataUri(m)],
    })
    setEditing(false)
  }

  // No wallet and no param — prompt to connect
  if (!target) {
    return (
      <div className={styles.page}>
        <nav className={styles.crumb}>
          <Link href="/" className={styles.back}>
            ← ms2.fun
          </Link>
        </nav>
        <h1 className={`${styles.title} text-chromatic-medium`}>PROFILE</h1>
        <p className={styles.note}>connect your wallet to view your profile</p>
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
        <h1 className={`${styles.title} text-chromatic-medium`}>PROFILE</h1>
        <p className={styles.note}>invalid address in URL</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <nav className={styles.crumb}>
        <Link href="/" className={styles.back}>
          ← ms2.fun
        </Link>
      </nav>
      <h1 className={`${styles.title} text-chromatic-medium`}>PROFILE</h1>

      {isPending && <p className={styles.note}>loading profile…</p>}
      {isError && <p className={styles.note}>could not reach registry — is the fork up?</p>}

      {!isPending && !isError && <ProfileView address={target} metadata={metadata} />}

      {!isPending && !isError && <CreatorCollections creator={target} />}

      {!isPending && !isError && <MessageFeed filter={{ sender: target }} />}

      {isOwn && !isPending && !isError && <MessageComposer channel={target} />}

      {isOwn && !isPending && !isError && (
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
        </div>
      )}

      {isOwn && editing && (
        <ProfileEditForm
          key={uri ?? 'new'}
          {...(metadata !== undefined ? { initial: metadata } : {})}
          saving={isSaving}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
