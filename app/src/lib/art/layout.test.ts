// @vitest-environment node
/**
 * Every layout a creator might bring, through the planner: what it detects, how it pairs and
 * numbers pieces, and that every problem names the file, the line or the piece.
 */
import { describe, expect, it } from 'vitest'

import {
  collectFiles,
  collectZip,
  dropped,
  hashLips,
  png,
  text,
  zipOf,
} from '../../test/artFixtures'
import { describeIds, planArt, traitSummary } from './layout'
import { collect } from './sources'

const IPFS_CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

describe('a HashLips folder', () => {
  it('pairs each image with its JSON and keeps every field the creator wrote', async () => {
    const plan = await planArt(await collectZip(hashLips(4)), { supply: 4 })
    expect(plan.layout).toBe('per-piece')
    expect(plan.blockers).toEqual([])
    expect(plan.pieces.map((p) => [p.piece, p.image?.path, p.source])).toEqual([
      [1, 'images/1.png', 'json/1.json'],
      [2, 'images/2.png', 'json/2.json'],
      [3, 'images/3.png', 'json/3.json'],
      [4, 'images/4.png', 'json/4.json'],
    ])
    const meta = plan.pieces[0]!.meta!
    expect(meta.keys).toEqual([
      'name',
      'description',
      'image',
      'dna',
      'edition',
      'date',
      'attributes',
      'compiler',
    ])
    expect(plan.pieces[1]!.traits).toEqual([
      { trait_type: 'Background', value: 'Blue' },
      { trait_type: 'Eyes', value: 'Laser' },
    ])
    // The aggregate file beside the per-piece files is listed, not used.
    expect(plan.skipped).toContainEqual({
      path: 'json/_metadata.json',
      reason: 'not used: the per-piece JSON files are used instead',
    })
    expect(plan.notices.join(' ')).toMatch(/placeholder .* replaced with the hosted copy/)
  })

  it('moves a set numbered from 0 up by one, and says so', async () => {
    const plan = await planArt(await collectZip(hashLips(3, { from: 0 })), { supply: 3 })
    expect(plan.blockers).toEqual([])
    expect(plan.pieces.map((p) => [p.piece, p.image?.path])).toEqual([
      [1, 'images/0.png'],
      [2, 'images/1.png'],
      [3, 'images/2.png'],
    ])
    expect(plan.notices.join(' ')).toMatch(/numbered from 0, but the first NFT is token #1/)
  })

  it('reads a stored zip the same as a deflated one', async () => {
    const a = await planArt(await collectZip(hashLips(3), 0), { supply: 3 })
    const b = await planArt(await collectZip(hashLips(3), 6), { supply: 3 })
    expect(a.pieces.map((p) => p.meta!.text)).toEqual(b.pieces.map((p) => p.meta!.text))
  })

  it('reads a folder dropped with its wrapping folder, and pairs json/ with images/', async () => {
    const files = Object.fromEntries(
      Object.entries(hashLips(2)).map(([path, bytes]) => [`My Collection/${path}`, bytes]),
    )
    const plan = await planArt(await collectFiles(files), { supply: 2 })
    expect(plan.blockers).toEqual([])
    expect(plan.pieces.map((p) => p.image?.path)).toEqual(['images/1.png', 'images/2.png'])
  })

  it('pairs by the file name the image link ends in before the number', async () => {
    const plan = await planArt(
      await collectFiles({
        'art/dragon.png': png(1),
        'art/tiger.png': png(2),
        'meta/1.json': text('{"name":"Tiger","image":"ipfs://NewUriToReplace/tiger.png"}'),
        'meta/2.json': text('{"name":"Dragon","image":"dragon.png"}'),
      }),
      { supply: 2 },
    )
    expect(plan.pieces.map((p) => [p.piece, p.name, p.image?.path])).toEqual([
      [1, 'Tiger', 'art/tiger.png'],
      [2, 'Dragon', 'art/dragon.png'],
    ])
  })

  it('pairs by base name when nothing else matches', async () => {
    const plan = await planArt(
      await collectFiles({
        'dragon.png': png(1),
        'dragon.json': text('{"name":"Dragon"}'),
      }),
      { supply: 1 },
    )
    expect(plan.blockers).toEqual([])
    expect(plan.pieces[0]!.name).toBe('Dragon')
  })
})

describe('an aggregate metadata file', () => {
  it('pairs each item by its image file name, then its edition', async () => {
    const all = [
      { edition: 2, name: 'Two', image: 'ipfs://NewUriToReplace/2.png' },
      { edition: 1, name: 'One', image: '' },
    ]
    const plan = await planArt(
      await collectFiles({
        '1.png': png(1),
        '2.png': png(2),
        '_metadata.json': text(JSON.stringify(all)),
      }),
      { supply: 2 },
    )
    expect(plan.layout).toBe('aggregate')
    expect(plan.blockers).toEqual([])
    expect(plan.pieces.map((p) => [p.piece, p.name, p.source])).toEqual([
      [1, 'One', '_metadata.json item 2'],
      [2, 'Two', '_metadata.json item 1'],
    ])
  })
})

describe('a spreadsheet', () => {
  it('turns columns into name, description and one trait per column', async () => {
    const csv =
      'file,name,description,Background,Eyes\n' +
      'a.png,Alpha,"First, of course",Red,Laser\n' +
      'b.png,Beta,,Blue,\n'
    const plan = await planArt(
      await collectFiles({ 'a.png': png(1), 'b.png': png(2), 'pieces.csv': text(csv) }),
      { supply: 2 },
    )
    expect(plan.layout).toBe('csv')
    expect(plan.blockers).toEqual([])
    expect(plan.pieces.map((p) => p.meta!.text)).toEqual([
      '{"name":"Alpha","description":"First, of course","image":"","attributes":[{"trait_type":"Background","value":"Red"},{"trait_type":"Eyes","value":"Laser"}]}',
      '{"name":"Beta","image":"","attributes":[{"trait_type":"Background","value":"Blue"}]}',
    ])
    expect(plan.notices).toContain('Pieces are numbered in the order your metadata lists them.')
  })

  it('reads semicolons, and numbers pieces by an id column', async () => {
    const csv = 'id;file;name\n2;x.png;Second\n1;y.png;First\n'
    const plan = await planArt(
      await collectFiles({ 'x.png': png(1), 'y.png': png(2), 'sheet.csv': text(csv) }),
      { supply: 2 },
    )
    expect(plan.pieces.map((p) => [p.piece, p.name, p.image?.path])).toEqual([
      [1, 'First', 'y.png'],
      [2, 'Second', 'x.png'],
    ])
  })

  it('names the line and column of a malformed row', async () => {
    const plan = await planArt(
      await collectFiles({ 'a.png': png(1), 'bad.csv': text('file,name\na.png,"Alpha\n') }),
      { supply: 1 },
    )
    expect(plan.blockers).toEqual(['bad.csv, line 2, column 7: a quoted cell is never closed'])
  })

  it('names a row with too many cells', async () => {
    const plan = await planArt(
      await collectFiles({ 'a.png': png(1), 'bad.csv': text('file,name\na.png,A,extra\n') }),
      { supply: 1 },
    )
    expect(plan.blockers[0]).toBe(
      'bad.csv, line 2, column 3: this row has 3 cells but there are only 2 headings',
    )
  })
})

describe('images only', () => {
  it('numbers pieces by file name and leaves the metadata to the name pattern', async () => {
    const plan = await planArt(
      await collectFiles({ 'art-10.png': png(10), 'art-2.png': png(2), 'art-1.png': png(1) }),
      { supply: 3 },
    )
    expect(plan.layout).toBe('images')
    expect(plan.generated).toBe(3)
    expect(plan.pieces.map((p) => [p.piece, p.image?.path])).toEqual([
      [1, 'art-1.png'],
      [2, 'art-2.png'],
      [3, 'art-10.png'],
    ])
  })
})

describe('partial metadata', () => {
  it('writes the missing pieces from the pattern and warns, naming them', async () => {
    const files = hashLips(3)
    delete files['json/2.json']
    delete files['json/_metadata.json']
    const plan = await planArt(await collectFiles(files), { supply: 3 })
    expect(plan.blockers).toEqual([])
    expect(plan.generated).toBe(1)
    expect(plan.pieces[1]!.meta).toBeNull()
    expect(plan.warnings).toEqual([
      '1 image has no metadata, so it will be written from the name pattern: images/2.png',
    ])
  })

  it('blocks metadata that has no image, naming it', async () => {
    const files = hashLips(3)
    delete files['images/3.png']
    const plan = await planArt(await collectFiles(files), { supply: 3 })
    expect(plan.blockers).toContain(
      '1 piece has metadata but no matching image: json/3.json (3.png)',
    )
  })
})

describe('counts against the supply', () => {
  it('names the exact token ids with no art, and the pieces past the supply', async () => {
    const short = await planArt(await collectFiles(hashLips(3)), { supply: 6 })
    expect(short.blockers).toEqual([
      'this collection has 6 NFTs but 3 of them would have no art: #4–#6',
    ])
    const long = await planArt(await collectFiles(hashLips(3)), { supply: 2 })
    expect(long.blockers).toEqual([
      '1 piece is past the NFT supply of 2, so no token would ever show it: #3',
    ])
  })

  it('names gaps in the numbering when the supply is not entered yet', async () => {
    const files = hashLips(4)
    delete files['images/2.png']
    delete files['json/2.json']
    delete files['json/_metadata.json']
    const plan = await planArt(await collectFiles(files), { supply: null })
    expect(plan.blockers).toEqual(['there is no art for #2'])
  })
})

describe('malformed and unwanted files', () => {
  it('names the file, line and column of broken JSON', async () => {
    const files = hashLips(2)
    files['json/2.json'] = text('{\n  "name": "Sprite #2",\n  "image": "x.png",\n}')
    const plan = await planArt(await collectFiles(files), { supply: 2 })
    expect(plan.blockers).toContain('json/2.json, line 4, column 1: expected a string')
  })

  it('ignores system clutter quietly and lists everything else it skipped', async () => {
    const files = {
      ...hashLips(1),
      '__MACOSX/images/._1.png': png(9),
      '.DS_Store': text('x'),
      'images/Thumbs.db': text('x'),
      '.hidden/notes.png': png(3),
      'README.txt': text('hello'),
      'images/logo.svg': text('<svg/>'),
      'video/1.mp4': text('not really'),
    }
    const plan = await planArt(await collectZip(files), { supply: 1 })
    expect(plan.blockers).toEqual([])
    expect(plan.junk).toBe(4)
    expect(plan.skipped.map((s) => s.path)).toEqual([
      'images/logo.svg',
      'json/_metadata.json',
      'README.txt',
      'video/1.mp4',
    ])
    expect(plan.skipped.find((s) => s.path === 'video/1.mp4')!.reason).toMatch(/not hosted/)
  })

  it('refuses an image whose bytes are not the format its name says', async () => {
    const plan = await planArt(await collectFiles({ '1.png': text('<html></html>') }), {
      supply: 1,
    })
    expect(plan.blockers).toEqual(['1.png is not really a PNG image'])
  })

  it('lists collection-level JSON beside numbered pieces instead of blocking on it', async () => {
    const files = { ...hashLips(1), 'json/collection.json': text('{"name":"My collection"}') }
    const plan = await planArt(await collectFiles(files), { supply: 1 })
    expect(plan.blockers).toEqual([])
    expect(plan.skipped.map((s) => s.path)).toContain('json/collection.json')
  })

  it('says why a zip inside the drop could not be read', async () => {
    const plan = await planArt(await collect([dropped('broken.zip', text('not a zip at all'))]), {
      supply: null,
    })
    expect(plan.skipped).toEqual([
      { path: 'broken.zip', reason: 'this is not a zip file, or it is damaged' },
    ])
  })

  it('lists a zip nested inside the zip', async () => {
    const plan = await planArt(
      await collectZip({ ...hashLips(1), 'more.zip': zipOf({ 'x.png': png(1) }) }),
      { supply: 1 },
    )
    expect(plan.skipped.map((s) => s.path)).toContain('more.zip')
  })
})

describe('art already on IPFS', () => {
  it('offers to use the metadata as it is, with no images needed', async () => {
    const files = {
      '1.json': text(`{"name":"One","image":"ipfs://${IPFS_CID}/1.png"}`),
      '2.json': text(`{"name":"Two","image":"ipfs://${IPFS_CID}/2.png"}`),
    }
    const plan = await planArt(await collectFiles(files), { supply: 2 })
    expect(plan.ipfs).toEqual({ blockers: [] })
    expect(plan.blockers).toEqual([])
    expect(plan.pieces.map((p) => [p.piece, p.image])).toEqual([
      [1, null],
      [2, null],
    ])
  })

  it('does not take a placeholder for real IPFS art', async () => {
    const plan = await planArt(await collectFiles(hashLips(2)), { supply: 2 })
    expect(plan.ipfs).toBeNull()
  })
})

describe('the review summaries', () => {
  it('counts every trait value so a typo stands out', async () => {
    const plan = await planArt(await collectFiles(hashLips(3)), { supply: 3 })
    expect(traitSummary(plan.pieces)).toEqual([
      {
        type: 'Background',
        values: [
          { value: 'Red', count: 2 },
          { value: 'Blue', count: 1 },
        ],
      },
      { type: 'Eyes', values: [{ value: 'Laser', count: 3 }] },
    ])
  })

  it('describes ids as runs', () => {
    expect(describeIds([1, 2, 3, 7, 9, 10])).toBe('#1–#3, #7, #9–#10')
  })
})
