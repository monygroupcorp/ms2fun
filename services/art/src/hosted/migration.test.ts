/**
 * The service and the browser must arrive at the same migrated metadata root, or a finished move is
 * never recognised. This vector is the one `app/src/lib/art/ipfsMigration.test.ts` checks with the
 * app's importer; here it is computed with the service's own.
 */
import { describe, expect, it } from 'vitest'

import { migrationCidOf } from './migration'

const IMG = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const VECTOR = 'bafybeif26azk5uoapwvutphkf2bq7jdgrt3m7tch3xhishtv72jb6zoupq'
const SHARDED_VECTOR = 'bafybeia3zy2dt2eoaokuvdp62xxaps37qdf52tgirrmquj4u66apwiprim'

describe('migrationCidOf', () => {
  it('matches the vector the app computes', async () => {
    expect(await migrationCidOf(IMG, ['1.png', '2.jpg', '3.webp', '10.gif'])).toBe(VECTOR)
    expect(await migrationCidOf(IMG, ['10.gif', '3.webp', '2.jpg', '1.png'])).toBe(VECTOR)
  })

  it('matches the app for a full-size collection, whose directory is sharded', async () => {
    // 10,000 pieces is past the importer's shard threshold, so this pins the HAMT layout too.
    const names = Array.from({ length: 10_000 }, (_, i) => `${i + 1}.png`)
    expect(await migrationCidOf(IMG, names)).toBe(SHARDED_VECTOR)
  }, 60_000)
})
