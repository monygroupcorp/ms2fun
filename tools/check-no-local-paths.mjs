#!/usr/bin/env node
// Publication guard: a tracked file must not describe the machine it was written on.
// Read-only, no network, no key, no model.
//
//   node tools/check-no-local-paths.mjs    # exit 1 on any finding, with file and line
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
//      (/home/<user>/, /Users/<user>/, /root/). Such a path names both a private filesystem layout
//      and, in the segment after /home or /Users, an account. A path relative to the repository is
//      the portable form and the only one that means anything to someone who cloned it.
//
// Binary files are skipped (detected by a NUL byte), as is this file, which necessarily quotes the
// patterns it forbids. This checks what a file SAYS about its machine; it is not a secret scanner,
// which is a different problem with different tools.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Paths under these prefixes are local tooling state and are never tracked here.
const UNTRACKED_PREFIXES = ['projects/'];

// An absolute path rooted in a user's home. Two things narrow it, and both earn their keep.
// The trailing separator makes this a path INTO a home rather than a bare mention of the word, so
// prose that says "under /home" is not a finding while /home/someone/checkout is. The lookbehind
// requires the leading slash to BEGIN a path rather than continue one, which is what keeps /root/
// from firing on every relative path with a segment named root — leaf/root/proof, all through the
// merkle modules, is the one that found this out.
const HOME_PATH = /(?<![A-Za-z0-9._-])(?:(?:\/home\/|\/Users\/)[A-Za-z0-9._-]+|\/root)\//g;

// This file quotes the patterns above, so it cannot be held to rule 2.
const SELF = 'tools/check-no-local-paths.mjs';

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
    const prefix = UNTRACKED_PREFIXES.find((p) => file.startsWith(p));
    if (prefix) {
      findings.push({ file, line: null, why: `tracked under ${prefix} — local tooling state, which this repository does not publish` });
      continue;
    }
    if (file === SELF) continue;

    let buf;
    try { buf = readFileSync(resolve(root, file)); }
    catch { continue; }
    if (buf.includes(0)) continue;

    const lines = buf.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
      for (const m of lines[i].matchAll(HOME_PATH)) {
        findings.push({ file, line: i + 1, why: `absolute path into a user home: ${m[0]} — use a path relative to the repository` });
      }
    }
  }
  return findings;
}

// Only run the CLI when this file is invoked directly, so importing the check does not run it.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  const findings = findLocalPaths(root, trackedFiles(root));
  for (const f of findings) console.error(`${f.file}${f.line === null ? '' : `:${f.line}`}: ${f.why}`);
  if (findings.length) {
    console.error(`\n${findings.length} finding(s): a tracked file describes the machine it was written on. `
      + 'This repository is public, and a push publishes it permanently.');
    process.exit(1);
  }
}
