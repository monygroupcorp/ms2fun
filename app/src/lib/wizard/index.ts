/**
 * Wizard module-option schema (ADR-0005) — the typed model of the creation wizard's input space,
 * shared by the wizard UI and NOEMA. Hybrid source of truth: hand-authored factory descriptors +
 * the generic evaluator here, plus live module enumeration from ComponentRegistry.
 */
export * from './schema'
export * from './projectTypes'
export * from './configTypes'
export * from './vaultFlavor'
export * from './metadataConfig'
export * from './useApprovedModules'
export * from './submit'
