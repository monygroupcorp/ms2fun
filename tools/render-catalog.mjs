#!/usr/bin/env node
// Render the alignment catalog from the harvest records. The markdown is a GENERATED ARTIFACT and
// is never hand-edited: the argument's prose lives in `data/alignment/narrative.md`, the numbers
// live in the records, and this joins them.
//
//   node tools/render-catalog.mjs [--out docs/ALIGNMENT-CATALOG.md] [--dir data/alignment/collections]
//
// Why generated. Thirty workers appending rows to one shared markdown table is the seven-colliding-
// PRs failure with the serial numbers filed off. One file per collection dissolves the collision
// surface at the source, and the table is recomputed from those files whenever anyone asks.
//
// Every figure below is derived HERE, from exact wei, and none of it is stored: the ETH display
// values, the counterfactual splits, the effective royalty rate and every total. A record holds
// only what was measured.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate, ethStr, ethNum } from './lib/record.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('--dir', 'data/alignment/collections');
const out = arg('--out', 'docs/ALIGNMENT-CATALOG.md');
const narrativePath = arg('--narrative', 'data/alignment/narrative.md');
const indexPath = arg('--index', 'data/alignment/index.json');

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const byAddress = new Map();
for (const c of index.collections) if (c.address) byAddress.set(c.address.toLowerCase(), c);

const records = [];
let skipped = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const { ok, errors } = validate(rec);
  // An invalid record does not reach the render. This is deliberate and it is the whole point of
  // the schema: a figure with no provenance behind it never becomes a row someone can quote.
  if (!ok) { console.error(`SKIP ${f}: ${errors[0]}`); skipped++; continue; }
  rec._item = byAddress.get(rec.address) || null;
  if (!rec._item) { console.error(`SKIP ${f}: no entry in ${indexPath} — not in the census`); skipped++; continue; }
  records.push(rec);
}

// RevenueSplitLib, exactly: mint on a liquidity-family vault sends 19% to the alignment target and
// 1% to the protocol; on a yield-family vault, 80% is endowed as permanent principal.
const cut = (wei, pct) => ethStr((BigInt(wei) * BigInt(pct)) / 100n, 2);
const n = (x) => x.toLocaleString('en-US');

const censusTable = (cls) => {
  const rows = records
    .filter((r) => r._item.class === cls && r.mint)
    .sort((a, b) => (BigInt(b.mint.grossWei) > BigInt(a.mint.grossWei) ? 1 : -1));
  const head = '| collection | contract | supply | free | paid | mint ETH | 19% | 80% | metadata host | 404 base | confidence |\n'
             + '|---|---|---|---|---|---|---|---|---|---|---|';
  const body = rows.map((r) => {
    const m = r.mint;
    return `| ${r._item.label} | \`${r.address.slice(0, 8)}…\` | ${m.identity.totalSupply ?? '—'} `
      + `| ${n(m.free)} | ${n(m.paid)} | **${ethStr(m.grossWei, 2)}** | ${cut(m.grossWei, 19)} `
      + `| ${cut(m.grossWei, 80)} | ${m.tokenURI.host} | ${m.tokenURI.erc404BaseReusable ? 'yes' : 'no'} `
      + `| ${m.confidence === 'measured' ? 'measured' : '**' + m.confidence + '**'} |`;
  }).join('\n');

  const gross = rows.reduce((a, r) => a + BigInt(r.mint.grossWei), 0n);
  const free = rows.reduce((a, r) => a + r.mint.free, 0);
  const paid = rows.reduce((a, r) => a + r.mint.paid, 0);
  const total = `\n\n**${rows.length} collections · ${n(free)} free mints · ${n(paid)} paid mints `
    + `· ${ethStr(gross, 2)} ETH → ${cut(gross, 19)} ETH aligned (19%) or ${cut(gross, 80)} ETH endowed (80%).**`;
  return rows.length ? head + '\n' + body + total : '_No records yet._';
};

const secondaryTable = () => {
  const rows = records.filter((r) => r.secondary)
    .sort((a, b) => (BigInt(b.secondary.volumeWei) > BigInt(a.secondary.volumeWei) ? 1 : -1));
  if (!rows.length) return '_No secondary records yet._';
  const head = '| collection | mint | secondary volume | sales | royalties paid | effective |\n|---|---|---|---|---|---|';
  const body = rows.map((r) => {
    const s = r.secondary;
    const vol = BigInt(s.volumeWei);
    // The denominator is the WHOLE price — seller proceeds plus protocol fee plus royalty. Dividing
    // royalties by seller proceeds alone would flatter this number, and the census's claim is
    // precisely that this number is small.
    const eff = vol > 0n ? `${(ethNum(s.royaltiesPaidWei) / ethNum(s.volumeWei) * 100).toFixed(2)}%` : '—';
    return `| ${r._item.label} | ${r.mint ? ethStr(r.mint.grossWei, 1) : '—'} | ${ethStr(s.volumeWei, 1)} `
      + `| ${n(s.sales)} | ${ethStr(s.royaltiesPaidWei, 2)} | ${eff} |`;
  }).join('\n');

  const vol = rows.reduce((a, r) => a + BigInt(r.secondary.volumeWei), 0n);
  const roy = rows.reduce((a, r) => a + BigInt(r.secondary.royaltiesPaidWei), 0n);
  const sales = rows.reduce((a, r) => a + r.secondary.sales, 0);
  const eff = vol > 0n ? (ethNum(roy) / ethNum(vol) * 100).toFixed(2) : '0.00';
  return head + '\n' + body
    + `\n\n**${n(sales)} sales · ${ethStr(vol, 0)} ETH of volume · ${ethStr(roy, 1)} ETH of royalties `
    + `actually paid — an effective rate of ${eff}% across the census.**`;
};

const stateTable = () => {
  const counts = new Map();
  for (const c of index.collections) counts.set(c.state, (counts.get(c.state) || 0) + 1);
  const lines = [...counts].sort((a, b) => b[1] - a[1])
    .map(([s, k]) => `| ${s} | ${k} | ${index._states[s] || ''} |`);
  return '| state | count | meaning |\n|---|---|---|\n' + lines.join('\n');
};

const flagged = records.filter((r) => r.mint?.confidence === 'undercount-suspected');
const flaggedNote = flagged.length
  ? `**${flagged.length} row(s) are flagged \`undercount-suspected\`** and must not be quoted until `
    + 're-measured with the right instrument: '
    + flagged.map((r) => r._item.label).join(', ')
    + '. An auction winner pays in bids and the settlement transaction carries no value, so a mint-tx '
    + 'census reads those mints as free. Pixelady Figmata measures 7.20 ETH this way against 90.27 ETH '
    + 'of real winning bids — off by 12.5×.'
  : '_No rows are flagged as undercount-suspected._';

const harvestedAt = records.map((r) => r.mint?.harvest?.harvestedAt || r.secondary?.harvest?.harvestedAt)
  .filter(Boolean).sort();

const narrative = readFileSync(narrativePath, 'utf8');
const rendered = narrative
  .replaceAll('{{CENSUS_TABLE}}', censusTable('derivative'))
  .replaceAll('{{FIRSTPARTY_TABLE}}', censusTable('first-party'))
  .replaceAll('{{SECONDARY_TABLE}}', secondaryTable())
  .replaceAll('{{STATE_TABLE}}', stateTable())
  .replaceAll('{{FLAGGED_NOTE}}', flaggedNote)
  .replaceAll('{{RECORD_COUNT}}', String(records.length))
  .replaceAll('{{SKIPPED_COUNT}}', String(skipped))
  .replaceAll('{{HARVEST_WINDOW}}', harvestedAt.length
    ? `${harvestedAt[0].slice(0, 10)} to ${harvestedAt[harvestedAt.length - 1].slice(0, 10)}`
    : 'no records');

const leftover = rendered.match(/\{\{[A-Z_]+\}\}/g);
if (leftover) { console.error(`unsubstituted placeholders: ${[...new Set(leftover)].join(', ')}`); process.exit(1); }

writeFileSync(out, rendered);
console.error(`rendered ${out} from ${records.length} record(s)${skipped ? `, ${skipped} skipped` : ''}`);
