/**
 * The migrated metadata root for a hosted upload, worked out on this side so the watcher can
 * recognise a finished move on chain.
 *
 * The JSON and the file layout come from `app/src/lib/art/ipfsMigration.ts` and the import
 * parameters from `app/src/lib/art/unixfsOptions.ts` — the same files the creator's browser uses, so
 * both sides arrive at the same CID. Only the importer is this package's own, because the service
 * cannot resolve the app's dependencies; the shared test vector in `migration.test.ts` and in the
 * app's `ipfsMigration.test.ts` is what keeps the two importers honest with each other.
 */
import { importer } from 'ipfs-unixfs-importer'
import type { CID } from 'multiformats/cid'

import { migratedMetaCid, type MigrationFile } from '../../../../app/src/lib/art/ipfsMigration'
import { UNIXFS_OPTIONS } from '../../../../app/src/lib/art/unixfsOptions'

/** Import files into one wrapped directory, keeping no blocks: only the root is wanted. */
async function importDirectory(files: readonly MigrationFile[]): Promise<string> {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  // The importer writes every block to a store and reads none back while importing, so a store
  // that discards is enough to learn the root.
  const store = { put: async (cid: CID) => cid }
  let root: CID | null = null
  for await (const entry of importer(sorted, store as never, UNIXFS_OPTIONS)) root = entry.cid
  if (root === null) throw new Error('importer produced no root')
  return root.toString()
}

export function migrationCidOf(imgCid: string, imageNames: readonly string[]): Promise<string> {
  return migratedMetaCid(imgCid, imageNames, importDirectory)
}
