#!/usr/bin/env node
// Resolve a collection NAME to its mainnet contract, so the catalog never hand-copies an address.
//
//   node tools/resolve-collection.mjs "Redacted Remilio Babies" ["Radbro" ...]
//
// Uses the Alchemy NFT API keyed off MAINNET_RPC_URL. Prints one line per candidate match: address,
// name, symbol, supply, token type, deploy block, OpenSea floor, slug. Pick the row by hand, then
// feed the address to harvest-collection.mjs -- that is where the economics come from. This tool
// proposes candidates and never decides; a search hit is not a resolution.
import { nftBase } from './lib/alchemy.mjs';

const BASE = nftBase();
if (process.argv.length < 3) { console.error('usage: resolve-collection.mjs <name> [name ...]'); process.exit(1); }

for (const query of process.argv.slice(2)) {
  const res = await fetch(`${BASE}/searchContractMetadata?query=${encodeURIComponent(query)}`);
  if (!res.ok) {
    console.error(`# ${query}: HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
    process.exitCode = 1;
    continue;
  }
  const { contracts = [] } = await res.json();
  console.log(`\n# ${query}  (${contracts.length} matches)`);
  for (const c of contracts.slice(0, 8)) {
    const os = c.openSeaMetadata || {};
    console.log([
      c.address,
      (c.name || '?').padEnd(32).slice(0, 32),
      (c.symbol || '').padEnd(10).slice(0, 10),
      String(c.totalSupply ?? '?').padStart(10),
      (c.tokenType || '').padEnd(8),
      `blk ${c.deployedBlockNumber ?? '?'}`,
      `floor ${os.floorPrice ?? '-'}`,
      os.collectionSlug || '',
    ].join('  '));
  }
}
