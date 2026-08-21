#!/usr/bin/env node
// Resolve OpenSea collection slugs to mainnet contract addresses (OpenSea API v2, no key needed).
//
//   node tools/resolve-slugs.mjs slugs.txt > slug-address.tsv
//
// Columns: slug, address-or-status, name, totalSupply.
//
// The keyless endpoint 401s after roughly a dozen lookups in a window, which is why the scraper
// exists as the fallback. A slug that could not be looked up emits RATE-LIMITED, never a blank
// address — an exhausted run and a genuinely unresolvable slug are different results and the
// backlog is worked differently for each.
import { readFileSync } from 'node:fs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = process.argv[2];
if (!file) { console.error('usage: resolve-slugs.mjs <slugs.txt>'); process.exit(1); }

const slugs = readFileSync(file, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
let exhausted = 0;
for (const slug of slugs) {
  let out = ['RATE-LIMITED', '', ''];
  for (let a = 0; a < 4; a++) {
    let r;
    try {
      r = await fetch(`https://api.opensea.io/api/v2/collections/${slug}`, {
        headers: { 'user-agent': 'Mozilla/5.0', accept: 'application/json' },
      });
    } catch (e) { out = [`ERR-NET`, e.message.slice(0, 40), '']; break; }
    if (r.status === 429 || r.status === 401) { await sleep(8000 * (a + 1)); continue; }
    if (!r.ok) { out = [`ERR${r.status}`, '', '']; break; }
    const c = await r.json();
    const eth = (c.contracts || []).find((x) => x.chain === 'ethereum');
    out = [eth ? eth.address : 'NO-ETH-CONTRACT', c.name || '', String(c.total_supply ?? '')];
    break;
  }
  if (out[0] === 'RATE-LIMITED') exhausted++;
  console.log([slug, ...out].join('\t'));
  await sleep(1500);
}
if (exhausted) {
  console.error(`\n${exhausted}/${slugs.length} slugs hit the keyless rate limit and are UNRESOLVED, `
    + 'not unresolvable. Re-run those through resolve-slugs-scrape.mjs.');
  process.exit(2);
}
