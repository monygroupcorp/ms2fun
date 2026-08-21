#!/usr/bin/env node
// Measure a collection's REAL secondary market: sale volume and royalties ACTUALLY PAID.
//
//   node tools/harvest-secondary.mjs <address> [--label <name>] [--from <block>] [--to <block>]
//                                    [--write [dir]]
//
// Mint revenue is the small half of what these collections earned. Royalties on secondary are paid
// continuously and, for a collection that kept trading, dwarf the mint. This reads Alchemy's
// `getNFTSales` (every marketplace, paginated) over a FIXED BLOCK RANGE and sums, per currency,
// the sale volume and the royalty actually paid — creator take-home, never an assumed rate.
//
// WHAT VOLUME MEANS HERE. A sale price is split three ways by the marketplace and Alchemy reports
// the legs separately: `sellerFee` (proceeds to the seller), `protocolFee` (the marketplace's cut)
// and `royaltyFee` (the creator's). VOLUME IS THE SUM OF ALL THREE. Summing only `sellerFee` — as
// the first version of this tool did — understates volume by the whole fee load and, because the
// royalty rate is royalties over volume, systematically OVERSTATES the effective royalty rate. The
// census's argument is that royalties were competed to nothing, so the denominator has to be the
// real one or the argument is made on a number that flatters it.
//
// CURRENCIES. Native ETH, WETH and Blur's BETH are summed as ETH-equivalent at 1:1 (BETH and WETH
// are both 1:1 claims on ETH). Everything else is reported separately, per token, for BOTH volume
// and royalties, and is NEVER folded into the ETH figure — a USDC sale is not an ETH sale.
//
// FAILURE IS LOUD. Every path that cannot complete the full range exits non-zero and writes no
// record. The predecessor broke out of its page loop on a failed fetch and printed zeros, so a
// rate-limited or mis-keyed run produced a plausible record of a collection that never traded.
// That is indistinguishable from a real zero and it is the exact fabrication this census must not
// contain.

import { writeSection } from './lib/record.mjs';
import { nftBase } from './lib/alchemy.mjs';

const TOOL = 'harvest-secondary.mjs';
const TOOL_VERSION = 2;   // v2: bounded range + provenance, volume = seller+protocol+royalty, hard-fail

const RPC = process.env.MAINNET_RPC_URL;
if (!RPC) { console.error('MAINNET_RPC_URL required'); process.exit(1); }

const NFT_BASE = nftBase(RPC);

const addr = (process.argv[2] || '').toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(addr)) {
  console.error('usage: harvest-secondary.mjs <address> [--label s] [--from n] [--to n] [--write [dir]]');
  process.exit(1);
}
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const label = arg('--label', null);

const ETH_LIKE = new Set([
  '',
  '0x0000000000000000000000000000000000000000',
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  '0x0000000000a39bb272e79075ade125fd351887ac', // Blur BETH
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (msg) => { console.error(`FATAL ${addr}: ${msg}`); process.exit(1); };

async function getJson(url, what) {
  let last = null;
  for (let a = 0; a < 6; a++) {
    let r;
    try { r = await fetch(url); } catch (e) { last = e.message; await sleep(600 * (a + 1)); continue; }
    // 429 is backpressure to wait on, never an item failure to skip past.
    if (r.status === 429 || r.status >= 500) { last = `HTTP ${r.status}`; await sleep(600 * (a + 1)); continue; }
    if (!r.ok) fail(`${what}: HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`);
    return r.json();
  }
  fail(`${what}: gave up after 6 attempts (last: ${last})`);
}

// Bound the range. getNFTSales with no bound means "up to whenever this happened to run", which
// cannot be re-harvested to the same answer — and a deterministic re-harvest is the verification.
const headRes = await (await fetch(RPC, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
}).catch(() => fail('eth_blockNumber: request failed'))).json();
if (!headRes.result) fail(`eth_blockNumber: ${JSON.stringify(headRes.error || headRes).slice(0, 200)}`);
const chainHead = BigInt(headRes.result);

const fromBlock = BigInt(arg('--from', '0'));
const toBlock = BigInt(arg('--to', chainHead.toString()));
if (toBlock > chainHead) fail(`--to ${toBlock} is past the chain head ${chainHead}`);
if (fromBlock > toBlock) fail('--from is after --to');

let pageKey, sales = 0, pages = 0;
let volEth = 0n, royEth = 0n, protoEth = 0n, salesWithRoyalty = 0;
const otherVolume = new Map();
const otherRoyalty = new Map();
const byMarket = new Map();
const seen = new Set();

for (;;) {
  const url = `${NFT_BASE}/getNFTSales?contractAddress=${addr}`
    + `&fromBlock=${fromBlock}&toBlock=${toBlock}&order=asc&limit=100`
    + (pageKey ? `&pageKey=${encodeURIComponent(pageKey)}` : '');
  const json = await getJson(url, `getNFTSales page ${pages}`);
  if (!json || !Array.isArray(json.nftSales)) {
    fail(`getNFTSales page ${pages}: no nftSales array in response `
      + `(${JSON.stringify(json).slice(0, 200)}) — refusing to report a partial total`);
  }
  pages++;

  for (const s of json.nftSales) {
    // A bundle can list the same log more than once across pages; count each settlement once.
    const k = `${s.transactionHash}:${s.logIndex ?? ''}:${s.tokenId ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    sales++;
    byMarket.set(s.marketplace || 'unknown', (byMarket.get(s.marketplace || 'unknown') || 0) + 1);

    let royaltyThisSale = 0n;
    const take = (fee, kind) => {
      if (!fee || fee.amount == null) return;
      const tok = (fee.tokenAddress || '').toLowerCase();
      let amt;
      try { amt = BigInt(fee.amount); } catch { fail(`unparseable ${kind} amount ${fee.amount}`); }
      if (ETH_LIKE.has(tok)) {
        // Volume is every leg of the price. The seller's proceeds alone are not the sale.
        volEth += amt;
        if (kind === 'royalty') { royEth += amt; royaltyThisSale += amt; }
        if (kind === 'protocol') protoEth += amt;
      } else {
        // Non-ETH royalties were dropped entirely by v1 — counted in neither bucket. Reported now.
        const m = kind === 'royalty' ? otherRoyalty : otherVolume;
        m.set(tok, (m.get(tok) || 0n) + amt);
      }
    };
    take(s.sellerFee, 'seller');
    take(s.protocolFee, 'protocol');
    take(s.royaltyFee, 'royalty');
    if (royaltyThisSale > 0n) salesWithRoyalty++;
  }

  pageKey = json.pageKey;
  if (!pageKey) break;
  if (pages % 20 === 0) process.stderr.write(`\r  ${label || addr}: ${sales} sales, ${pages} pages...`);
}
process.stderr.write(`\r  ${label || addr}: ${sales} sales over ${pages} pages - done\n`);

const section = {
  label,
  sales,
  pages,
  // Sum of sellerFee + protocolFee + royaltyFee across ETH-equivalent settlements.
  volumeWei: volEth.toString(),
  royaltiesPaidWei: royEth.toString(),
  protocolFeesWei: protoEth.toString(),
  salesWithRoyalty,
  byMarketplace: Object.fromEntries([...byMarket].sort((a, b) => b[1] - a[1])),
  // Never folded into the ETH figures. Kept per token so materiality is judgeable.
  nonEth: {
    volume: Object.fromEntries([...otherVolume].map(([k, v]) => [k, v.toString()])),
    royalties: Object.fromEntries([...otherRoyalty].map(([k, v]) => [k, v.toString()])),
  },
  harvest: {
    tool: TOOL,
    toolVersion: TOOL_VERSION,
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    chainHead: chainHead.toString(),
    harvestedAt: new Date().toISOString(),
    complete: true,
  },
};

console.log(JSON.stringify(section, null, 2));

if (has('--write')) {
  const i = process.argv.indexOf('--write');
  const next = process.argv[i + 1];
  const dir = next && !next.startsWith('--') ? next : 'data/alignment/collections';
  console.error(`  wrote ${writeSection(dir, addr, 'secondary', section)}`);
}
