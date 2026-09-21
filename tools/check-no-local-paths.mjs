#!/usr/bin/env node
// Publication guard: a tracked file must not describe the machine it was written on.
// Read-only, no network, no key, no model.
//
//   node tools/check-no-local-paths.mjs                # exit 1 on any finding, with file and line
//   node tools/check-no-local-paths.mjs --self-test    # exit 1 if the rules below stopped meaning what they say
//
// This repository is public. Everything committed to it is published, including files no human
// wrote — build receipts, run records, generated manifests. Those are the ones that leak, because
// nobody reads them before they land: a tool serialises whatever it happened to know, and what it
// happened to know includes the absolute path of the checkout it ran in and the login name of the
// account that ran it. That is a description of a private machine, and once pushed it is public
// and stays public in the history whether or not the file is later removed.
//
// It has happened here. Between 2026-09-14 and 2026-09-19, 33 JSON run records were committed under
// projects/, each carrying an absolute home-directory path and a local account name. Deleting them
// is one commit; deleting them from the published history is not. So rather than trust each writer
// to redact itself, two rules below are enforced mechanically on every push and pull request.
//
// Be clear about what this can and cannot do. A GitHub workflow runs AFTER the push it checks, so a
// red run here means the content already reached the remote; it reports a leak, it does not prevent
// one. `projects/` is in .gitignore for that reason, and THAT is the half that stops it in time.
// This check is the backstop for the case the ignore rule misses — a `git add -f`, a path nobody
// thought to ignore, a home path in a file that belongs in the tree.
//
// Two rules, both from that incident:
//
//   1. Nothing is tracked under projects/. That directory is where local build and run tooling
//      keeps its own state. Such state belongs beside the tool, not beside the product, and it is
//      not something this repository publishes.
//
//   2. No tracked text file contains an absolute path rooted in a user's home directory
//      (/home/<user>, /Users/<user>, /root). Such a path names both a private filesystem layout
//      and, in the segment after /home or /Users, an account. A path relative to the repository is
//      the portable form and the only one that means anything to someone who cloned it.
//
// Binary files are skipped (detected by a NUL byte), as is this file, which necessarily quotes the
// patterns it forbids. This checks what a file SAYS about its machine; it is not a secret scanner,
// which is a different problem with different tools.
//
// The rules are two regular expressions and a prefix list, which is to say they are exactly as good
// as their edges. `--self-test` pins those edges to named cases — each leak this has actually seen,
// and each shape that must stay quiet — so a later narrowing to silence a false positive cannot
// quietly reopen the hole. It runs in CI ahead of the tree scan: a green tree proves nothing if the
// rule scanning it has stopped matching anything.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths under these prefixes are local tooling state and are never tracked here.
const UNTRACKED_PREFIXES = ['projects/'];

// An absolute path rooted in a user's home. Three things narrow it, and each earns its keep.
//
// The lookbehind requires the leading slash to BEGIN a path rather than continue one, which is what
// keeps /root from firing on every relative path with a segment named root — leaf/root/proof, all
// through the merkle modules, is the one that found this out.
//
// A named segment must follow /home or /Users, so prose that says "under /home" is not a finding
// while /home/someone is. That the segment cannot be empty is also what keeps the placeholder form
// /home/<user> quiet: documentation is free to describe the shape of the thing it forbids.
//
// The trailing lookahead ends the match at a path boundary rather than requiring a separator there.
// Requiring the separator was the first shape of this rule and it had a hole the width of the whole
// incident: a record whose last field is "/home/someone" with nothing after it publishes that home
// and that account just as permanently as one with a checkout path underneath, and the run records
// this guard was written for carry both forms. So the account name is the finding; a directory
// under it is not needed to make one.
const HOME_PATH = /(?<![A-Za-z0-9._-])(?:(?:\/home\/|\/Users\/)[A-Za-z0-9._-]+|\/root)(?![A-Za-z0-9._-])/g;

// This file quotes the patterns above, so it cannot be held to rule 2.
const SELF = 'tools/check-no-local-paths.mjs';

// Rule 1 for one path. Null when the path is fine.
export function findUntrackedPrefix(file) {
  const prefix = UNTRACKED_PREFIXES.find((p) => file.startsWith(p));
  return prefix ? `tracked under ${prefix} — local tooling state, which this repository does not publish` : null;
}

// Rule 2 for one file's text, as { line, why }. Separated from the filesystem so the rule can be
// tested against text that is not in the tree — the leaks, by construction, are not.
export function findHomePaths(text) {
  const findings = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const m of lines[i].matchAll(HOME_PATH)) {
      findings.push({ line: i + 1, why: `absolute path into a user home: ${m[0]} — use a path relative to the repository` });
    }
  }
  return findings;
}

// Every path git tracks, repo-relative, from the repository root.
function trackedFiles(root) {
  const out = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return out.split('\0').filter(Boolean);
}

// Every violation in the tree, as { file, line, why }. An empty array means the tree is clear to
// publish. A path git tracks that is not on disk — a staged deletion, a submodule gitlink — is not
// read and is not a finding: the commit that removes it is the fix, not a failure.
export function findLocalPaths(root, files) {
  const findings = [];
  for (const file of files) {
    const why = findUntrackedPrefix(file);
    if (why) {
      findings.push({ file, line: null, why });
      continue;
    }
    if (file === SELF) continue;

    let buf;
    try { buf = readFileSync(resolve(root, file)); }
    catch { continue; }
    if (buf.includes(0)) continue;

    for (const f of findHomePaths(buf.toString('utf8'))) findings.push({ file, ...f });
  }
  return findings;
}

// What each rule must catch and what it must leave alone, by name. The caught cases are the shapes
// the run records actually carried; the quiet ones are shapes this repository actually contains, or
// contained until a rule was narrowed to let them through. A change to either regex that breaks a
// row here is either a bug or a decision that belongs in the comment above it.
const SELF_TEST = [
  // rule 2 — these are leaks
  ['a checkout path under a home', '"cwd": "/home/someone/checkout/slot-04"', 1],
  ['a bare home with nothing under it', '{"home": "/home/someone"}', 1],
  ['a macOS home', 'see /Users/someone/Library/Caches for the build', 1],
  ["root's home, bare", 'ran as "/root"', 1],
  ["root's home with a path under it", 'ran in /root/checkout', 1],
  ['two on one line', '/home/someone/a and /Users/other/b', 2],

  // rule 2 — these are not
  ['a merkle path segment named root', 'import proof from "./leaf/root/proof";', 0],
  ['a relative path segment named home', 'src/home/page.tsx', 0],
  ['the bare word, as prose', 'tooling state lives under /home, not here', 0],
  ['a documented placeholder', 'no absolute path such as /home/<user>/ belongs in the tree', 0],
  ['a longer word starting with root', 'the /rootstock chain is not a home', 0],
  ['a URL path that happens to say home', 'https://example.com/home/page', 0],
];

// Rule 1's own cases, kept beside rule 2's for the same reason.
const SELF_TEST_PATHS = [
  ['a run record under projects/', 'projects/noesis/gate-runs/2026-09-19-x.json', true],
  ['the directory itself', 'projects/anything', true],
  ['a source file that merely starts with the letters', 'projectsummary.md', false],
  ['ordinary source', 'app/src/lib/merkle.ts', false],
];

// Exits 0 when every rule still means what its comment says it means.
function selfTest() {
  const failures = [];
  for (const [name, text, want] of SELF_TEST) {
    const got = findHomePaths(text).length;
    if (got !== want) failures.push(`rule 2, ${name}: expected ${want} finding(s), got ${got} — ${text}`);
  }
  for (const [name, file, want] of SELF_TEST_PATHS) {
    const got = findUntrackedPrefix(file) !== null;
    if (got !== want) failures.push(`rule 1, ${name}: expected ${want ? 'a finding' : 'no finding'}, got the other — ${file}`);
  }
  for (const f of failures) console.error(f);
  if (failures.length) {
    console.error(`\n${failures.length} of ${SELF_TEST.length + SELF_TEST_PATHS.length} case(s) failed: `
      + 'this guard no longer catches what it says it catches. A green tree scan below would mean nothing.');
    return 1;
  }
  console.log(`${SELF_TEST.length + SELF_TEST_PATHS.length} case(s) pass: both rules match what their comments claim.`);
  return 0;
}

// Only run the CLI when this file is invoked directly, so importing the check does not run it.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());

  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const findings = findLocalPaths(root, trackedFiles(root));
  for (const f of findings) console.error(`${f.file}${f.line === null ? '' : `:${f.line}`}: ${f.why}`);
  if (findings.length) {
    console.error(`\n${findings.length} finding(s): a tracked file describes the machine it was written on. `
      + 'This repository is public, and a push publishes it permanently.');
    process.exit(1);
  }
}
