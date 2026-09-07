// The app's write surface, derived from source. Read-only, no network, no model.
//
// One question, answered by reading rather than by remembering: which contract functions can a
// person actually cause to run by using the app? That set is what a tester walks, and it is the
// only definition of "the external contract functions with a UI path" that cannot go stale — it is
// recomputed from the code on every run, so a write added to a panel next week shows up here
// whether or not anyone remembered to write it down.
//
// How a call site is recognised. Two shapes, both of which carry the abi and the function name in
// the source itself:
//   1. a generated per-function hook — `useWriteErc1155InstanceMint()`. The codegen declares each
//      one as `createUseWriteContract({ abi: erc1155InstanceAbi, functionName: 'mint' })`, so the
//      generated file is itself the hook -> (abi, function) map and nothing is guessed.
//   2. a literal pairing — `{ abi: erc404BondingInstanceAbi, functionName: 'setBondingActive' }`,
//      passed to useTxAction's send, writeContract, useReadContract(s) or simulateContract.
//
// Read or write is then decided by the ABI's own stateMutability, never by which hook was called.
// A `view`/`pure` entry is a read and is dropped; everything else is a write a tester can fire.
//
// What this does NOT cover, and no source scan can: a write reached through a dynamically built
// call (a functionName held in a variable, an encoded calldata blob passed to a router). Those are
// reported as `unresolved` rather than silently omitted, because a surface that under-reports reads
// exactly like a surface that is fully walked.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const GENERATED = 'app/src/generated/contracts.ts';

/** Every .ts/.tsx under `dir`, minus tests, type declarations and the generated bindings. */
export function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== 'generated' && entry !== 'node_modules') sourceFiles(path, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.|\.d\.ts$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Blank out comments and string bodies, preserving length and newlines so every offset and line
 * number computed against the result still points at the real file. Without this, the usage example
 * in a doc comment reads as a call site.
 */
function blankNonCode(src) {
  const out = src.split('');
  let i = 0;
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') {
      const end = src.indexOf('\n', i);
      blank(i, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end;
    } else if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      blank(i, end === -1 ? src.length : end + 2);
      i = end === -1 ? src.length : end + 2;
    } else if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
      // Keep the quotes themselves so `functionName: 'mint'` still matches; blank nothing here —
      // string CONTENT is what we read, and a stray comment marker inside one is rare enough that
      // treating quotes as opaque would cost more than it saves. Skip to the close instead.
      const quote = src[i];
      let k = i + 1;
      while (k < src.length && src[k] !== quote) k += src[k] === '\\' ? 2 : 1;
      i = k + 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/**
 * Function entries of every `export const <name>Abi = [...]` in `text`, as
 * abiIdent -> Map(functionName -> stateMutability). Only depth-1 elements of the array are read, so
 * a tuple parameter's own `name:` is never mistaken for a function's.
 */
function abisIn(text) {
  const found = new Map();
  for (const m of text.matchAll(/\bconst (\w+) = \[/g)) {
    const ident = m[1];
    const start = m.index + m[0].length - 1;
    let depth = 0;
    let end = start;
    for (let i = start; i < text.length; i++) {
      const c = text[i];
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const body = text.slice(start + 1, end);
    const fns = new Map();
    // Split the array into its depth-0 elements, then read each element's own top-level keys.
    let depth2 = 0;
    let elementStart = 0;
    for (let i = 0; i <= body.length; i++) {
      const c = body[i];
      if (c === '[' || c === '{') depth2++;
      else if (c === ']' || c === '}') depth2--;
      if ((c === ',' && depth2 === 0) || i === body.length) {
        const element = body.slice(elementStart, i);
        elementStart = i + 1;
        const key = (name) => {
          let d = 0;
          for (const k of element.matchAll(new RegExp(`[[{}\\]]|${name}:\\s*'([^']*)'`, 'g'))) {
            if (k[0] === '{' || k[0] === '[') d++;
            else if (k[0] === '}' || k[0] === ']') d--;
            else if (d === 1) return k[1];
          }
          return undefined;
        };
        if (key('type') === 'function') {
          const name = key('name');
          if (name) fns.set(name, key('stateMutability') ?? 'nonpayable');
        }
      }
    }
    if (fns.size) found.set(ident, fns);
  }
  return found;
}

/**
 * viem's own `erc20Abi`, the one ABI the app names that is declared in neither the codegen nor our
 * source. Only the entries the app reaches are needed; a name absent here is reported as unknown
 * rather than assumed to be a read.
 */
const VIEM_ERC20 = new Map([
  ['approve', 'nonpayable'], ['transfer', 'nonpayable'], ['transferFrom', 'nonpayable'],
  ['allowance', 'view'], ['balanceOf', 'view'], ['decimals', 'view'], ['name', 'view'],
  ['symbol', 'view'], ['totalSupply', 'view'],
]);

/** Every ABI the app can name, generated and hand-written alike. */
export function loadAbis(root) {
  const abis = new Map([['erc20Abi', VIEM_ERC20]]);
  for (const file of [join(root, GENERATED), ...sourceFiles(join(root, 'app/src'))]) {
    for (const [ident, fns] of abisIn(readFileSync(file, 'utf8'))) {
      if (!abis.has(ident)) abis.set(ident, fns);
    }
  }
  return abis;
}

/**
 * `const x = { ..., abi: someAbi, ... }`, as ident -> abi. A call site that spreads such a config
 * (`{ ...exec404Contract, functionName: 'totalMessages' }`) names its contract through the spread
 * rather than inline, and without this it reads as an unpaired function name.
 *
 * Scope matters and is kept: a local `const base = {...}` is visible only in its own file, and
 * several files use that same name for different contracts. Only an EXPORTED config is global, and
 * a local one always wins over it.
 */
function configsIn(code) {
  const local = new Map();
  const exported = new Map();
  for (const m of code.matchAll(/\b(export )?const (\w+) = \{/g)) {
      const start = m.index + m[0].length - 1;
      let depth = 0;
      for (let i = start; i < code.length; i++) {
        if (code[i] === '{') depth++;
        else if (code[i] === '}') {
          depth--;
          if (depth === 0) {
            const abi = code.slice(start, i).match(/\babi:\s*(\w+)/);
            if (abi) (m[1] ? exported : local).set(m[2], abi[1]);
            break;
          }
        }
      }
  }
  return { local, exported };
}

/** The exported configs of every file, the only ones another file can spread. */
export function loadContractConfigs(root) {
  const configs = new Map();
  for (const file of sourceFiles(join(root, 'app/src'))) {
    for (const [k, v] of configsIn(blankNonCode(readFileSync(file, 'utf8'))).exported) {
      configs.set(k, v);
    }
  }
  return configs;
}

/** hookName -> { abi, fn }, read off the codegen's own declarations. */
export function loadHooks(root) {
  const text = readFileSync(join(root, GENERATED), 'utf8');
  const hooks = new Map();
  const re =
    /export const (use(?:Write|Simulate|Read)\w+) =\s*(?:\/\*[^*]*\*\/\s*)?createUse\w+Contract\(\s*\{\s*abi:\s*(\w+),\s*functionName:\s*'([^']+)'/g;
  for (const m of text.matchAll(re)) hooks.set(m[1], { abi: m[2], fn: m[3] });
  return hooks;
}

/**
 * Every (abi, function) pair the app source can reach, with the sites that reach it. `unresolved`
 * carries the `functionName:` occurrences no abi could be paired with — the scan's own blind spots,
 * reported rather than dropped.
 */
export function scanCallSites(root) {
  const hooks = loadHooks(root);
  const globalConfigs = loadContractConfigs(root);
  const sites = [];
  const unresolved = [];
  for (const file of sourceFiles(join(root, 'app/src'))) {
    const rel = relative(root, file);
    const code = blankNonCode(readFileSync(file, 'utf8'));
    const configs = new Map([...globalConfigs, ...configsIn(code).local]);
    for (const m of code.matchAll(/\buse(?:Write|Simulate|Read)\w+\b/g)) {
      const hook = hooks.get(m[0]);
      if (hook) sites.push({ file: rel, line: lineOf(code, m.index), ...hook });
    }
    // A literal pairing: the nearest `abi:` at or before the `functionName:` names the contract.
    // That is the order every call site in this app writes them in, and a `functionName:` that
    // finds no `abi:` before it is reported instead of assumed.
    const abiAt = [
      ...code.matchAll(/\babi:\s*(\w+)/g),
      ...[...code.matchAll(/\.\.\.(\w+)/g)].filter((m) => configs.has(m[1])),
    ]
      .map((m) => ({ index: m.index, abi: configs.get(m[1]) ?? m[1] }))
      .sort((a, b) => a.index - b.index);
    for (const m of code.matchAll(/\bfunctionName:\s*'([^']+)'/g)) {
      let owner;
      for (const a of abiAt) { if (a.index < m.index) owner = a; else break; }
      if (owner) sites.push({ file: rel, line: lineOf(code, m.index), abi: owner.abi, fn: m[1] });
      else unresolved.push({ file: rel, line: lineOf(code, m.index), fn: m[1] });
    }
  }
  return { sites, unresolved };
}

/**
 * The write surface: `abi.fn` -> { abi, fn, mutability, sites[] }, for every reachable pair whose
 * ABI entry is not view/pure. `unknown` carries pairs naming a function no loaded ABI declares.
 */
export function writeSurface(root) {
  const abis = loadAbis(root);
  const { sites, unresolved } = scanCallSites(root);
  const writes = new Map();
  const unknown = [];
  for (const site of sites) {
    const mutability = abis.get(site.abi)?.get(site.fn);
    if (mutability === undefined) { unknown.push(site); continue; }
    if (mutability === 'view' || mutability === 'pure') continue;
    const key = `${site.abi}.${site.fn}`;
    if (!writes.has(key)) writes.set(key, { key, abi: site.abi, fn: site.fn, mutability, sites: [] });
    writes.get(key).sites.push(`${site.file}:${site.line}`);
  }
  return { writes, unknown, unresolved };
}
