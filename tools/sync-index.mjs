#!/usr/bin/env node
// Move item-list states forward to match what is actually on disk. Read the records, write the
// index — never the other way round.
//
//   node tools/sync-index.mjs [--apply]        # dry by default
//
// A collection is `harvested` when a schema-valid record exists for it, and `verified` only when a
// human or a run has recorded that verify-record.mjs reproduced it. This tool never sets `verified`
// — that state is earned by an independent re-harvest, and a bookkeeping script must not be able to
// award it.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from './lib/record.mjs';

const apply = process.argv.includes('--apply');
const dir = 'data/alignment/collections';
const indexPath = 'data/alignment/index.json';

const valid = new Set();
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  if (validate(rec).ok && rec.mint && rec.secondary) valid.add(rec.address.toLowerCase());
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const changes = [];
for (const c of index.collections) {
  const addr = c.address?.toLowerCase();
  if (!addr) continue;
  const want = valid.has(addr) ? 'harvested' : (c.state === 'harvested' ? 'needs-harvest' : c.state);
  // `verified` is earned, never inferred. Leave it alone.
  if (c.state === 'verified') continue;
  if (want !== c.state) { changes.push(`${c.label}: ${c.state} -> ${want}`); c.state = want; }
}

for (const c of changes) console.log(c);
console.log(`${changes.length} state change(s)${apply ? ', applied' : ' (dry run — pass --apply)'}`);
if (apply && changes.length) writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
