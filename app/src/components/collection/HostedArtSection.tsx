/**
 * Hosted art on the collection page: where it stands, for everyone, and — for the owner — the three
 * steps that move it to IPFS.
 *
 * The policy is that art belongs on IPFS. Hosting is a convenience for launching without IPFS, not
 * a permanence promise, and nothing here sets a deadline: the art host keeps serving until its
 * operator acts. Creators are encouraged to move once the collection graduates, so a graduated,
 * unmoved collection shows its owner a clear recommendation, and every owner is offered:
 *
 *   1. get the art on IPFS — a CAR of the images and the regenerated metadata, built in this
 *      browser from the host's copy, to upload to a pinning service the creator controls
 *   2. check it — a sample of both roots fetched from public gateways, never from the art host
 *   3. point the collection at it — `setMetadataURI("ipfs://<migrated root>/")`
 *
 * The platform pins nothing into an account of its own and holds no credential of the creator's.
 *
 * Renders nothing when the build names no art host, or when the host has no record of this
 * collection — every collection launched with an IPFS link of its own.
 */
import { useEffect, useState } from 'react'

import {
  erc404BondingInstanceAbi,
  useReadErc404BondingInstanceMetadataUri,
} from '../../generated/contracts'
import { artHostBase, type HostingStatus } from '../../lib/art/hostClient'
import { isMigratedBase, migratedBaseUri } from '../../lib/art/ipfsMigration'
import type { MigrationCar, MigrationStage, RetrievalResult } from '../../lib/art/migrate'
import { TxButton } from '../ui/TxButton'
import { useOwnerGate } from '../ui/useOwnerGate'
import { useTxAction } from '../ui/useTxAction'
import { useCollectionChainId } from './useCollectionChain'
import { useHostingStatus, useMigratedMetaCid } from './useHostedArt'
import styles from './HostedArtSection.module.css'

function hostName(host: string): string {
  try {
    return new URL(host).host
  } catch {
    return host
  }
}

export function HostedArtSection({ instance }: { instance: `0x${string}` }) {
  const host = artHostBase()
  const { data: status } = useHostingStatus(instance)
  const { isOwner } = useOwnerGate(instance)
  const chainId = useCollectionChainId()
  const { data: onChainBase, refetch } = useReadErc404BondingInstanceMetadataUri({
    address: instance,
    chainId,
  })
  const { data: migratedCid } = useMigratedMetaCid(status)

  if (host === null || status == null) return null

  const verified =
    migratedCid !== undefined &&
    onChainBase !== undefined &&
    isMigratedBase(onChainBase, migratedCid)

  return (
    <section className={styles.section} data-testid="hosted-art">
      <h2 className={styles.title}>ART HOSTING</h2>
      <Summary status={status} host={host} verified={verified} />
      {isOwner && !verified && (
        <MigrationSteps
          instance={instance}
          host={host}
          status={status}
          migratedCid={migratedCid}
          onMoved={() => void refetch()}
        />
      )}
    </section>
  )
}

/** The public line: what state the hosting is in and when it ends. */
function Summary({
  status,
  host,
  verified,
}: {
  status: HostingStatus
  host: string
  verified: boolean
}) {
  const where = hostName(host)
  if (verified) {
    return (
      <p className={styles.note}>
        <span className={styles.badge} data-testid="hosted-art-verified">
          verified on IPFS
        </span>{' '}
        This collection points at its art on IPFS, and its metadata is exactly what the hosted
        images regenerate to.
      </p>
    )
  }
  switch (status.state) {
    case 'hosted':
      return (
        <p className={styles.note} data-testid="hosted-art-state">
          This collection&apos;s art is hosted by {where} under its IPFS address, as a convenience
          for launching. Art belongs on IPFS; the creator is encouraged to move it there once the
          collection graduates.
        </p>
      )
    case 'graduated':
      return (
        <p className={styles.note} data-testid="hosted-art-state">
          This collection has graduated. Its art is still hosted by {where}; moving it to IPFS is
          the recommended next step.
        </p>
      )
    case 'migrated':
      return (
        <p className={styles.note} data-testid="hosted-art-state">
          This collection&apos;s art has moved to IPFS.
        </p>
      )
  }
}

type Build =
  | { kind: 'idle' }
  | { kind: 'building'; stage: MigrationStage }
  | { kind: 'built'; car: MigrationCar; url: string }
  | { kind: 'failed'; message: string }

type Check =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'done'; result: RetrievalResult }
  | { kind: 'failed'; message: string }

const STAGE: Record<MigrationStage, string> = {
  downloading: 'Downloading the hosted art…',
  verifying: 'Checking every block against its CID…',
  regenerating: 'Writing the IPFS metadata…',
  packing: 'Packing the CAR…',
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'something went wrong'

function MigrationSteps({
  instance,
  host,
  status,
  migratedCid,
  onMoved,
}: {
  instance: `0x${string}`
  host: string
  status: HostingStatus
  migratedCid: string | undefined
  onMoved: () => void
}) {
  const chainId = useCollectionChainId()
  const [build, setBuild] = useState<Build>({ kind: 'idle' })
  const [check, setCheck] = useState<Check>({ kind: 'idle' })
  const tx = useTxAction({ instance, onSuccess: onMoved })

  // The CAR is held as an object URL; release it when it is replaced or the panel goes.
  const carUrl = build.kind === 'built' ? build.url : null
  useEffect(() => {
    if (carUrl === null) return
    return () => URL.revokeObjectURL(carUrl)
  }, [carUrl])

  const ready = status.pieces.length > 0 && migratedCid !== undefined
  const where = hostName(host)
  const base = migratedCid === undefined ? null : migratedBaseUri(migratedCid)
  const checked = check.kind === 'done' && check.result.ok

  async function buildCar() {
    try {
      const { buildMigrationCar } = await import('../../lib/art/migrate')
      setBuild({ kind: 'building', stage: 'downloading' })
      const car = await buildMigrationCar(host, status.imgCid, status.pieces, (stage) =>
        setBuild({ kind: 'building', stage }),
      )
      setBuild({ kind: 'built', car, url: URL.createObjectURL(car.car) })
    } catch (error) {
      setBuild({ kind: 'failed', message: errorText(error) })
    }
  }

  async function runCheck() {
    if (migratedCid === undefined) return
    setCheck({ kind: 'checking' })
    try {
      const { checkRetrievable } = await import('../../lib/art/migrate')
      setCheck({
        kind: 'done',
        result: await checkRetrievable(status.imgCid, migratedCid, status.pieces),
      })
    } catch (error) {
      setCheck({ kind: 'failed', message: errorText(error) })
    }
  }

  return (
    <div className={styles.steps} data-testid="hosted-art-migrate">
      {status.state === 'graduated' && (
        <p className={styles.recommend} data-testid="hosted-art-recommend">
          Your collection has graduated — a good time to move its art to IPFS, where it belongs.{' '}
          {where} will keep serving it in the meantime; the three steps below take a few minutes.
        </p>
      )}
      {status.state === 'hosted' && (
        <p className={styles.note}>
          Your art is hosted by {where} for now. You can move it to IPFS whenever you like; once the
          collection graduates, we recommend it.
        </p>
      )}
      {!ready && (
        <p className={styles.note}>
          The art host is still reading this collection&apos;s pieces. Check back in a minute.
        </p>
      )}

      <ol className={styles.list}>
        <li>
          <strong>Get the art on IPFS.</strong> Build a CAR of your images and their IPFS metadata,
          then upload it to a pinning service you control — Pinata, Filebase, or any service that
          imports CAR files. Pinning its one root keeps both the images and the metadata.
          <div className={styles.row}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!ready || build.kind === 'building'}
              onClick={() => void buildCar()}
              data-testid="hosted-art-build"
            >
              Build the CAR
            </button>
            {build.kind === 'building' && <span className={styles.note}>{STAGE[build.stage]}</span>}
          </div>
          {build.kind === 'failed' && (
            <p className={styles.error} role="alert">
              {build.message}
            </p>
          )}
          {build.kind === 'built' && (
            <p className={styles.note}>
              <a href={build.url} download={`${build.car.rootCid}.car`}>
                Download the CAR
              </a>{' '}
              and pin root <code>{build.car.rootCid}</code>. It holds images{' '}
              <code>{build.car.imgCid}</code> and metadata <code>{build.car.metaCid}</code>.
            </p>
          )}
        </li>
        <li>
          <strong>Check it is retrievable.</strong> Public IPFS gateways — not {where} — are asked
          for a sample of your images and metadata.
          <div className={styles.row}>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!ready || check.kind === 'checking'}
              onClick={() => void runCheck()}
              data-testid="hosted-art-check"
            >
              Check public gateways
            </button>
            {check.kind === 'checking' && <span className={styles.note}>Asking gateways…</span>}
          </div>
          {check.kind === 'done' && check.result.ok && (
            <p className={styles.note} data-testid="hosted-art-check-ok">
              {check.result.operator} served a sample of both. It is safe to point the collection at
              IPFS.
            </p>
          )}
          {check.kind === 'done' && !check.result.ok && (
            <div className={styles.error} role="alert">
              Not retrievable yet. A fresh pin can take a few minutes to reach public gateways.
              <ul>
                {check.result.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </div>
          )}
          {check.kind === 'failed' && (
            <p className={styles.error} role="alert">
              {check.message}
            </p>
          )}
        </li>
        <li>
          <strong>Point the collection at IPFS.</strong> One transaction sets the per-token base to{' '}
          <code>{base ?? '…'}</code>.
          <div className={styles.row}>
            <TxButton
              state={tx.state}
              onClick={() => {
                if (base === null || !checked) return
                tx.send({
                  address: instance,
                  abi: erc404BondingInstanceAbi,
                  functionName: 'setMetadataURI',
                  args: [base],
                  chainId,
                })
              }}
              label="set IPFS metadata"
              successLabel="the collection now points at IPFS"
              onReset={tx.reset}
              disabled={base === null || !checked}
              disabledHint="check that the art is retrievable first"
              className="btn btn-primary"
              testId="hosted-art-set-base"
            />
          </div>
        </li>
      </ol>
    </div>
  )
}
