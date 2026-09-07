#!/usr/bin/env node
// Derive the interface A-K contract-surface coverage map. Read-only, no network, no model.
//
//   node tools/contract-surface.mjs              # the gate: exit 1 on any unclaimed function
//   node tools/contract-surface.mjs --list       # every function, its interface, and its UI path
//   node tools/contract-surface.mjs --list=K     # one interface
//   node tools/contract-surface.mjs --unclaimed  # only the functions that fail the gate
//
// The north star says every external contract function has a provable UI path. That claim was a
// hand-typed table once, and a hand-typed table is a photograph: it was true on the day someone
// wrote it and says nothing about today. This derives the same map from the two things that
// actually move -- the built ABIs under contracts/out, and the app source that calls them -- so
// the answer is a command's exit code rather than a paragraph.
//
// What this proves: that a non-test app source file names the function against that contract's ABI.
// What it does NOT prove, and no static check can: that the path WORKS when a wallet walks it.
// Reachability is the cheap half; the walk is the half a human still owes.
//
// A function with no UI path fails the gate. To pass, it either gets one, or gets a rule in
// contract-surface.json's `skip` with a reason -- which is the point: the surface that is
// deliberately out of the app is stated once, in the open, instead of being silently absent.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'tools', 'contract-surface.json');
const OUT = join(ROOT, 'contracts', 'out');
const APP_SRC = join(ROOT, 'app', 'src');

const argv = process.argv.slice(2);
const flag = (n) => argv.find((a) => a === `--${n}` || a.startsWith(`--${n}=`));
const flagValue = (n) => { const f = flag(n); return f && f.includes('=') ? f.split('=').slice(1).join('=') : null; };

const die = (msg) => { console.error(msg); process.exit(2); };

let manifest;
try { manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')); }
catch (e) { die(`cannot read ${relative(ROOT, MANIFEST)}: ${e.message}`); }

// ---------------------------------------------------------------- the contract surface

// wagmi's foundry plugin names the binding for `Foo` as `fooAbi`, lowercasing the leading run of
// capitals but keeping a trailing digit-word intact (ERC404Factory -> erc404FactoryAbi,
// MasterRegistryV1 -> masterRegistryV1Abi). Mirror that exactly or the ABI-identifier match misses.
const abiIdent = (name) => {
  const m = name.match(/^([A-Z]+[0-9]*)(?=[A-Z][a-z]|$)/);
  const head = m ? m[1] : name[0];
  return `${head.toLowerCase()}${name.slice(head.length)}Abi`;
};
const pascal = (s) => s[0].toUpperCase() + s.slice(1);

function loadAbi(entry) {
  const file = entry.artifact ?? `${entry.name}.sol`;
  const path = join(OUT, file, `${entry.name}.json`);
  let json;
  try { json = JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) {
    die(`no artifact for ${entry.name} at ${relative(ROOT, path)} (${e.code === 'ENOENT' ? 'not built' : e.message})\n` +
        `  build first:  cd contracts && forge build`);
  }
  return json.abi ?? [];
}

// One row per (contract, function name). Overloads collapse: the app names a function by string,
// not by signature, so a per-signature row could never be distinguished by any reference check.
const surface = [];
for (const entry of manifest.contracts.filter((c) => c.name)) {
  const seen = new Set();
  for (const item of loadAbi(entry)) {
    if (item.type !== 'function') continue;
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    surface.push({ contract: entry.name, fn: item.name, mutability: item.stateMutability });
  }
}
if (surface.length === 0) die('the derived surface is empty -- that is a statement about this script, not about the repo');

// ---------------------------------------------------------------- what the app references

// A test file is not a UI path. It is the most tempting false positive here: the mock that asserts
// a panel calls `withdrawPrincipal` names the function exactly as the panel does, so counting tests
// would report a fully-covered surface for an app with no panels at all.
const isTest = (p) => /\.(test|spec)\.[tj]sx?$/.test(p);
const isSource = (p) => /\.[tj]sx?$/.test(p) && !isTest(p);

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'generated' && name !== 'node_modules') walk(p, acc); }
    else if (isSource(p)) acc.push(p);
  }
  return acc;
}

let files;
try { files = walk(APP_SRC); }
catch (e) { die(`cannot read ${relative(ROOT, APP_SRC)}: ${e.message}`); }

const index = files.map((path) => {
  const text = readFileSync(path, 'utf8');
  return {
    path: relative(ROOT, path),
    // `functionName: 'buyBonding'` -- the viem/wagmi call form.
    names: new Set([...text.matchAll(/(?:functionName|eventName)\s*:\s*['"`]([A-Za-z0-9_$]+)['"`]/g)].map((m) => m[1])),
    // `abi: erc404BondingInstanceAbi` and its import -- which contract the call is against.
    abis: new Set([...text.matchAll(/\b([a-z][A-Za-z0-9]*Abi)\b/g)].map((m) => m[1])),
    // `useReadErc404BondingInstanceBondingActive()` -- the generated-hook call form, which names
    // the contract and the function in one identifier.
    hooks: new Set([...text.matchAll(/\buse(?:Read|Write|Simulate|WatchContractEvent)([A-Za-z0-9]+)\b/g)].map((m) => m[1])),
  };
});

// ---------------------------------------------------------------- interfaces A-K

const ifaceEntries = Object.entries(manifest.interfaces);
function interfaceOf(appPath) {
  let best = null, bestLen = -1;
  for (const [key, def] of ifaceEntries) {
    for (const prefix of def.paths) {
      if (appPath === prefix || appPath.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)) {
        if (prefix.length > bestLen) { best = key; bestLen = prefix.length; }
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- the skip list (the old "L")

const skipRules = manifest.skip.filter((r) => r.match).map((r, i) => {
  const [c, f] = r.match.split('.');
  if (!f) die(`contract-surface.json skip[${i}]: match must read "Contract.function" (either side may be *)`);
  const glob = (pat) => pat === '*' ? () => true
    : pat.includes('*') ? (s) => new RegExp(`^${pat.split('*').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(s)
    : (s) => s === pat;
  return { ...r, hitsContract: glob(c), hitsFn: glob(f), used: 0 };
});
const skipFor = (row) => skipRules.find((r) => r.hitsContract(row.contract) && r.hitsFn(row.fn));

// ---------------------------------------------------------------- resolve

// A UI path may address a contract through a hand-written ABI slice rather than the generated
// binding -- useVaultsSummary's three-fragment `vaultSummaryAbi` exists precisely because the full
// vault ABI blows up TS inference. Those slices are named in the manifest, because which contract a
// local slice speaks to is a fact about intent that no amount of reading the file recovers.
const aliasesFor = (contract) =>
  Object.entries(manifest.aliases ?? {})
    .filter(([, targets]) => targets.includes('*') || targets.includes(contract))
    .map(([ident]) => ident);

for (const row of surface) {
  const ident = abiIdent(row.contract);
  const idents = [ident, ...aliasesFor(row.contract)];
  const hook = `${pascal(ident.replace(/Abi$/, ''))}${pascal(row.fn)}`;
  row.paths = index
    .filter((f) => (idents.some((i) => f.abis.has(i)) && f.names.has(row.fn)) || f.hooks.has(hook))
    .map((f) => f.path);
  row.interfaces = [...new Set(row.paths.map(interfaceOf).filter(Boolean))].sort();
  row.unplaced = row.paths.filter((p) => interfaceOf(p) === null);
  const rule = skipFor(row);
  if (rule) { rule.used++; row.skip = rule.why; }
}

// ---------------------------------------------------------------- report

const wired = surface.filter((r) => r.paths.length > 0);
const unclaimed = surface.filter((r) => r.paths.length === 0 && !r.skip);
// A skip rule that also has a UI path is not wrong, but a rule matching nothing at all is: it
// describes a function that no longer exists, and it is the way a skip list rots into fiction.
const deadRules = skipRules.filter((r) => r.used === 0);

const listArg = flag('list');
if (listArg) {
  const only = flagValue('list');
  for (const [key, def] of ifaceEntries) {
    if (only && key !== only) continue;
    const rows = surface.filter((r) => r.interfaces.includes(key));
    console.log(`\n### ${key}. ${def.name} — ${rows.length} function(s)`);
    for (const r of rows.sort((a, b) => `${a.contract}.${a.fn}`.localeCompare(`${b.contract}.${b.fn}`))) {
      console.log(`  ${r.contract}.${r.fn}  [${r.mutability}]`);
      for (const p of r.paths.filter((p) => interfaceOf(p) === key)) console.log(`      ${p}`);
    }
  }
  if (!only) {
    console.log(`\n### skipped — stated as out of the app, not missing from it`);
    for (const r of surface.filter((x) => x.skip && x.paths.length === 0).sort((a, b) => a.contract.localeCompare(b.contract)))
      console.log(`  ${r.contract}.${r.fn} — ${r.skip}`);
  }
  console.log('');
}

if (flag('unclaimed') || (!listArg && unclaimed.length)) {
  for (const r of unclaimed.sort((a, b) => `${a.contract}.${a.fn}`.localeCompare(`${b.contract}.${b.fn}`)))
    console.log(`UNCLAIMED ${r.contract}.${r.fn} [${r.mutability}] — no non-test app source names it, and no skip rule covers it`);
}
for (const r of deadRules) console.log(`DEAD RULE  ${r.match} — matches nothing in the built surface`);
for (const r of wired.filter((x) => x.interfaces.length === 0))
  console.log(`UNPLACED   ${r.contract}.${r.fn} — referenced from ${r.unplaced[0]}, which no interface's paths claim`);

const unplaced = wired.filter((r) => r.interfaces.length === 0).length;
console.log(
  `\n${surface.length} external function(s) across ${manifest.contracts.filter((c) => c.name).length} contract(s): ` +
  `${wired.length} with a UI path, ${surface.length - wired.length - unclaimed.length} skipped, ${unclaimed.length} unclaimed` +
  (unplaced ? `, ${unplaced} referenced from an unplaced path` : '') +
  (deadRules.length ? `, ${deadRules.length} dead skip rule(s)` : ''),
);
console.log('a UI path is reachability, not a walk: --list names the files a walker opens.');

process.exit(unclaimed.length || deadRules.length || unplaced ? 1 : 0);
