/**
 * Write the "Preparing your files" examples into `public/art-examples/`. Run after changing
 * `examples.ts`: `pnpm art:examples`. A test fails while the committed copies are stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { exampleCollectionZip, metadataTemplateCsv } from './examples'

const out = join(import.meta.dirname, '..', '..', 'public', 'art-examples')
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'example-collection.zip'), exampleCollectionZip())
writeFileSync(join(out, 'metadata-template.csv'), metadataTemplateCsv())
console.log(`wrote ${out}`)
