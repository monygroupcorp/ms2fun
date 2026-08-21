#!/usr/bin/env node
// Phase 4: independently re-harvest a record over ITS OWN recorded block range and diff, exactly.
//
//   node tools/verify-record.mjs <address> [--dir data/alignment/collections] [--section mint|secondary]
//
// Chain reads over a fixed block range are deterministic, so a re-harvest of the same range MUST
// produce byte-identical measured fields. A row that does not reproduce is not a disagreement to
// adjudicate and not a number to average — it is a DISCARD, and a second non-reproducing row in the
// same batch stops the run.
//
// This is the check that makes the census trustworthy to someone who did not run it, which is the
// only kind of trustworthy that counts here. It re-runs the real harvester as a child process
// rather than re-implementing the measurement, so it verifies the tool that actually wrote the
// record — a second implementation would only ever prove that two pieces of code agree.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readRecord } from './lib/record.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const addr = (process.argv[2] || '').toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(addr)) {
  console.error('usage: verify-record.mjs <address> [--dir d] [--section mint|secondary]');
  process.exit(1);
}
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/alignment/collections');
const only = arg('--section', null);

const rec = readRecord(dir, addr);
if (!rec) { console.error(`no record for ${addr} in ${dir}`); process.exit(1); }

// The measured fields. Everything else in a section is provenance or derived presentation, and
// `harvestedAt` is expected to differ — that is the one field a re-run must NOT match.
const COMPARE = {
  mint: ['total', 'free', 'paid', 'mintTxs', 'freeTxs', 'indirectMintTxs', 'zeroValueIndirectTxs',
         'uniqueRecipients', 'uniqueSenders', 'grossWei', 'firstBlock', 'lastBlock', 'confidence'],
  secondary: ['sales', 'volumeWei', 'royaltiesPaidWei', 'protocolFeesWei', 'salesWithRoyalty'],
};
const TOOL = { mint: 'harvest-collection.mjs', secondary: 'harvest-secondary.mjs' };

let checked = 0, mismatches = 0;
for (const section of ['mint', 'secondary']) {
  if (only && only !== section) continue;
  const have = rec[section];
  if (!have) continue;
  const h = have.harvest || {};
  if (!h.fromBlock || !h.toBlock) {
    console.log(`DISCARD ${addr} ${section}: no recorded block range, so it cannot be re-harvested`);
    mismatches++;
    continue;
  }

  const r = spawnSync('node', [
    join(here, TOOL[section]), addr, '--from', h.fromBlock, '--to', h.toBlock,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

  if (r.status !== 0) {
    console.log(`DISCARD ${addr} ${section}: re-harvest exited ${r.status} — ${(r.stderr || '').trim().split('\n').pop()}`);
    mismatches++;
    continue;
  }
  let fresh;
  try { fresh = JSON.parse(r.stdout); }
  catch { console.log(`DISCARD ${addr} ${section}: re-harvest emitted unparseable JSON`); mismatches++; continue; }

  checked++;
  if (fresh.harvest?.toolVersion !== h.toolVersion) {
    // Not a discard on its own: a version bump legitimately changes what is measured. It does mean
    // the record predates the current instrument and its numbers are not comparable to fresh ones.
    console.log(`NOTE  ${addr} ${section}: record written by ${TOOL[section]} v${h.toolVersion}, `
      + `current is v${fresh.harvest?.toolVersion} — re-harvest, do not diff`);
  }
  const bad = [];
  for (const f of COMPARE[section]) {
    const a = have[f] ?? null, b = fresh[f] ?? null;
    if (String(a) !== String(b)) bad.push(`${f}: recorded ${JSON.stringify(a)} != re-harvest ${JSON.stringify(b)}`);
  }
  if (bad.length) {
    mismatches++;
    console.log(`DISCARD ${addr} ${section}: ${bad.length} field(s) did not reproduce`);
    for (const b of bad) console.log(`         ${b}`);
  } else {
    console.log(`OK      ${addr} ${section}: ${COMPARE[section].length} fields reproduced exactly `
      + `over blocks ${h.fromBlock}-${h.toBlock}`);
  }
}

if (!checked && !mismatches) { console.log(`${addr}: nothing to verify`); process.exit(1); }
process.exit(mismatches ? 1 : 0);
