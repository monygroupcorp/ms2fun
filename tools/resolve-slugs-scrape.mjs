#!/usr/bin/env node
// Resolve OpenSea slugs to mainnet contracts by scraping the collection page, for when the keyless
// v2 API is exhausted (it 401s after ~a dozen lookups per window).
//
//   node tools/resolve-slugs-scrape.mjs slugs.tsv > slug-address.tsv   # slug<TAB>expectedName
//
// The candidate is the most-repeated 0x address on the page that is not known infrastructure. It is
// then VERIFIED on chain: the contract's own `name()` must agree with the expected collection name.
//
// HOW STRICT THE VERIFY IS, AND WHY. The first version accepted a match when the first six
// normalized characters agreed. Across a census where most collections are named "Milady<x>" that
// rule verifies almost anything against almost anything, and a wrong address entering the catalog
// is worse than an unresolved row — an unresolved row is visibly unfinished, a wrong one is not.
// So: containment either way is VERIFIED; a shared prefix is VERIFIED only when it is long enough
// to be discriminating AND no other candidate shares it; anything else is WEAK or UNVERIFIED, and
// those are for a human, not for the catalog.
import { readFileSync } from 'node:fs';

const RPC = process.env.MAINNET_RPC_URL;
if (!RPC) { console.error('MAINNET_RPC_URL required'); process.exit(1); }
const file = process.argv[2];
if (!file) { console.error('usage: resolve-slugs-scrape.mjs <slugs.tsv>'); process.exit(1); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const IGNORE = new Set([
  '0x0000000000000000000000000000000000000000',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0x00000000000000adc04c56bf30ac9d3c0aaf14dc', // Seaport 1.5
  '0x0000000000000068f116a894984e2db1123eb395', // Seaport 1.6
  '0x000000000000000000000000000000000000dead',
]);

// A shared prefix shorter than this is not evidence in a family whose members are all named alike.
const PREFIX_MIN = 10;

async function nameOf(addr) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: addr, data: '0x06fdde03' }, 'latest'] }),
  });
  if (!res.ok) throw new Error(`eth_call HTTP ${res.status}`);
  const { result, error } = await res.json();
  if (error) throw new Error(`eth_call: ${error.message}`);
  if (!result || result === '0x' || result.length < 130) return null;
  const len = parseInt(result.slice(2).slice(64, 128), 16);
  if (!Number.isFinite(len) || len * 2 > result.length - 2 - 128) return null;
  return Buffer.from(result.slice(2).slice(128, 128 + len * 2), 'hex').toString('utf8');
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const sharedPrefix = (a, b) => { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; };

for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
  const [slug, expected = ''] = line.split('\t');
  let row = [slug, 'NOT-FOUND', '', ''];
  try {
    const r = await fetch(`https://opensea.io/collection/${slug}`, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
    });
    if (!r.ok) throw new Error(`opensea HTTP ${r.status}`);
    const html = await r.text();
    const counts = new Map();
    for (const m of html.matchAll(/0x[0-9a-fA-F]{40}/g)) {
      const a = m[0].toLowerCase();
      if (IGNORE.has(a)) continue;
      counts.set(a, (counts.get(a) || 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

    // Read every candidate's name BEFORE ruling, so "no other candidate shares this prefix" is a
    // statement about the whole candidate set rather than about whichever one was tried first.
    const cands = [];
    for (const [address] of ranked) {
      const onchain = await nameOf(address).catch(() => null);
      if (onchain) cands.push({ address, onchain, n: norm(onchain) });
    }

    const want = norm(expected);
    let best = null;
    for (const c of cands) {
      let verdict = 'UNVERIFIED';
      if (want && c.n && (c.n.includes(want) || want.includes(c.n))) verdict = 'VERIFIED';
      else if (want && c.n) {
        const p = sharedPrefix(c.n, want);
        const uniquePrefix = cands.every((o) => o === c || sharedPrefix(o.n, want) < p);
        verdict = p >= PREFIX_MIN && uniquePrefix ? 'VERIFIED' : (p >= 4 ? 'WEAK' : 'UNVERIFIED');
      }
      const rank = { VERIFIED: 3, WEAK: 2, UNVERIFIED: 1 }[verdict];
      if (!best || rank > best.rank) best = { ...c, verdict, rank };
      if (verdict === 'VERIFIED') break;
    }
    if (best) row = [slug, best.address, best.onchain, best.verdict];
    else if (ranked.length) row = [slug, ranked[0][0], '', 'NO-NAME'];
  } catch (e) { row = [slug, 'ERR', e.message.slice(0, 40), '']; }
  console.log(row.join('\t'));
  await sleep(1200);
}
