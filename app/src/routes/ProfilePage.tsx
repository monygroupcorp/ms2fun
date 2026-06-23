import { useState } from 'react'
import { Link, useParams } from 'wouter'
import { useAccount } from 'wagmi'
import { ProfileView } from '../components/ProfileView'
import { ProfileEditForm } from '../components/ProfileEditForm'
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

  const { data, isPending, isError } = useReadProfileRegistryProfileUri({
    address: forkAddresses.ProfileRegistry,
    chainId: forkChainId,
    args: [target ?? '0x0000000000000000000000000000000000000000'],
    query: { enabled: !!target },
  })

  const uri = (data as string | undefined) || undefined
  const metadata = useProfileMetadata(uri)

  const {
    writeContract,
    isPending: isSaving,
    isSuccess: isSaved,
  } = useWriteProfileRegistrySetProfile()

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

      {isOwn && !isPending && !isError && (
        <div className={styles.editBar}>
          <button className="btn" onClick={() => setEditing((e) => !e)} disabled={isSaving}>
            {editing ? 'Cancel' : 'Edit profile'}
          </button>
          {isSaving && <span className={styles.savingNote}>saving…</span>}
          {isSaved && !isSaving && !editing && <span className={styles.savedNote}>saved</span>}
        </div>
      )}

      {isOwn && editing && (
        <ProfileEditForm
          {...(metadata !== undefined ? { initial: metadata } : {})}
          saving={isSaving}
          onSave={handleSave}
        />
      )}
    </div>
  )
}
