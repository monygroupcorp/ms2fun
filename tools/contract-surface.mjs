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
// What this proves: that a non-test app source FILE both names the function and speaks to that
// contract's ABI. The granularity is the file, not the call, because a name handed down as a prop
// (`functionName="setMetadataURI"`) is resolved in a child that no regex can follow -- so a file
// importing several ABIs credits each of them for each of its names, and a claim can be one file too
// generous. It is never one file too stingy, which is the direction that matters: an over-credit is
// visible to anyone who opens the file the report names, whereas an under-credit would push a live
// function into the skip list and state a falsehood there.
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

// The generated hook identifier for one (ABI identifier, function) pair -- `alignmentEndowmentVaultAbi`
// + `totalShares` -> `AlignmentEndowmentVaultTotalShares`, which `useRead…`/`useWrite…` prefix.
const hookName = (ident, fn) => `${pascal(ident.replace(/Abi$/, ''))}${changeCasePascal(fn)}`;

// wagmi runs the FUNCTION half through change-case's pascalCase, which splits on case boundaries and
// lowercases the rest of every word -- so `setMetadataURI` becomes `SetMetadataUri` and, less
// obviously, `rerollSelectedNFTs` becomes `RerollSelectedNfTs` (the split falls inside `NFTs`).
// Deriving the hook name with a plain capitalise misses every function whose name carries an
// acronym, which is how a shipped reroll button reads as a function nobody calls.
const changeCasePascal = (s) =>
  s.replace(/([\p{Ll}\d])(\p{Lu})/gu, '$1\0$2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1\0$2')
    .split(/[\0_]+/) // `_` is a word separator too: MAX_QUERY_LIMIT -> MaxQueryLimit, sealed_ -> Sealed
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join('');

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

// The app names a function three ways, and a detector that knows only the first reports a live panel
// as a function nobody calls. That is the failure mode that turns this gate into fiction, because the
// skip rule someone then writes to silence it states a falsehood in the open.
//   functionName: 'setBondingActive'                                  the plain call
//   functionName="setMetadataURI"                                     handed to a shared editor as a prop
//   functionName: fn  with  fn: 'addAmbassador' | 'removeAmbassador'  forwarded from a union
// A union yields every literal in it: the caller picks one at runtime, so the path exists for all of them.
const LITERAL = /['"`]([A-Za-z0-9_$]+)['"`]/g;

// Only one unbroken `'a' | 'b'` run starting exactly here, so the next property never bleeds in.
const unionAt = (text, from) => {
  const run = text.slice(from).match(/^(['"`][A-Za-z0-9_$]+['"`](?:\s*\|\s*['"`][A-Za-z0-9_$]+['"`])*)/);
  return run ? [...run[1].matchAll(LITERAL)].map((m) => m[1]) : [];
};

function callNames(text) {
  const names = new Set();
  for (const m of text.matchAll(/\b(?:functionName|eventName)\s*[:=]\s*\{?\s*/g)) {
    const at = m.index + m[0].length;
    const direct = unionAt(text, at);
    if (direct.length) { for (const n of direct) names.add(n); continue; }
    // The name is forwarded from a variable. Take the literals of that identifier's union annotation
    // in the same file, which is where a shared component declares which calls it stands for.
    const ident = text.slice(at).match(/^([A-Za-z_$][A-Za-z0-9_$]*)/);
    if (!ident) continue;
    for (const decl of text.matchAll(new RegExp(`\\b${ident[1]}\\s*\\??\\s*:\\s*`, 'g')))
      for (const n of unionAt(text, decl.index + decl[0].length)) names.add(n);
  }
  return names;
}

const index = files.map((path) => {
  const text = readFileSync(path, 'utf8');
  return {
    path: relative(ROOT, path),
    names: callNames(text),
    // `abi: erc404BondingInstanceAbi` and its import -- which contract the call is against. A
    // hand-written slice is named either way in this codebase (`vaultSummaryAbi`, `STYLE_ABI`), and
    // a regex that knew only the camelCase half made every SCREAMING_CASE slice invisible.
    abis: new Set([...text.matchAll(/\b([a-z][A-Za-z0-9]*Abi|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_ABI)\b/g)].map((m) => m[1])),
    // `useReadErc404BondingInstanceBondingActive()` -- the generated-hook call form, which names
    // the contract and the function in one identifier.
    hooks: new Set([...text.matchAll(/\buse(?:Read|Write|Simulate|WatchContractEvent)([A-Za-z0-9]+)\b/g)].map((m) => m[1])),
  };
});

// ---------------------------------------------------------------- the derivation checks itself

// The hook-name derivation above is a guess at somebody else's casing rule, and its failure is
// silent: get it wrong and every function of a contract reads as unclaimed, which reads as a gap in
// the app, which invites a skip rule stating something false. So check it. The generated bindings
// are read here ONLY as a table of names -- never as a UI path, which is why the source walk still
// skips that directory -- and every hook name this script builds for a contract wagmi generated
// bindings for must be one wagmi actually emitted.
const GENERATED = join(APP_SRC, 'generated', 'contracts.ts');
let generated;
try { generated = readFileSync(GENERATED, 'utf8'); }
catch (e) {
  die(`cannot read ${relative(ROOT, GENERATED)}: ${e.message}\n` +
      `  generate first:  cd app && pnpm wagmi:generate`);
}
const emitted = new Set(
  [...generated.matchAll(/export const use(?:Read|Write|Simulate|WatchContractEvent)([A-Za-z0-9]+)\b/g)].map((m) => m[1]),
);
const wrong = [];
for (const row of surface) {
  const ident = abiIdent(row.contract);
  if (!generated.includes(`export const ${ident}`)) continue; // no bindings for it; nothing to check
  const hook = hookName(ident, row.fn);
  if (!emitted.has(hook)) wrong.push(`  ${row.contract}.${row.fn} -> use*${hook}`);
}
if (wrong.length)
  die(`the hook-name derivation disagrees with the generated bindings for ${wrong.length} function(s).\n` +
      `Every count below would be wrong, so nothing is reported. Fix changeCasePascal/abiIdent first:\n` +
      wrong.slice(0, 20).join('\n'));

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

// A UI path may address a contract through an ABI identifier that is not its own generated binding,
// and which one it is cannot be recovered by reading the file:
//
//  - a hand-written slice -- useVaultsSummary's three-fragment `vaultSummaryAbi` exists precisely
//    because the full vault ABI blows up TS inference;
//  - ANOTHER contract's generated binding, where the two share an interface. The four alignment
//    vaults all implement IAlignmentVault, so `useVaultOverview` reads vaultType/accumulatedFees/
//    totalShares off any of them through the endowment family's binding: same selector, same
//    address, one hook instead of four. Reading that as "nobody calls totalShares on a Uni vault"
//    would push three live functions into the skip list and state a falsehood there.
//
// Both are named in the manifest's `aliases`, and both call forms are resolved: the `abi:` +
// `functionName:` pair, and the generated hook whose identifier carries the contract name.
const aliasesFor = (contract) =>
  Object.entries(manifest.aliases ?? {})
    .filter(([, targets]) => Array.isArray(targets) && (targets.includes('*') || targets.includes(contract)))
    .map(([ident]) => ident);

for (const row of surface) {
  const ident = abiIdent(row.contract);
  const idents = [ident, ...aliasesFor(row.contract)];
  // A hand-written slice has no generated hooks, so its name yields one that matches nothing --
  // harmless, and cheaper than tracking which aliases are bindings and which are slices.
  const hooks = idents.map((i) => hookName(i, row.fn));
  row.paths = index
    .filter(
      (f) =>
        (idents.some((i) => f.abis.has(i)) && f.names.has(row.fn)) ||
        hooks.some((h) => f.hooks.has(h)),
    )
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
