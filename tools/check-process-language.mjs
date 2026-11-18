#!/usr/bin/env node
// Publication guard: a tracked file explains itself to a stranger, not to the team that wrote it.
// Read-only, no network, no key, no model.
//
//   node tools/check-process-language.mjs              # exit 1 on any finding, with file and line
//   node tools/check-process-language.mjs --self-test  # exit 1 if the rules below stopped meaning what they say
//
// This repository is public, and the reader of a comment is someone who cloned it. A comment that
// says "per noesis-276" or "ruled by <name> on 2026-08-21" sends that reader to a ticket tracker
// and a conversation they cannot open. The reason behind the code is the useful part; the
// reference to who decided it, and in which internal ticket, is a pointer into private history.
// Write the reason in plain terms, and name a role (the owner, the deployer Safe) where a person
// would otherwise appear.
//
// Four rules, each a family of phrasings this repository has actually carried:
//
//   1. Internal ticket ids: `noesis-<n>`, and `clause <n>` of a work item.
//   2. The operator's handle used as a name.
//   3. Ruling language: "ruled", "ruling", "rulings" — a decision attributed to an authority rather
//      than explained. "Ruled out" is ordinary English and stays quiet.
//   4. Internal work-tracking vocabulary: the names of the tooling, its files, and the phrasings
//      that speak of a work session or a work item ("this seat", "this goal", "the goal's clause").
//      Bare "seat", "lane" and "front" are NOT findings: the ambassador seat, the retry lane and
//      "in front of" are product and plain English, and a rule that fired on them would be
//      narrowed until it caught nothing.
//
// Files that predate the rule are listed in tools/process-language-allowlist.txt and skipped. The
// list only shrinks: a listed file that no longer has a finding is itself a finding, so a cleanup
// that forgets to remove its entry fails until it does, and nothing can be added back silently
// without a diff to that file saying so.
//
// This file and the allowlist quote the patterns they forbid, so neither is scanned. Binary files
// are skipped (detected by a NUL byte).

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = 'tools/check-process-language.mjs';
const ALLOWLIST = 'tools/process-language-allowlist.txt';

const RULES = [
  {
    name: 'internal ticket id',
    re: /\bnoesis-\d+\b|\bclause \d+\b/gi,
    fix: 'say what the code does and why; the ticket is not readable from here',
  },
  {
    name: "operator's handle",
    re: /\brth\b/gi,
    fix: 'name the role (the owner, the deployer Safe), not the person',
  },
  {
    name: 'ruling language',
    re: /\brul(?:ed|ings?)\b(?! out\b)|\brules? (?:it|them) in\b/gi,
    fix: 'state the reason for the decision instead of who made it',
  },
  {
    name: 'work-tracking vocabulary',
    re: /\b(?:pinfactory|helm|fronts\.yml|goals\.yml|decisions\.log|outbox|proprietor|foreman)\b|\b(?:this|later|next|source|previous|fresh) seat\b|\b(?:from|for|by) a seat\b|\b(?:worker|reviewer|review) seats?\b|\bthis(?: whole| same)? goal\b|\bthis front\b(?! (?:door|page|end)\b)|\bthe goal's\b|\bgoal's clauses?\b|\bexit clauses?\b|\b(?:noesis|noema|this) lane\b/gi,
    fix: 'describe the code, not the process that produced it',
  },
];

// Every finding in one file's text, as { line, why }. Separated from the filesystem so the rules
// can be tested against text that is not in the tree.
export function findProcessLanguage(text) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const rule of RULES) {
      for (const m of lines[i].matchAll(rule.re)) {
        findings.push({ line: i + 1, why: `${rule.name}: "${m[0]}" — ${rule.fix}` });
      }
    }
  }
  return findings;
}

// The allowlist: one repo-relative path per line, # comments and blank lines ignored.
export function parseAllowlist(text) {
  return new Set(text.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean));
}

function trackedFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

function readText(root, file) {
  let buf;
  try { buf = readFileSync(resolve(root, file)); }
  catch { return null; }
  return buf.includes(0) ? null : buf.toString('utf8');
}

// Every violation in the tree, as { file, line, why }. A listed file is skipped while it still has
// findings, and becomes a finding itself once it has none.
export function findInTree(root, files, allowed) {
  const findings = [];
  const tracked = new Set(files);
  for (const file of files) {
    if (file === SELF || file === ALLOWLIST) continue;
    const text = readText(root, file);
    if (text === null) continue;
    const found = findProcessLanguage(text);
    if (allowed.has(file)) {
      if (!found.length) findings.push({ file, line: null, why: `clean, but still in ${ALLOWLIST} — remove the entry` });
      continue;
    }
    for (const f of found) findings.push({ file, ...f });
  }
  for (const file of allowed) {
    if (!tracked.has(file)) findings.push({ file, line: null, why: `listed in ${ALLOWLIST} but not tracked — remove the entry` });
  }
  return findings;
}

const SELF_TEST = [
  // rule 1
  ['a ticket id in a test title', '// search matches name OR creator (noesis-325 clause 2)', 2],
  ['a ticket id as a reason', 'deploy rights is intended (owner, noesis-276).', 1],
  ['a clause of a work item', 'This audit is what `testnet-deploy` clause 1 waits on', 1],
  // rule 2
  ['the handle as an authority', '// rth: "the contracts listed on the page"', 1],
  ['the handle, possessive', "the pin is repointed on rth's cadence", 1],
  // rule 3
  ['ruled by a person', ' * `true` (RULED BY the owner 2026-08-21): accept https', 1],
  ['a ruling, cited', '// per the ruling of 2026-09-25', 1],
  ['rulings, plural', 'see the rulings for the history', 1],
  // rule 4
  ['the tool by name', 'recorded in pinfactory', 1],
  ['its log file', 'in `decisions.log`.', 1],
  ['a work session', 'at the wei this seat measured', 1],
  ['a session as the actor', 'needs a key, and so runs from a seat.', 1],
  ['a work item', "The goal's clause asks for this notice to go", 1],
  ['a work item, demonstrative', 'what it was before this goal.', 1],
  ['a line of work', 'merged into the noesis lane', 1],
  ['a session in the future', 'recorded so a later seat does not re-open it', 1],
  ['a session as a source', 'Not individually enumerated by the source seat', 1],
  ['a work item, qualified', 'the failure this whole goal is', 1],
  ['a work stream', 'nothing else lands on this front', 1],
  ['a ruling as a verb', 'the owner disagrees and rules them in', 1],

  // quiet: product vocabulary and plain English that shares the words
  ['the ambassador seat', 'renders nothing when the connected wallet holds no seat on this community', 0],
  ['a seat that is product', 'the platform owner can revoke the seat at any time', 0],
  ['the retry lane', 'The treasury is trusted, so there is no pending-retry lane.', 0],
  ['in front of', 'the art service in front of the roster', 0],
  ['ruled out', 'a reentrancy path was ruled out by the lock', 0],
  ['rule it out, as English', 'a fork test would rule it out', 0],
  ['the front door, as English', 'this front door to the registry', 0],
  ['a word containing the handle', 'the north fork and the earth', 0],
  ['a hyphenated name that is not a ticket', 'the noesis-app package', 0],
  ['clause as grammar', 'const clauses = tiers.map((t) => t.label)', 0],
  ['a goal as plain English', 'The design goal is a single state device', 0],
];

function selfTest() {
  const failures = [];
  for (const [name, text, want] of SELF_TEST) {
    const got = findProcessLanguage(text).length;
    if (got !== want) failures.push(`${name}: expected ${want} finding(s), got ${got} — ${text}`);
  }
  const listed = parseAllowlist('# header\n\na/b.ts  # why\nc.md\n');
  if (!(listed.size === 2 && listed.has('a/b.ts') && listed.has('c.md'))) failures.push('allowlist parsing: comments or blanks were read as paths');
  for (const f of failures) console.error(f);
  if (failures.length) {
    console.error(`\n${failures.length} case(s) failed: this guard no longer catches what it says it catches.`);
    return 1;
  }
  console.log(`${SELF_TEST.length + 1} case(s) pass: every rule matches what its comment claims.`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());

  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const allowed = parseAllowlist(readText(root, ALLOWLIST) ?? '');
  const findings = findInTree(root, trackedFiles(root), allowed);
  for (const f of findings) console.error(`${f.file}${f.line === null ? '' : `:${f.line}`}: ${f.why}`);
  if (findings.length) {
    console.error(`\n${findings.length} finding(s): a tracked file speaks to the team that wrote it rather than to its reader.`);
    process.exit(1);
  }
  console.log(`clean (${allowed.size} file(s) still on the allowlist).`);
}
