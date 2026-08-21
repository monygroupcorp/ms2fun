// The alignment-census record: one JSON file per collection, at
// `data/alignment/collections/<address>.json`.
//
// Two harvesters write into one record — `harvest-collection.mjs` owns the `mint` section and
// `harvest-secondary.mjs` owns `secondary` — so a record is built by merge, never by overwrite.
//
// Three rules the schema exists to enforce, all of them earned:
//
//   1. EVERY SECTION CARRIES ITS OWN PROVENANCE. A section without a complete `harvest` block is
//      invalid and is discarded unread. The failure this guards is not a wrong number, it is an
//      invented one: an agent that cannot reach the chain will produce a plausible figure rather
//      than stop.
//   2. MONEY IS AN EXACT DECIMAL STRING OF WEI. Floats never touch a stored figure. Derived
//      quantities (ETH display values, the effective royalty rate, the counterfactual splits) are
//      computed at render time from the wei, so a record holds only what was measured.
//   3. A SECTION IS BOUNDED BY BLOCK RANGE AND SAYS SO. Chain reads over a fixed range are
//      deterministic, which is the entire basis of the verification pass — an unbounded harvest
//      ("everything up to now") cannot be re-run to the same answer and so cannot be verified.

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SCHEMA_VERSION = 1;

// `partial` exists so a truncated harvest can be recorded AS truncated rather than silently
// reported as a small one. It is never a valid input to the render or the verifier.
const HARVEST_FIELDS = ['tool', 'toolVersion', 'fromBlock', 'toBlock', 'chainHead', 'harvestedAt'];

export const recordPath = (dir, address) => join(dir, `${address.toLowerCase()}.json`);

export function readRecord(dir, address) {
  const p = recordPath(dir, address);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
}

// Merge one section into the record on disk and write it back atomically. Concurrent harvests are
// capped at 3-4 by the RPC anyway, but two harvesters can legitimately touch the SAME record (mint
// and secondary), so the read-modify-write is done here and nowhere else.
export function writeSection(dir, address, key, section) {
  const addr = address.toLowerCase();
  const rec = readRecord(dir, addr) || {
    schemaVersion: SCHEMA_VERSION,
    address: addr,
    label: null,
    provenance: null,
  };
  rec.schemaVersion = SCHEMA_VERSION;
  rec.address = addr;
  rec[key] = section;
  if (section.label && !rec.label) rec.label = section.label;

  const p = recordPath(dir, addr);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`);
  renameSync(tmp, p);
  return p;
}

const isDecString = (v) => typeof v === 'string' && /^[0-9]+$/.test(v);

function validateHarvest(h, where, errors) {
  if (!h || typeof h !== 'object') { errors.push(`${where}: missing harvest provenance`); return; }
  for (const f of HARVEST_FIELDS) {
    if (h[f] === undefined || h[f] === null) errors.push(`${where}.harvest: missing ${f}`);
  }
  for (const f of ['fromBlock', 'toBlock', 'chainHead']) {
    if (h[f] !== undefined && h[f] !== null && !isDecString(h[f])) {
      errors.push(`${where}.harvest.${f}: block numbers are decimal strings, got ${JSON.stringify(h[f])}`);
    }
  }
  if (h.complete !== true) {
    errors.push(`${where}.harvest.complete is not true — a partial harvest is not a result`);
  }
  if (isDecString(h.fromBlock) && isDecString(h.toBlock) && BigInt(h.fromBlock) > BigInt(h.toBlock)) {
    errors.push(`${where}.harvest: fromBlock > toBlock`);
  }
  if (isDecString(h.toBlock) && isDecString(h.chainHead) && BigInt(h.toBlock) > BigInt(h.chainHead)) {
    errors.push(`${where}.harvest: toBlock is past the chain head at harvest time`);
  }
}

export function validate(rec) {
  const errors = [];
  if (!rec || typeof rec !== 'object') return { ok: false, errors: ['not an object'] };
  if (rec.schemaVersion !== SCHEMA_VERSION) {
    errors.push(`schemaVersion ${rec.schemaVersion} != ${SCHEMA_VERSION}`);
  }
  if (!/^0x[0-9a-f]{40}$/.test(rec.address || '')) errors.push('address: not a lowercase 0x address');
  if (!rec.mint && !rec.secondary) errors.push('record holds neither a mint nor a secondary section');

  if (rec.mint) {
    validateHarvest(rec.mint.harvest, 'mint', errors);
    if (!isDecString(rec.mint.grossWei)) errors.push('mint.grossWei: must be a decimal wei string');
    for (const f of ['total', 'free', 'paid', 'mintTxs']) {
      if (!Number.isInteger(rec.mint[f])) errors.push(`mint.${f}: must be an integer`);
    }
    if (Number.isInteger(rec.mint.free) && Number.isInteger(rec.mint.paid)
        && rec.mint.free + rec.mint.paid !== rec.mint.total) {
      errors.push('mint: free + paid != total');
    }
    if (!rec.mint.method) errors.push('mint.method: missing');
  }

  if (rec.secondary) {
    validateHarvest(rec.secondary.harvest, 'secondary', errors);
    for (const f of ['volumeWei', 'royaltiesPaidWei']) {
      if (!isDecString(rec.secondary[f])) errors.push(`secondary.${f}: must be a decimal wei string`);
    }
    if (!Number.isInteger(rec.secondary.sales)) errors.push('secondary.sales: must be an integer');
  }

  return { ok: errors.length === 0, errors };
}

// Display helpers. These are the ONLY place wei becomes a float, and nothing here is ever stored.
// `ethStr` TRUNCATES rather than rounds, deliberately: every figure on this page is an argument
// about what someone did not receive, and a display that can round upward is a display that can
// overstate the claim. Truncation can only ever understate it.
export function ethStr(wei, dp = 4) {
  const v = BigInt(wei);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const whole = a / 10n ** 18n;
  const frac = (a % 10n ** 18n).toString().padStart(18, '0').slice(0, dp);
  return `${neg ? '-' : ''}${whole}${dp ? `.${frac}` : ''}`;
}
export const ethNum = (wei) => Number(ethStr(wei, 6));
