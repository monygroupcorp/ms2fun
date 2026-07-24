/**
 * Erc721AdminPanel (W-E + W-B creator admin) — creator-only management for an ERC721 auction
 * instance. Gated on `useOwnerGate(instance).isOwner` (re-asserts on-chain `owner()`); renders
 * nothing for non-owners.
 *
 * The headline action is **queuePiece(string tokenURI) payable** — the missing "add a piece"
 * control: the creator submits a piece's metadata URI plus a deposit (msg.value) that becomes the
 * piece's minimum bid. When the target line is idle the queued piece auto-starts as the live auction.
 * The rest are the standard per-instance creator setters: claim vault fees, migrate the alignment
 * vault, sweep all fees, and toggle agent delegation. All go through the Phase-0 useTxAction +
 * TxButton idiom inside AdminSection / ActionRow.
 */
import { useState } from 'react'
import { erc721AuctionInstanceAbi } from '../../../generated/contracts'
import { AdminSection, ActionRow } from '../../ui/AdminSection'
import { Disclosure } from '../../ui/Disclosure'
import { AmountField } from '../../ui/AmountField'
import { TxButton } from '../../ui/TxButton'
import { parseAmount } from '../../ui/parseAmount'
import { useOwnerGate } from '../../ui/useOwnerGate'
import { useTxAction } from '../../ui/useTxAction'
import { useCollectionChainId } from '../useCollectionChain'
import { useReadErc721AuctionInstanceAgentDelegationEnabled } from '../../../generated/contracts'
import formStyles from './Erc721AdminPanel.module.css'

export function Erc721AdminPanel({ instance }: { instance: `0x${string}` }) {
  const { isOwner } = useOwnerGate(instance)
  if (!isOwner) return null

  return (
    <Disclosure summary="CREATOR ADMIN" testId="erc721-creator-admin">
      <AdminSection title="creator actions" testId="erc721-admin">
        <QueuePieceRow instance={instance} />
        <ClaimVaultFeesRow instance={instance} />
        <MigrateVaultRow instance={instance} />
        <ClaimAllFeesRow instance={instance} />
        <DelegationRow instance={instance} />
      </AdminSection>
    </Disclosure>
  )
}

// ── queuePiece (payable) ───────────────────────────────────────────────────────

function QueuePieceRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const [tokenURI, setTokenURI] = useState('')
  const [minBid, setMinBid] = useState('')
  const tx = useTxAction({
    onSuccess: () => {
      setTokenURI('')
      setMinBid('')
    },
  })

  const value = parseAmount(minBid)
  const uri = tokenURI.trim()
  const canSubmit = uri !== '' && value !== undefined && value > 0n

  function handleQueue(): void {
    if (!canSubmit) return
    tx.send({
      address: instance,
      abi: erc721AuctionInstanceAbi,
      functionName: 'queuePiece',
      args: [uri],
      value,
      chainId: chainId,
    })
  }

  return (
    <ActionRow
      label="queue piece"
      hint="add a new auction piece — the min bid is your creator deposit; auto-starts if the line is idle"
    >
      <div className={formStyles.queueForm}>
        <input
          className={formStyles.uriInput}
          type="text"
          value={tokenURI}
          onChange={(e) => setTokenURI(e.target.value)}
          placeholder="tokenURI — data: or ipfs:// piece metadata"
          disabled={tx.isBusy}
          aria-label="piece token URI"
          data-testid="erc721-queue-uri"
        />
        <AmountField
          value={minBid}
          onChange={setMinBid}
          placeholder="min bid"
          unit="ETH"
          disabled={tx.isBusy}
          ariaLabel="piece minimum bid in ETH"
          testId="erc721-queue-minbid"
        />
        <TxButton
          state={tx.state}
          onClick={handleQueue}
          label="queue piece"
          successLabel="piece queued — tx confirmed."
          onReset={tx.reset}
          disabled={!canSubmit}
          errorText="queue failed — try again"
          testId="erc721-queue-piece"
        />
      </div>
    </ActionRow>
  )
}

// ── claimVaultFees ──────────────────────────────────────────────────────────────

function ClaimVaultFeesRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const tx = useTxAction()
  return (
    <ActionRow label="claim vault fees" hint="sweep accrued alignment-vault yield to the creator">
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: instance,
            abi: erc721AuctionInstanceAbi,
            functionName: 'claimVaultFees',
            chainId: chainId,
          })
        }
        label="claim fees"
        className="btn btn-secondary"
        successLabel="fees claimed — tx confirmed."
        onReset={tx.reset}
        errorText="claim failed — try again"
        testId="erc721-claim-fees"
      />
    </ActionRow>
  )
}

// ── migrateVault(address) ───────────────────────────────────────────────────────

function MigrateVaultRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const [vault, setVault] = useState('')
  const tx = useTxAction({ onSuccess: () => setVault('') })
  const trimmed = vault.trim()
  const isAddress = /^0x[0-9a-fA-F]{40}$/.test(trimmed)

  return (
    <ActionRow label="migrate vault" hint="point the instance at a new alignment vault">
      <div className={formStyles.queueForm}>
        <input
          className={formStyles.addrInput}
          type="text"
          value={vault}
          onChange={(e) => setVault(e.target.value)}
          placeholder="new vault address (0x…)"
          disabled={tx.isBusy}
          aria-label="new vault address"
        />
        <TxButton
          state={tx.state}
          onClick={() => {
            if (!isAddress) return
            tx.send({
              address: instance,
              abi: erc721AuctionInstanceAbi,
              functionName: 'migrateVault',
              args: [trimmed as `0x${string}`],
              chainId: chainId,
            })
          }}
          label="migrate vault"
          className="btn btn-secondary"
          successLabel="vault migrated — tx confirmed."
          onReset={tx.reset}
          disabled={!isAddress}
          errorText="migrate failed — try again"
          testId="erc721-migrate-vault"
        />
      </div>
    </ActionRow>
  )
}

// ── claimAllFees ────────────────────────────────────────────────────────────────

function ClaimAllFeesRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const tx = useTxAction()
  return (
    <ActionRow label="claim all fees" hint="sweep every accrued fee stream to the creator at once">
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: instance,
            abi: erc721AuctionInstanceAbi,
            functionName: 'claimAllFees',
            chainId: chainId,
          })
        }
        label="claim all fees"
        className="btn btn-secondary"
        successLabel="all fees claimed — tx confirmed."
        onReset={tx.reset}
        errorText="claim failed — try again"
        testId="erc721-claim-all-fees"
      />
    </ActionRow>
  )
}

// ── setAgentDelegation(bool) ────────────────────────────────────────────────────

function DelegationRow({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const { data: enabled, refetch } = useReadErc721AuctionInstanceAgentDelegationEnabled({
    address: instance,
    chainId,
  })
  const tx = useTxAction({ onSuccess: () => void refetch() })

  return (
    <ActionRow
      label="agent delegation"
      hint={
        enabled === undefined
          ? 'let a delegated agent queue pieces on your behalf'
          : enabled
            ? 'currently enabled — a delegated agent may queue pieces'
            : 'currently disabled — only the owner may queue pieces'
      }
    >
      <TxButton
        state={tx.state}
        onClick={() =>
          tx.send({
            address: instance,
            abi: erc721AuctionInstanceAbi,
            functionName: 'setAgentDelegation',
            args: [!enabled],
            chainId: chainId,
          })
        }
        label={enabled ? 'disable delegation' : 'enable delegation'}
        className="btn btn-secondary"
        successLabel="delegation updated — tx confirmed."
        onReset={tx.reset}
        disabled={enabled === undefined}
        errorText="update failed — try again"
        testId="erc721-delegation"
      />
    </ActionRow>
  )
}
