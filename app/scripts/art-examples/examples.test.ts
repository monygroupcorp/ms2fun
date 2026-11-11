// @vitest-environment node
/**
 * The examples a creator downloads must be current, and must upload cleanly: each is run through
 * the same planner the wizard uses.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { planArt } from '../../src/lib/art/layout'
import { collect } from '../../src/lib/art/sources'
import { exampleCollectionZip, metadataTemplateCsv, tinyPng } from './examples'

const dir = join(import.meta.dirname, '..', '..', 'public', 'art-examples')

describe('the downloadable examples', () => {
  it('are the committed copies (run `pnpm art:examples` after changing them)', () => {
    expect(new Uint8Array(readFileSync(join(dir, 'example-collection.zip')))).toEqual(
      exampleCollectionZip(),
    )
    expect(readFileSync(join(dir, 'metadata-template.csv'), 'utf8')).toBe(metadataTemplateCsv())
  })

  it('the example zip plans with no problems, keeping its traits', async () => {
    const zip = exampleCollectionZip()
    const plan = await planArt(
      await collect([
        {
          path: 'example-collection.zip',
          file: new File([zip as BlobPart], 'example-collection.zip'),
        },
      ]),
      { supply: 4 },
    )
    expect(plan.blockers).toEqual([])
    expect(plan.warnings).toEqual([])
    expect(plan.layout).toBe('per-piece')
    expect(plan.pieces.map((p) => p.traits.map((t) => t.value).join('/'))).toEqual([
      'Red/Black',
      'Blue/Black',
      'Red/White',
      'Blue/White',
    ])
  })

  it('the CSV template plans with no problems beside its images', async () => {
    const files = [1, 2, 3, 4].map((n) => ({
      path: `${n}.png`,
      file: new File([tinyPng(8, [0, 0, 0], [255, 255, 255]) as BlobPart], `${n}.png`),
    }))
    files.push({
      path: 'metadata-template.csv',
      file: new File([metadataTemplateCsv()], 'metadata-template.csv'),
    })
    const plan = await planArt(await collect(files), { supply: 4 })
    expect(plan.blockers).toEqual([])
    expect(plan.layout).toBe('csv')
    expect(plan.pieces[0]!.meta!.text).toContain(
      '"description":"An example piece, with a comma in its description."',
    )
  })
})
