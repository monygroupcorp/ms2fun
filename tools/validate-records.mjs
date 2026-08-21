#!/usr/bin/env node
// Gate every alignment-census record against the schema. Read-only, no network, no model.
//
//   node tools/validate-records.mjs [dir]        # default data/alignment/collections
//
// Exit 1 on any finding. This is the gate that makes "a record without provenance is discarded
// unread" a fact rather than an intention: a record that cannot say what block range it covered,
// against what chain head, with which tool version, is not evidence and does not reach the render.
//
// What this gate covers: schema shape, provenance completeness, wei fields being exact decimal
// strings, and internal arithmetic consistency (free + paid == total).
// What it does NOT cover, and no schema check can: whether the numbers are TRUE. That is what
// verify-record.mjs does, by re-harvesting and diffing.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from './lib/record.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const dir = args[0] || 'data/alignment/collections';
// An empty census must not pass. A gate that goes green over zero records is a statement about the
// gate and nothing about the repo, and it is how a harvest that never ran reads as a clean one.
const allowEmpty = process.argv.includes('--allow-empty');
let files;
try { files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort(); }
catch (e) { console.error(`cannot read ${dir}: ${e.message}`); process.exit(1); }

let bad = 0, mint = 0, secondary = 0, flagged = 0;
for (const f of files) {
  let rec;
  try { rec = JSON.parse(readFileSync(join(dir, f), 'utf8')); }
  catch (e) { console.log(`FAIL ${f}: unparseable JSON — ${e.message}`); bad++; continue; }

  const { ok, errors } = validate(rec);
  if (!ok) { bad++; for (const e of errors) console.log(`FAIL ${f}: ${e}`); continue; }

  if (rec.address !== f.replace(/\.json$/, '')) {
    console.log(`FAIL ${f}: filename does not match record.address (${rec.address})`);
    bad++;
    continue;
  }
  if (rec.mint) mint++;
  if (rec.secondary) secondary++;
  if (rec.mint?.confidence === 'undercount-suspected') {
    flagged++;
    console.log(`FLAG ${f}: mint is ${rec.mint.confidence} — ${rec.mint.confidenceNote?.slice(0, 80)}...`);
  }
}

if (files.length === 0 && !allowEmpty) {
  console.log(`FAIL ${dir}: no records. An empty census is not a clean one — pass --allow-empty if `
    + 'this is a deliberately empty directory.');
  process.exit(1);
}

console.log(`\n${files.length} records · ${mint} with mint · ${secondary} with secondary `
  + `· ${flagged} flagged undercount-suspected · ${bad} invalid`);
// A FLAG is not a failure: it is a measured row that needs a different instrument before it is
// quoted, and it is reported on every run so it cannot quietly become normal.
process.exit(bad ? 1 : 0);
