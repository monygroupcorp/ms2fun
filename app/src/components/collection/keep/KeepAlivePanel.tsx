/**
 * "Keep this collection alive": a standing panel on the collection page that lets any holder keep a
 * copy of the collection's art on IPFS — on their own node, with their own pinning service, or as a
 * file they download.
 *
 * WHY IT IS HERE. Art that lives at one website lives as long as that website. On IPFS it lives as
 * long as somebody keeps a copy, and the people most likely to want it to last are the people who
 * hold it. This makes keeping a copy one click for them.
 *
 * WHAT IT COSTS US: NOTHING, BY DESIGN. Uploaded art is hosted here as a convenience and belongs on
 * IPFS; nothing is moved there automatically, and the platform pins nothing into an account of its
 * own. Every copy made from this panel is stored by the holder's node or the holder's service. The
 * art host's part is to serve the CAR it already has, and the browser checks every byte of that.
 *
 * Loaded lazily: the collection page pays for this file only when the panel renders, and for the
 * CAR code only when a holder clicks.
 */
import { useReadErc404BondingInstanceMetadataUri } from '../../../generated/contracts'
import { artHostBase } from '../../../lib/art/hostClient'
import type { KeepCar } from '../../../lib/art/keep/build'
import { ROLE_LABEL, onChainRoots, type KeepPlan, type KeepRoot } from '../../../lib/art/keep/plan'
import type { RootCheck } from '../../../lib/art/keep/retrievable'
import { LearnLink } from '../../wizard/LearnLink'
import { useCollection } from '../../useCollection'
import { useCollectionAddresses, useCollectionChainId } from '../useCollectionChain'
import { useHostingStatus } from '../useHostedArt'
import { DownloadOption } from './DownloadOption'
import { NodeOption } from './NodeOption'
import { ServiceOption } from './ServiceOption'
import {
  carFilename,
  formatBytes,
  ourOrigins,
  useKeepCar,
  useKeepStatus,
  usePlan,
  type CarState,
} from './useKeepAlive'
import styles from './KeepAlive.module.css'

export const KEEP_ALIVE_CONCEPT = 'keeping-a-collection-alive'

export default function KeepAlivePanel({ instance }: { instance: `0x${string}` }) {
  const chainId = useCollectionChainId()
  const addresses = useCollectionAddresses()
  const host = artHostBase()
  const { data: base } = useReadErc404BondingInstanceMetadataUri({ address: instance, chainId })
  const hosting = useHostingStatus(instance)
  const { data: card } = useCollection(instance, { chainId, addresses })
  // While the host's record loads, a hosted collection would look like a plain IPFS one.
  const settled = host === null || !hosting.isPending
  const { plan, ready } = usePlan(base, settled ? (hosting.data ?? null) : undefined, host)

  if (!settled || !ready || plan === null) return null
  return <Panel plan={plan} host={host} name={card?.name ?? ''} />
}

function Panel({ plan, host, name }: { plan: KeepPlan; host: string | null; name: string }) {
  const status = useKeepStatus(plan, host)
  const car = useKeepCar(plan)
  const checks = status.data
  const roots = onChainRoots(plan)
  const shownRoots: KeepRoot[] =
    plan.kind === 'hosted' && plan.nextMetaCid !== null
      ? [...roots, { role: 'next-metadata', cid: plan.nextMetaCid }]
      : roots

  const fromHost = plan.kind !== 'ipfs' && plan.host !== null
  const metadataOnIpfs = checks?.some((c) => c.role === 'metadata' && c.ok) ?? false
  const allOnIpfs = checks !== undefined && checks.length > 0 && checks.every((c) => c.ok)
  const buildable = fromHost || metadataOnIpfs
  const buildReason =
    checks === undefined
      ? 'Checking where the art can be fetched from…'
      : 'Nobody is serving this collection on public IPFS right now, and it is not hosted here, so there is nothing to copy from.'
  const serviceReason =
    checks === undefined
      ? 'Checking whether public IPFS can serve it…'
      : 'A pinning service fetches by CID from public IPFS, and the status above shows this collection is not all there yet. Pin it on your own node or download the CAR instead — once a copy is online, this option opens up.'
  const filename = (keep: KeepCar) => carFilename(name, keep)

  return (
    <section className={styles.section} data-testid="keep-alive">
      <h2 className={styles.title}>KEEP THIS COLLECTION ALIVE</h2>
      <p className={styles.note}>
        If you want this collection to outlive any one website, you can keep a copy of its art. A
        copy on your IPFS node or with your pinning service is stored under the same addresses the
        collection names on chain, so it is one more place anyone can fetch the art from. The copy
        is yours: it lives on your node or in your account, never in one of ours.{' '}
        <LearnLink slug={KEEP_ALIVE_CONCEPT} label="Keeping a collection alive" />
      </p>
      <Readout
        plan={plan}
        checks={checks}
        checking={status.isFetching}
        onRecheck={() => void status.refetch()}
      />
      <ol className={styles.options}>
        <NodeOption
          enabled={buildable}
          disabledReason={buildReason}
          build={car.build}
          building={progressLine(car.state)}
          filename={filename}
        />
        <ServiceOption
          enabled={allOnIpfs}
          disabledReason={serviceReason}
          roots={roots}
          name={name === '' ? 'collection' : name}
          refused={ourOrigins(host)}
        />
        <DownloadOption
          enabled={buildable}
          disabledReason={buildReason}
          roots={shownRoots}
          build={car.build}
          building={progressLine(car.state)}
          filename={filename}
        />
      </ol>
      {car.state.kind === 'failed' && (
        <p className={styles.error} role="alert" data-testid="keep-car-error">
          The art could not be copied: {car.state.message}
        </p>
      )}
    </section>
  )
}

function progressLine(state: CarState): string | null {
  if (state.kind !== 'building') return null
  const { stage, bytes, source } = state.progress
  const from = source === '' ? '' : ` from ${source}`
  if (stage === 'packing') return 'Checking and packing the CAR…'
  return `Getting the ${stage}${from} and checking every block… ${formatBytes(bytes)}`
}

function Readout({
  plan,
  checks,
  checking,
  onRecheck,
}: {
  plan: KeepPlan
  checks: RootCheck[] | undefined
  checking: boolean
  onRecheck: () => void
}) {
  const roots = onChainRoots(plan)
  return (
    <div>
      <ul className={styles.status} data-testid="keep-status">
        {roots.map((root) => {
          const check = checks?.find((c) => c.cid === root.cid && c.role === root.role)
          const mark = check === undefined ? '…' : check.ok ? '✓' : '✗'
          return (
            <li key={`${root.role}:${root.cid}`} data-testid={`keep-status-${root.role}`}>
              <span className={styles.mark} aria-hidden="true">
                {mark}
              </span>
              <span>
                {ROLE_LABEL[root.role]}{' '}
                {check === undefined
                  ? 'checking…'
                  : check.ok
                    ? `on public IPFS (served by ${check.operator})`
                    : 'not found on public IPFS gateways'}
              </span>
            </li>
          )
        })}
        {plan.imgCid === null && (
          <li>
            <span className={styles.mark} aria-hidden="true">
              –
            </span>
            <span>
              images: not under one IPFS folder this panel can find, so only the metadata is kept
            </span>
          </li>
        )}
      </ul>
      <p className={styles.note}>
        Asked of public IPFS gateways, never of this site&apos;s own host.{' '}
        <button
          type="button"
          className="btn btn-sm"
          onClick={onRecheck}
          disabled={checking}
          data-testid="keep-recheck"
        >
          check again
        </button>
      </p>
      {plan.kind === 'hosted' && (
        <p className={styles.note}>
          This collection&apos;s art was uploaded here and is hosted as a convenience until its
          creator moves it to IPFS. A copy on a node that is online is what puts it on public IPFS.
        </p>
      )}
    </div>
  )
}
