/**
 * ConfigureGatingRow — post-create tier-gating config for a creator-owned instance (ERC1155 + ERC404).
 *
 * The factory threads tier config in at create time; THIS row is the after-create path — the instance
 * owner authors the first config (the module allows owner-or-factory first config) or replaces an
 * existing one. Calls `PasswordTierGatingModule.configureFor(instance, TierConfig)` directly on the
 * instance's gating module. Renders nothing when the instance has no gating module.
 *
 * Passwords are write-only on-chain (hashes), so the form can't be prefilled — submitting REPLACES the
 * tier set. The hint surfaces how many tiers are currently configured. Shares the wizard's SchemaForm
 * + encoder so create and edit stay in lockstep.
 */
import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { passwordTierGatingModuleAbi } from '../../generated/contracts'
import { forkChainId } from '../../lib/addresses'
import {
  getConfigSchema,
  encodeTierConfig,
  hasTierConfig,
  validateTierConfig,
  validateFields,
} from '../../lib/wizard'
import { ActionRow } from '../ui/AdminSection'
import { TxButton } from '../ui/TxButton'
import { useTxAction } from '../ui/useTxAction'
import { SchemaForm } from '../wizard/SchemaForm'
import styles from './ConfigureGatingRow.module.css'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

/** Minimal ABI to read the instance's gating module (shared by ERC1155 + ERC404 instances). */
const GATING_MODULE_ABI = [
  {
    type: 'function',
    name: 'gatingModule',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

export function ConfigureGatingRow({ instance }: { instance: `0x${string}` }) {
  const { data: module } = useReadContract({
    address: instance,
    abi: GATING_MODULE_ABI,
    functionName: 'gatingModule',
    chainId: forkChainId,
  })
  const hasModule = !!module && module !== ZERO_ADDRESS

  const { data: current, refetch } = useReadContract({
    address: module,
    abi: passwordTierGatingModuleAbi,
    functionName: 'getConfig',
    args: [instance],
    chainId: forkChainId,
    query: { enabled: hasModule },
  })

  const [values, setValues] = useState<Record<string, string>>({})
  const [attempted, setAttempted] = useState(false)
  const tx = useTxAction({ onSuccess: () => void refetch() })

  const schema = getConfigSchema('password-tier-gating')

  // No gating module on this instance → nothing to configure.
  if (!hasModule || !module || !schema) return null

  const errors = attempted
    ? { ...validateFields(schema.fields, values), ...validateTierConfig(values) }
    : {}
  const canSubmit = hasTierConfig(values) && !tx.isBusy

  const tierCount = current ? current.passwordHashes.length : 0
  const hint =
    tierCount > 0
      ? `${tierCount} tier${tierCount === 1 ? '' : 's'} configured — submitting replaces them`
      : 'no tiers configured yet — the collection is open until you set them'

  function handleSet(): void {
    setAttempted(true)
    if (!module || !schema || !hasTierConfig(values)) return
    if (
      Object.keys(validateFields(schema.fields, values)).length > 0 ||
      Object.keys(validateTierConfig(values)).length > 0
    )
      return
    tx.send({
      address: module,
      abi: passwordTierGatingModuleAbi,
      functionName: 'configureFor',
      args: [instance, encodeTierConfig(values)],
      chainId: forkChainId,
    })
  }

  function handleReset(): void {
    tx.reset()
    setValues({})
    setAttempted(false)
    void refetch()
  }

  return (
    <ActionRow label="password tiers" hint={hint}>
      <div className={styles.config}>
        {tx.state !== 'success' && (
          <SchemaForm
            fields={schema.fields}
            values={values}
            onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
            errors={errors}
          />
        )}
        <TxButton
          state={tx.state}
          onClick={handleSet}
          onReset={handleReset}
          label="save tiers"
          successLabel="tiers saved — tx confirmed."
          className="btn btn-secondary"
          disabled={!canSubmit}
          errorText="save failed — try again"
          testId="configure-gating"
        />
      </div>
    </ActionRow>
  )
}
