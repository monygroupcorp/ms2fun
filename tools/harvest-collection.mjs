#!/usr/bin/env node
// Harvest the alignment-catalog MINT facts for one mainnet NFT collection, straight off chain.
//
//   node tools/harvest-collection.mjs <address> [--from <block>] [--to <block>] [--label <name>]
//                                     [--write [dir]]
//
// Emits one JSON object on stdout: identity, supply, metadata host, the mint census, and the ETH
// minters actually spent. Everything is measured; nothing is inferred from a listing site.
// `--write` additionally merges the result into `data/alignment/collections/<address>.json`.
//
// WHAT THE MINT-ETH FIGURE IS, EXACTLY. It is the sum of `tx.value` over the transactions that
// emitted a Transfer from 0x0. It therefore INCLUDES overpayment a contract refunded, and EXCLUDES
// secondary royalties and any revenue that never touched the mint transaction. It is a floor on
// take-home, and the floor is the honest number because it is the one anyone can re-derive.
//
// TWO WAYS THIS MEASUREMENT IS KNOWN TO BE WRONG, both reported rather than silently absorbed:
//
//   * AUCTION-NATIVE COLLECTIONS ARE UNDERCOUNTED, badly. An auction winner pays in bids; the
//     settlement transaction carries no value, so the mint looks free. Pixelady Figmata measures
//     7.20 ETH by this method against 90.27 ETH of real winning bids — off by 12.5x. There is no
//     way to correct that from mint transactions alone, so instead every record carries
//     `zeroValueIndirectTxs` and a `confidence` field, and a collection that looks auction-shaped
//     is flagged `undercount-suspected` for a hand check. A flagged row is not a wrong row; it is
//     a row that has not been measured by the right instrument yet.
//   * A BUNDLED MINT OVERSTATES. When a mint is routed through an aggregator that mints from
//     several collections in one transaction, `tx.value` covers all of them and this attributes the
//     whole of it here. `indirectMintTxs` counts the transactions whose `to` was not the
//     collection, which is the population that can suffer it.

import { writeSection } from './lib/record.mjs';

const TOOL = 'harvest-collection.mjs';
const TOOL_VERSION = 2;   // v2: bounded `toBlock` + provenance, exact wei, indirect/auction reporting

const RPC = process.env.MAINNET_RPC_URL;
if (!RPC) { console.error('MAINNET_RPC_URL required'); process.exit(1); }

const addr = (process.argv[2] || '').toLowerCase();
if (!/^0x[0-9a-f]{40}$/.test(addr)) {
  console.error('usage: harvest-collection.mjs <address> [--from n] [--to n] [--label s] [--write [dir]]');
  process.exit(1);
}
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0;

// A failed RPC call raises. It never returns an empty result that a caller could mistake for a
// measurement of zero — that confusion is the whole fabrication risk on this target.
async function rpc(batch) {
  const body = batch.map(([method, params]) => ({ jsonrpc: '2.0', id: ++id, method, params }));
  let lastStatus = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(RPC, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch (e) {
      lastStatus = e.message;
      await sleep(400 * 2 ** attempt);
      continue;
    }
    lastStatus = res.status;
    // 429 is backpressure to wait on, never an item failure to retry against.
    if (res.status === 429 || res.status >= 500) { await sleep(400 * 2 ** attempt); continue; }
    if (!res.ok) throw new Error(`rpc: HTTP ${res.status} ${await res.text().catch(() => '')}`.slice(0, 300));
    const json = await res.json();
    const arr = (Array.isArray(json) ? json : [json]).sort((a, b) => a.id - b.id);
    if (arr.length !== batch.length) throw new Error(`rpc: asked for ${batch.length} results, got ${arr.length}`);
    return arr;
  }
  throw new Error(`rpc: giving up after 6 attempts (last: ${lastStatus})`);
}
const one = async (method, params) => (await rpc([[method, params]]))[0];
const hex = (n) => '0x' + n.toString(16);

const ok = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.result;
};

// -- identity: string/uint256 getters via eth_call, decoded by hand (no ABI dep) ------------------
const SEL = { name: '0x06fdde03', symbol: '0x95d89b41', totalSupply: '0x18160ddd', tokenURI: '0xc87b56dd' };
function decodeString(data) {
  if (!data || data === '0x') return null;
  const b = data.slice(2);
  if (b.length < 128) return null;            // a bytes32-returning `name()` lands here and fails safe
  const len = parseInt(b.slice(64, 128), 16);
  if (!Number.isFinite(len) || len * 2 > b.length - 128) return null;
  return Buffer.from(b.slice(128, 128 + len * 2), 'hex').toString('utf8');
}
const decodeUint = (data) => (!data || data === '0x' ? null : BigInt(data));
const pad = (n) => BigInt(n).toString(16).padStart(64, '0');

// -- metadata host: the answer the seed needs is WHERE tokenURI points --------------------------
// `mutable` is about the CONTENT at the URI, not about the pointer: an IPFS CID cannot change
// under you, but the contract owner can still repoint `baseURI` at a different CID entirely.
function classifyHost(uri) {
  if (!uri) return { host: 'unknown', contentMutable: null };
  if (uri.startsWith('data:')) return { host: 'on-chain (data URI)', contentMutable: false };
  if (uri.startsWith('ipfs://')) return { host: 'IPFS', contentMutable: false };
  if (/^ar:\/\//.test(uri)) return { host: 'Arweave', contentMutable: false };
  try {
    const u = new URL(uri);
    if (/ipfs/i.test(u.hostname) || /\/ipfs\//.test(u.pathname)) return { host: `IPFS gateway (${u.hostname})`, contentMutable: false };
    if (/arweave/i.test(u.hostname)) return { host: `Arweave gateway (${u.hostname})`, contentMutable: false };
    return { host: `centralized (${u.hostname})`, contentMutable: true };
  } catch { return { host: 'unparseable', contentMutable: null }; }
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = '0x' + '0'.repeat(64);
const topicAddr = (t) => '0x' + t.slice(26).toLowerCase();

// -- locate the deploy block by bisecting on code presence (cheap: ~25 calls) --------------------
async function deployBlock(latest) {
  let lo = 0n, hi = latest;
  const hasCode = async (b) => ok(await one('eth_getCode', [addr, hex(b)]), 'eth_getCode') !== '0x';
  if (!(await hasCode(hi))) throw new Error('no code at address');
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (await hasCode(mid)) hi = mid; else lo = mid + 1n;
  }
  return lo;
}

// -- mint census: every Transfer from 0x0, joined to the value of the tx that caused it ----------
async function harvestMints(fromBlock, toBlock) {
  const logs = [];
  let span = 100000n;
  for (let b = fromBlock; b <= toBlock;) {
    const end = b + span - 1n > toBlock ? toBlock : b + span - 1n;
    const r = await one('eth_getLogs', [{
      address: addr, fromBlock: hex(b), toBlock: hex(end), topics: [TRANSFER_TOPIC, ZERO_TOPIC],
    }]);
    if (r.error) {
      if (span === 1n) throw new Error(`eth_getLogs at block ${b}: ${r.error.message}`);
      span = span / 4n > 0n ? span / 4n : 1n;         // range too wide / too many results
      continue;
    }
    logs.push(...r.result);
    b = end + 1n;
    if (r.result.length < 5000 && span < 100000n) span *= 2n;
  }

  // Mints group by transaction: one tx can mint many tokens, and its value covers all of them. So
  // the token COUNT is per token and the ETH is per transaction, counted once.
  const byTx = new Map();
  const recipients = new Set();
  for (const l of logs) {
    const e = byTx.get(l.transactionHash) || { count: 0, block: BigInt(l.blockNumber) };
    e.count++;
    byTx.set(l.transactionHash, e);
    if (l.topics[2]) recipients.add(topicAddr(l.topics[2]));
  }

  const hashes = [...byTx.keys()];
  const CHUNK = 100;
  for (let i = 0; i < hashes.length; i += CHUNK) {
    const slice = hashes.slice(i, i + CHUNK);
    const res = await rpc(slice.map((h) => ['eth_getTransactionByHash', [h]]));
    res.forEach((r, j) => {
      const tx = ok(r, `eth_getTransactionByHash ${slice[j]}`);
      if (!tx) throw new Error(`tx ${slice[j]} not found — refusing to record it as a zero-value mint`);
      const e = byTx.get(slice[j]);
      e.value = BigInt(tx.value);
      e.from = tx.from.toLowerCase();
      e.direct = (tx.to || '').toLowerCase() === addr;
    });
    process.stderr.write(`\r  mint txs ${Math.min(i + CHUNK, hashes.length)}/${hashes.length}`);
  }
  if (hashes.length) process.stderr.write('\n');

  let free = 0, paid = 0, gross = 0n, freeTxs = 0, indirect = 0, zeroValueIndirect = 0;
  let firstBlock = null, lastBlock = null;
  const senders = new Set();
  for (const e of byTx.values()) {
    if (e.value === 0n) { free += e.count; freeTxs++; if (!e.direct) zeroValueIndirect++; }
    else { paid += e.count; gross += e.value; }
    if (!e.direct) indirect++;
    senders.add(e.from);
    if (firstBlock === null || e.block < firstBlock) firstBlock = e.block;
    if (lastBlock === null || e.block > lastBlock) lastBlock = e.block;
  }
  return {
    free, paid, gross, freeTxs, indirect, zeroValueIndirect,
    txCount: byTx.size, senders: senders.size, recipients: recipients.size, firstBlock, lastBlock,
  };
}

// ---- main -------------------------------------------------------------------------------------
const chainHead = BigInt(ok(await one('eth_blockNumber', []), 'eth_blockNumber'));
const [nameR, symR, supR] = await rpc([
  ['eth_call', [{ to: addr, data: SEL.name }, 'latest']],
  ['eth_call', [{ to: addr, data: SEL.symbol }, 'latest']],
  ['eth_call', [{ to: addr, data: SEL.totalSupply }, 'latest']],
]);

// tokenURI: try id 1 then 0 -- collections disagree on where they start.
let tokenURI = null, uriId = null;
for (const probe of [1, 0]) {
  const r = await one('eth_call', [{ to: addr, data: SEL.tokenURI + pad(probe) }, 'latest']);
  const s = !r.error && r.result && r.result !== '0x' ? decodeString(r.result) : null;
  if (s) { tokenURI = s; uriId = probe; break; }
}

const from = BigInt(arg('--from', (await deployBlock(chainHead)).toString()));
// `--to` defaults to the head READ AT START and is always recorded, so the verifier can re-run the
// identical range. An unbounded harvest is not reproducible and so is not verifiable.
const to = BigInt(arg('--to', chainHead.toString()));
if (to > chainHead) throw new Error(`--to ${to} is past the chain head ${chainHead}`);
const m = await harvestMints(from, to);

// Auction-shaped: most mint transactions carry no value AND were not sent to the collection, which
// is what a settlement call looks like. Conservative on purpose — this flags for a hand check with
// the right instrument, and never adjusts a number on its own.
const auctionShaped = m.txCount > 0
  && m.zeroValueIndirect / m.txCount > 0.2
  && m.freeTxs / m.txCount > 0.5;

const section = {
  label: arg('--label', null),
  method: 'transfer-from-zero',
  total: m.free + m.paid,
  free: m.free,
  paid: m.paid,
  mintTxs: m.txCount,
  freeTxs: m.freeTxs,
  // Sent to a contract other than the collection: an aggregator, a bundler, or an auction house.
  indirectMintTxs: m.indirect,
  zeroValueIndirectTxs: m.zeroValueIndirect,
  uniqueRecipients: m.recipients,
  uniqueSenders: m.senders,
  grossWei: m.gross.toString(),
  firstBlock: m.firstBlock?.toString() ?? null,
  lastBlock: m.lastBlock?.toString() ?? null,
  confidence: auctionShaped ? 'undercount-suspected' : 'measured',
  confidenceNote: auctionShaped
    ? 'Auction-shaped: most mint txs are zero-value and were not sent to the collection. Mint-tx '
      + 'value does not measure an auction — settlement carries no value. Re-measure from the '
      + 'settlement event before quoting this row. Cf. Pixelady Figmata, off by 12.5x.'
    : null,
  identity: {
    name: decodeString(nameR.error ? null : nameR.result),
    symbol: decodeString(symR.error ? null : symR.result),
    totalSupply: supR.error ? null : (decodeUint(supR.result)?.toString() ?? null),
  },
  tokenURI: {
    id: uriId,
    uri: tokenURI,
    ...classifyHost(tokenURI),
    // ERC404BondingInstance._tokenURI concatenates `base + tokenId` with NO suffix, so a collection
    // whose tokenURI ends in the bare id can be reused as an art base verbatim. One ending in
    // `<id>.json` cannot -- it needs a resolver, which is a different seed shape.
    erc404BaseReusable: tokenURI && uriId !== null ? new RegExp(`/${uriId}$`).test(tokenURI) : null,
    erc404Base: tokenURI && uriId !== null && new RegExp(`/${uriId}$`).test(tokenURI)
      ? tokenURI.slice(0, tokenURI.length - String(uriId).length)
      : null,
  },
  harvest: {
    tool: TOOL,
    toolVersion: TOOL_VERSION,
    fromBlock: from.toString(),
    toBlock: to.toString(),
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
  console.error(`  wrote ${writeSection(dir, addr, 'mint', section)}`);
}
