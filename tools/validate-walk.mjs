#!/usr/bin/env node
// Gate the testnet walk against the app it describes. Read-only, no network, no model.
//
//   node tools/validate-walk.mjs                     # the gate. exit 1 = findings
//   node tools/validate-walk.mjs --print             # render the whole walk
//   node tools/validate-walk.mjs --invite <role> --at <url>   # the packet one tester is handed
//   node tools/validate-walk.mjs --report <step id>  # the form a finding comes back on
//   node tools/validate-walk.mjs --selftest          # the renderers, against a fixture deploy
//
// A walkthrough written by hand rots the week after it is written: a panel gains a button, a route
// moves, a function is renamed, and the document goes on describing the app of the day it was
// typed. Two testers then walk two different things and neither of them walks the app. So the walk
// is not a document. It is data/walk/manifest.json — route, role and instructions per step — checked
// on every run against the write surface derived from the source, and rendered from that same file.
//
// What this gate covers:
//   completeness  every contract write the app can send is in a step, or listed under outOfWalk
//                 with a reason. A new button appearing in a panel turns this red until somebody
//                 decides whether a tester walks it.
//   existence     every call a step names is a real non-view function of a real ABI, reachable from
//                 app source. A renamed function turns this red.
//   reachability  the route a step sends a tester to actually imports the code that sends the call.
//                 A panel moved to a different page turns this red.
//   honesty       every site the scan could not resolve is acknowledged in blindSpots, so the walk
//                 states its own coverage rather than implying it is total.
//   invitability  every role owns steps and says what to bring, and the walk names where a finding
//                 goes and what it has to carry. A role nobody can be invited as, or a walk that
//                 collects nothing, turns this red.
//
// The three renderers read the same file the gate just checked, so the invite a tester is handed and
// the form their defect comes back on cannot describe a walk the app no longer has. --invite refuses
// on a chain whose deployment file still holds the zero placeholder: an invite to a dead link spends
// a tester nobody gets to invite twice.
//
// That refusal has a cost the gate cannot see: every deployment file in the tree holds the zero
// registry, so --invite refuses on every chain this build carries and the renderer behind it has
// never once run. --selftest is the answer to that. It renders every role's invite and every step's
// report against a fixture chain, asserts what a tester has to find in them, and asserts the
// refusal still fires on the real files — so the first invite anybody prints is not the first time
// the code has executed. It prints counts and failures, never a packet: an invite naming a fixture
// registry is the same dead link the refusal exists to prevent.
//
// What this does NOT cover, and no static check can: whether a step's instructions are followable,
// whether its `expect` is the right acceptance bar, or whether anybody walked it. That is what the
// testers are for. This gate only guarantees they are all sent to the same place.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sourceFiles, writeSurface } from './lib/walk-surface.mjs';

const MANIFEST = 'data/walk/manifest.json';
const APP = 'app/src/App.tsx';
const root = '.';
const findings = [];
const fail = (msg) => { findings.push(msg); console.log(`FAIL ${msg}`); };

/* ---- routes, and what each one can reach --------------------------------------------------- */

function resolveImport(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = join(dirname(from), spec);
  for (const c of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    if (existsSync(c)) return c;
  }
  return null;
}

function importsOf(file) {
  const out = new Set();
  for (const m of readFileSync(file, 'utf8').matchAll(/from '([^']+)'|import\('([^']+)'\)/g)) {
    const resolved = resolveImport(file, m[1] ?? m[2]);
    if (resolved) out.add(resolved);
  }
  return out;
}

/** Every module reachable from `start` by import, minus anything in `stop`. */
function reachable(start, stop = new Set()) {
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const file = queue.pop();
    if (!file || seen.has(file) || stop.has(file)) continue;
    seen.add(file);
    for (const next of importsOf(file)) queue.push(next);
  }
  return seen;
}

/** route path -> the module wouter mounts on it, static import or lazy chunk alike. */
function routeModules() {
  const app = readFileSync(APP, 'utf8');
  const routes = new Map();
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s*\n?\s*component=\{(\w+)\}/g)) {
    const name = m[2];
    const from =
      app.match(new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '([^']+)'`)) ??
      app.match(new RegExp(`const ${name} = lazy\\(\\(\\) =>\\s*\\n?\\s*import\\('([^']+)'`));
    routes.set(m[1], from ? resolveImport(APP, from[1]) : null);
  }
  return routes;
}

/* ---- the checks ---------------------------------------------------------------------------- */

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const surface = writeSurface(root);
const routes = routeModules();
const routeReach = new Map();
for (const [path, module] of routes) if (module) routeReach.set(path, reachable(module));
// App-wide chrome — the header, the cart bar, anything mounted outside the Switch. A step routed
// at "*" is walked from wherever the tester happens to be, so it is checked against this instead.
const chrome = reachable(APP, new Set([...routes.values()].filter(Boolean)));

const steps = manifest.acts.flatMap((act) => act.steps.map((s) => ({ ...s, act })));
const covered = new Map();

for (const step of steps) {
  if (!manifest.roles[step.act.role]) fail(`${step.id}: act ${step.act.id} names role '${step.act.role}', which manifest.roles does not define`);
  for (const field of ['title', 'route', 'given', 'do', 'expect']) {
    if (!step[field]) fail(`${step.id}: no ${field}`);
  }
  if (typeof step.blocking !== 'boolean') fail(`${step.id}: blocking must be true or false — the acceptance bar is the point of the step`);

  const reach = step.route === '*' ? chrome : routeReach.get(step.route);
  if (!reach) fail(`${step.id}: route ${step.route} is not a route in ${APP}`);

  for (const call of step.calls ?? []) {
    const write = surface.writes.get(call);
    if (!write) {
      fail(`${step.id}: ${call} is not a contract write the app can send — renamed, removed, or a read`);
      continue;
    }
    covered.set(call, (covered.get(call) ?? 0) + 1);
    if (reach && !write.sites.some((site) => reach.has(site.split(':')[0]))) {
      fail(`${step.id}: ${call} is sent from ${write.sites.join(', ')}, which ${step.route} does not reach`);
    }
  }
  if (!step.calls?.length) fail(`${step.id}: no calls — a step that sends nothing is a paragraph, not a walk step`);
}

// Steps lean on each other for their preconditions ("given: the free allocation set in C-8"), and a
// reference to a step that does not exist sends a tester looking for a page nobody wrote.
const ids = new Set(steps.map((s) => s.id));
for (const step of steps) {
  const text = [step.given, step.do, step.expect, step.title].join(' ');
  for (const m of text.matchAll(/\b([OCBH]-\d+)\b/g)) {
    if (!ids.has(m[1])) fail(`${step.id}: names ${m[1]}, which is not a step`);
  }
}
for (const act of manifest.acts) {
  for (const m of (act.note ?? '').matchAll(/\b([OCBH]-\d+)\b/g)) {
    if (!ids.has(m[1])) fail(`act ${act.id} note: names ${m[1]}, which is not a step`);
  }
}
for (const [role, what] of Object.entries(manifest.roles)) {
  for (const m of what.matchAll(/\b([OCBH]-\d+)\b/g)) {
    if (!ids.has(m[1])) fail(`role ${role}: names ${m[1]}, which is not a step`);
  }
}

// An invite is rendered per role, so a role has to be something a person can actually be sent as:
// it needs steps of its own, and it needs a list of what to turn up with. Without the second the
// invite is "walk act B" and the tester discovers at step 3 that they needed a live collection.
for (const act of manifest.acts) {
  if (!act.steps?.length) fail(`act ${act.id} has no steps`);
}
const actRoles = new Set(manifest.acts.filter((act) => act.steps?.length).map((act) => act.role));
for (const role of Object.keys(manifest.roles)) {
  if (!actRoles.has(role)) fail(`role ${role} owns no act — an invite for it would print an empty walk`);
  if (!manifest.prerequisites?.[role]?.length) fail(`role ${role}: no prerequisites — an invite cannot say what to bring`);
}
for (const role of Object.keys(manifest.prerequisites ?? {})) {
  if (!manifest.roles[role]) fail(`prerequisites names role '${role}', which manifest.roles does not define`);
}

// The return path. A walk that collects nothing is a rehearsal, so the destination and the fields a
// finding must carry are part of the manifest and are checked like anything else in it.
if (!manifest.report?.destination?.trim()) fail('report.destination is empty — a walk with no return path collects nothing');
if (!manifest.report?.include?.length) fail('report.include is empty — a finding with no required fields is a paragraph, not a row');

const excused = new Map();
for (const entry of manifest.outOfWalk ?? []) {
  if (!surface.writes.has(entry.call)) fail(`outOfWalk names ${entry.call}, which the app does not send — delete the line`);
  if (!entry.why?.trim()) fail(`outOfWalk ${entry.call}: no reason given`);
  if (covered.has(entry.call)) fail(`${entry.call} is both walked and excused — decide which`);
  excused.set(entry.call, entry.why);
}

for (const key of surface.writes.keys()) {
  if (!covered.has(key) && !excused.has(key)) {
    const sites = surface.writes.get(key).sites.join(', ');
    fail(`${key} is a write a person can send from ${sites}, and no step walks it and no line excuses it`);
  }
}

const acknowledged = new Set((manifest.blindSpots ?? []).map((b) => b.site));
for (const site of [...surface.unknown, ...surface.unresolved]) {
  const id = `${site.file}:${site.line}`;
  if (!acknowledged.has(id)) {
    fail(`${id} names '${site.fn}' against an abi the scan cannot resolve — the walk's coverage claim is not true until this is in blindSpots with a reason`);
  }
}
for (const spot of manifest.blindSpots ?? []) {
  const live = [...surface.unknown, ...surface.unresolved].some((s) => `${s.file}:${s.line}` === spot.site);
  if (!live) fail(`blindSpots names ${spot.site}, which the scan now resolves — delete the line`);
}

/* ---- the chain an invite names --------------------------------------------------------------- */

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const SEPOLIA = 11155111;
const CHAIN_NAMES = { 1: 'Ethereum mainnet', 1337: 'the local anvil fork', [SEPOLIA]: 'Sepolia' };

// Mirrors app/src/lib/addresses.ts: one deployment file per chain, keyed by the chain id the file
// itself declares, and a chain counts as deployed when its MasterRegistryV1 is not the zero address
// — every read path in the app starts at that registry, so a zero there is a dead app whatever else
// the file carries. local-deployment.sepolia.json is the dev channel's substitution at the same
// chain id and is left out here for the reason an ordinary build leaves it out: it is not the
// network a remote tester can reach.
function deployments() {
  const byChain = new Map();
  for (const file of ['app/src/config/local-deployment.json', 'app/src/config/sepolia-deployment.json']) {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    const registry = d.contracts?.MasterRegistryV1 ?? ZERO_ADDRESS;
    byChain.set(d.chainId, { ...d, file, registry, live: registry !== ZERO_ADDRESS });
  }
  return byChain;
}

function chainLine(chain) {
  const name = CHAIN_NAMES[chain.chainId] ?? `chain ${chain.chainId}`;
  return `${name} (${chain.chainId}) · MasterRegistryV1 ${chain.registry} · from block ${chain.deployBlock ?? 0}`;
}

// Where a tester actually opens the app. It is not derivable here and must never be guessed: this
// build ships two distributions and they are not reached the same way (app/vite.config.ts, and the
// Router branch at app/src/App.tsx). The server-backed target history-routes, so a step at
// /:chainId/:slug lives at https://<host>/11155111/<slug>. The pinned target hash-routes — a public
// gateway has no SPA fallback and answers a deep path with its own 404 — so the same step lives at
// https://<host>/#/11155111/<slug>. Half the walk is deep links, so the wrong shape is 22 steps of
// a tester meeting a gateway 404 and reporting the walk broken. Whoever served the build knows
// which they served; --at makes them say it once, and every link in the packet comes off it.
function parseAt(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: `--at ${raw} is not a URL` };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: `--at ${raw} is not an http(s) address, and a tester opens it in a browser` };
  }
  return { at: raw.endsWith('/') ? raw : `${raw}/` };
}

// The route as a thing a person can click, with the chain id the invite is for filled in and every
// remaining parameter left as an angle-bracketed blank — `<slug>` reads as something to supply,
// where `:slug` reads as a URL somebody forgot to finish.
function stepWhere(step, chainId, at) {
  if (step.route === '*') return 'anywhere in the app';
  const path = step.route.replace(':chainId', String(chainId)).replace(/:(\w+)/g, '<$1>');
  return at ? `${at}${path.replace(/^\//, '')}` : path;
}

// The origin the app names as its own, so the refusal below can show a real example rather than a
// hostname somebody has to remember. Gated already: app/scripts/check-share-card.ts requires og:url
// to be present and to share one origin with the image tags.
function canonicalOrigin() {
  const m = readFileSync('app/index.html', 'utf8').match(/<meta property="og:url" content="([^"]+)"/);
  if (!m) return null;
  try {
    return new URL(m[1]).origin;
  } catch {
    return null;
  }
}

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

/* ---- render -------------------------------------------------------------------------------- */

// The renderers return their lines rather than printing them, so --selftest can run every one of
// them against a fixture chain and read what came out. Before that they printed straight to stdout
// and the only way to see an invite was to have a deployment, which no build has yet had: the whole
// invite path had never once executed, and its first run would have been in front of a tester.

const stepLines = (step, chainId, at) => [
  `  - where: ${stepWhere(step, chainId, at)}`,
  `  - given: ${step.given}`,
  `  - do: ${step.do}`,
  `  - expect: ${step.expect}`,
];

// The packet one named tester is handed: the role they walk, what to bring, the steps that are
// theirs, the steps somebody else has to have walked first, and where a finding goes. It is derived
// from the same manifest the gate just checked, so an invite cannot describe a walk the app no
// longer has — and its caller refuses outright on a chain whose protocol is not deployed, because an
// invite to a placeholder address is the dead link that wastes a tester's one first impression.
function renderInvite(role, chain, at) {
  const out = [];
  const say = (line = '') => out.push(line);

  const mine = manifest.acts.filter((act) => act.role === role);
  const myIds = new Set(mine.flatMap((act) => act.steps.map((s) => s.id)));
  const myStepCount = mine.reduce((n, act) => n + act.steps.length, 0);
  const myBlocking = mine.reduce((n, act) => n + act.steps.filter((s) => s.blocking).length, 0);
  // Steps lean on each other across acts ("given: the free allocation set in C-8"). Anything a step
  // of this role names that belongs to another role is somebody else's turn, and saying so up front
  // is the difference between a tester waiting and a tester filing a defect against the wait.
  const upstream = new Set();
  const prose = [
    manifest.roles[role],
    ...mine.map((act) => act.note ?? ''),
    ...mine.flatMap((act) => act.steps.flatMap((s) => [s.title, s.given, s.do, s.expect])),
  ].join(' ');
  for (const m of prose.matchAll(/\b([OCBH]-\d+)\b/g)) {
    if (!myIds.has(m[1])) upstream.add(m[1]);
  }

  say(`\n# ${manifest.title} — you are walking as the ${role}\n`);
  say(`${manifest.purpose}\n`);
  say(`## The chain\n\n${chainLine(chain)}\n`);
  say(`## Where to open it\n\n${at}\n`);
  say('Every link below is on that address. If one of them answers with a page that is not the app,\n'
    + 'that is a finding too — report it against the step whose link it was.\n');
  say(`## Who you are\n\n${manifest.roles[role]}\n`);
  say('## What to bring\n');
  for (const need of manifest.prerequisites[role]) say(`- ${need}`);
  if (upstream.size) {
    say('\n## What somebody else walks\n');
    say('Your steps refer to these and none of them is yours. Where one is a precondition rather than a');
    say('cross-reference, the step that needs it says so in its own `given`.\n');
    // In walk order, not alphabetical — C-15 before C-2 reads as a typo, and the order a tester is
    // told to wait for things in is the order somebody has to walk them in.
    for (const step of steps.filter((s) => upstream.has(s.id))) {
      say(`- ${step.id} (${step.act.role}) — ${step.title}`);
    }
  }
  say(`\n## Your steps — ${myStepCount}, of which ${myBlocking} ${myBlocking === 1 ? 'is' : 'are'} blocking\n`);
  for (const act of mine) {
    say(`### Act ${act.id} — ${act.title}\n`);
    if (act.note) say(`${act.note}\n`);
    for (const step of act.steps) {
      say(`- **${step.id}. ${step.title}**${step.blocking ? '   [blocking]' : ''}`);
      for (const line of stepLines(step, chain.chainId, at)) say(line);
    }
    say('');
  }
  say(`## When something is wrong\n\n${manifest.blockingRule}\n`);
  say(`${manifest.report.destination}\n`);
  if (manifest.report.secondary) say(`${manifest.report.secondary}\n`);
  say('Send one report per step, and include:\n');
  for (const field of manifest.report.include) say(`- ${field}`);
  // A tester has a wallet and a browser, not this repo. The invite used to end by telling them to
  // run a node command against a checkout they do not have, which is a return path that returns
  // nothing. Everything --report would have filled in for them is already above, in their own step,
  // so the invite says which lines to copy and which three to add instead.
  say('\nYou do not need any of our tooling to send one. That list is the whole form, and the invite has');
  say('already filled most of it in: copy your step\'s own block from above — the id and title, and its');
  say('where / given / do / expect lines — and the chain line at the top of this page, then add these:\n');
  say('- what I did:');
  say('- what happened instead:');
  say('- transaction hash, or the wallet error if it never sent:\n');
  say('If your step is marked [blocking], say so at the top of the report. That word is ours, not a');
  say('judgement you have to make: it means the failure has to be fixed before launch, and it is the');
  say('one field we would rather you never had to decide.\n');
  return out;
}

// One finding, in the shape a row is filed in. The step id, its route, the calls it sends, its own
// acceptance bar and — the part a tester should never have to decide — whether it blocks a launch,
// all filled in from the manifest, leaving only what the tester saw. A defect reported this way is
// already a row; one reported as a paragraph has to be turned into one by somebody who was not there.
function renderReport(step, chainId, chain, at) {
  const out = [];
  const say = (line = '') => out.push(line);
  say(`\n## ${step.id} — ${step.title}${step.blocking ? '   [blocking]' : ''}\n`);
  // A form naming a zero registry describes a dead app as surely as an invite does. --invite refuses
  // outright; this one still renders, because whoever files the row from the repo has a use for it
  // after a chain is gone — but it says which it is rather than printing the placeholder unremarked.
  say(
    `- chain: ${
      !chain
        ? `${chainId} — not a chain this build carries a deployment for`
        : chain.live
          ? chainLine(chain)
          : `${chainLine(chain)} — the zero placeholder: nothing is deployed there, so this form is not one to hand out`
    }`,
  );
  say(`- walked as: ${step.act.role}`);
  say(`- where: ${stepWhere(step, chainId, at)}`);
  say(`- sends: ${step.calls.join(', ')}`);
  say(`- the walk says to expect: ${step.expect}`);
  say('- what I did:');
  say('- what happened instead:');
  say('- transaction hash, or the wallet error if it never sent:');
  say(
    `\n${
      step.blocking
        ? 'This step is blocking: if it failed, the row it opens has to be closed before launch.'
        : 'This step is not blocking: the row it opens has to exist, and may still be open at launch.'
    }\n`,
  );
  return out;
}

function renderPrint() {
  const out = [];
  const say = (line = '') => out.push(line);
  const blockingCount = steps.filter((s) => s.blocking).length;
  say(`\n# ${manifest.title}\n`);
  say(`${manifest.purpose}\n`);
  say('## Who you are\n');
  for (const [role, what] of Object.entries(manifest.roles)) say(`- **${role}** — ${what}`);
  say(`\n## What "blocking" means\n\n${manifest.blockingRule}\n`);
  for (const act of manifest.acts) {
    say(`\n## Act ${act.id} — ${act.title}   ·   ${act.role}\n`);
    if (act.note) say(`${act.note}\n`);
    for (const step of act.steps) {
      say(`### ${step.id}. ${step.title}${step.blocking ? '   [blocking]' : ''}`);
      say(`- where: ${step.route === '*' ? 'anywhere in the app' : step.route}`);
      say(`- given: ${step.given}`);
      say(`- do: ${step.do}`);
      say(`- expect: ${step.expect}`);
      say(`- sends: ${step.calls.join(', ')}\n`);
    }
  }
  say('\n## Not walked, and why\n');
  for (const entry of manifest.outOfWalk ?? []) say(`- \`${entry.call}\` — ${entry.why}`);
  say('\n## What this walk does not see\n');
  for (const spot of manifest.blindSpots ?? []) say(`- \`${spot.site}\` — ${spot.why}`);
  say('\n## When something is wrong\n');
  say(`${manifest.report.destination}\n`);
  if (manifest.report.secondary) say(`${manifest.report.secondary}\n`);
  say('Send one report per step, and include:\n');
  for (const field of manifest.report.include) say(`- ${field}`);
  say(
    `\n\`node tools/validate-walk.mjs --report <step id>\` prints that list already filled in for one step.` +
      ` ${blockingCount} of ${steps.length} steps are blocking.\n`,
  );
  return out;
}

/* ---- selftest ------------------------------------------------------------------------------- */

// The gate proves the walk still describes the app. This proves the walk can still be HANDED to
// somebody — a different claim, and the one that had no evidence behind it: every deployment file
// in the tree holds the zero registry, so --invite refuses on every chain the build carries and the
// renderer had never run. A fixture chain stands in for the deploy that has not happened yet, and
// nothing it produces is printed: an invite naming a fixture registry is exactly the dead link the
// refusal exists to prevent, so this reports counts and failures and never the packet itself.
if (process.argv.includes('--selftest')) {
  const claims = [];
  const check = (ok, what) => {
    claims.push({ ok, what });
    if (!ok) console.log(`FAIL ${what}`);
  };

  // A selftest that says the packet renders while the gate says the walk no longer describes the app
  // is reporting on a packet nobody should send. The gate's own findings are one of these claims.
  check(findings.length === 0, 'the walk still describes the app — the gate above found nothing');

  const fixtureAt = 'https://walk.invalid/#/';

  const fixture = {
    chainId: SEPOLIA,
    file: '(fixture — no deployment file)',
    registry: '0x1111111111111111111111111111111111111111',
    deployBlock: 9_000_000,
    live: true,
  };

  for (const role of Object.keys(manifest.roles)) {
    let lines;
    try {
      lines = renderInvite(role, fixture, fixtureAt);
    } catch (err) {
      check(false, `--invite ${role} threw: ${err.message}`);
      continue;
    }
    const text = lines.join('\n');
    check(text.includes(chainLine(fixture)), `--invite ${role} names the chain it is walking`);
    check(text.includes('## What to bring'), `--invite ${role} says what to bring`);
    check(text.includes(fixtureAt), `--invite ${role} says where to open the app`);
    check(/## Your steps — [1-9]/.test(text), `--invite ${role} carries at least one step`);
    // The three lines that turn a walked failure into a row. They used to be reachable only by
    // running this tool, which a tester cannot do.
    for (const field of ['- what I did:', '- what happened instead:', '- transaction hash']) {
      check(text.includes(field), `--invite ${role} carries the report field '${field.trim()}'`);
    }
    check(!/\bnode tools\//.test(text), `--invite ${role} asks the tester to run nothing`);
    // A missing manifest field renders as the string "undefined" and reads as prose to a tester.
    check(!/\b(undefined|null|NaN)\b/.test(text), `--invite ${role} interpolates no missing field`);
    const owned = manifest.acts.filter((a) => a.role === role).flatMap((a) => a.steps);
    for (const step of owned) {
      check(text.includes(`**${step.id}.`), `--invite ${role} carries its own step ${step.id}`);
      // A route pattern is not a place. Every step a tester is sent to has to be somewhere they can
      // open, with the chain id filled in and nothing left that reads as an unfinished URL.
      const where = stepWhere(step, fixture.chainId, fixtureAt);
      check(
        step.route === '*' || where.startsWith(fixtureAt),
        `--invite ${role}: step ${step.id} points at the address the invite named`,
      );
      check(!/\/:/.test(where), `--invite ${role}: step ${step.id} leaves no ':param' in the link`);
      // The chain id is the one parameter the invite knows the answer to, so it is the one that has
      // to be filled and not merely turned into a blank for the tester to work out.
      if (step.route.includes(':chainId')) {
        check(
          where.includes(`/${fixture.chainId}/`) && !where.includes('<chainId>'),
          `--invite ${role}: step ${step.id} carries the chain id, not a blank for it`,
        );
      }
      check(text.includes(`- where: ${where}`), `--invite ${role}: step ${step.id} shows that link`);
    }
    // Every id in the "somebody else walks" section is a real step of another role. The section is
    // built by a regex over prose, so a typo'd id would send a tester waiting on nothing.
    const section = text.split('## What somebody else walks')[1]?.split('## Your steps')[0] ?? '';
    for (const m of section.matchAll(/^- ([OCBH]-\d+) \((\w+)\)/gm)) {
      const other = steps.find((s) => s.id === m[1]);
      check(!!other && other.act.role !== role, `--invite ${role} defers ${m[1]} to a real step of another role`);
    }
  }

  for (const step of steps) {
    let lines;
    try {
      lines = renderReport(step, SEPOLIA, fixture, fixtureAt);
    } catch (err) {
      check(false, `--report ${step.id} threw: ${err.message}`);
      continue;
    }
    const text = lines.join('\n');
    check(text.includes(step.id), `--report ${step.id} names its step`);
    for (const call of step.calls) check(text.includes(call), `--report ${step.id} names the call ${call}`);
    check(text.includes(step.expect), `--report ${step.id} carries the walk's own acceptance bar`);
    // The one field a tester should never have to decide has to actually be decided for them.
    check(
      text.includes(step.blocking ? 'This step is blocking' : 'This step is not blocking'),
      `--report ${step.id} states whether it blocks a launch`,
    );
    check(!/\b(undefined|null|NaN)\b/.test(text), `--report ${step.id} interpolates no missing field`);
  }

  // The refusal is half the mechanism: an invite is worth having only if it cannot name a dead
  // chain. Assert it against the tree as it stands rather than trusting the code path above.
  const dead = [...deployments().values()].filter((c) => !c.live);
  check(dead.length > 0, 'a chain with the zero placeholder exists to test the refusal against');
  for (const chain of dead) {
    const r = spawnSync(process.execPath, [process.argv[1], '--invite', Object.keys(manifest.roles)[0], '--chain', String(chain.chainId)], {
      encoding: 'utf8',
    });
    check(r.status === 1, `--invite refuses on chain ${chain.chainId}, whose registry is the zero placeholder`);
    check(/No invite printed/.test(r.stdout), `--invite says why it refused chain ${chain.chainId}`);
  }

  // The other half of the address rule: an invite with no --at prints nothing at all, and one with
  // an address a browser cannot open is refused rather than rendered into a packet.
  const someRole = Object.keys(manifest.roles)[0];
  for (const [args, what] of [
    [['--invite', someRole], 'an invite with no --at is refused'],
    [['--invite', someRole, '--at', 'not-a-url'], 'an invite whose --at is not a URL is refused'],
    [['--invite', someRole, '--at', 'ftp://walk.invalid/'], 'an invite whose --at is not http(s) is refused'],
  ]) {
    const r = spawnSync(process.execPath, [process.argv[1], ...args], { encoding: 'utf8' });
    check(r.status === 1, what);
    // Naming --at, not just refusing: every chain this build carries holds the zero registry, so a
    // refusal that only says "No invite printed" is one this claim would pass on for the wrong
    // reason. That is exactly what it did until the --at check was lifted above the chain lookup.
    check(/No invite printed:[^]*--at/.test(r.stdout), `${what}, and says --at is why`);
  }

  const failed = claims.filter((c) => !c.ok).length;
  console.log(
    `\n${claims.length} claims about what a tester is handed · ${Object.keys(manifest.roles).length} invites rendered · ` +
      `${steps.length} report forms rendered · ${failed} failed`,
  );
  process.exit(failed ? 1 : 0);
}

/* ---- the three renderers, as commands -------------------------------------------------------- */

const inviteRole = flag('--invite');
if (inviteRole !== undefined) {
  if (findings.length) {
    console.log('\nNo invite printed: the findings above mean this walk no longer describes the app.');
    process.exit(1);
  }
  if (!manifest.roles[inviteRole]) {
    console.log(`\nNo invite printed: '${inviteRole}' is not a role. Roles: ${Object.keys(manifest.roles).join(', ')}`);
    process.exit(1);
  }
  const rawAt = flag('--at');
  if (rawAt === undefined) {
    const origin = canonicalOrigin();
    console.log(
      '\nNo invite printed: --at is missing, and it is the address the tester opens. It is not guessed' +
        '\nhere, because this build ships two distributions that are not reached the same way — the' +
        '\nserver-backed target history-routes and the pinned one hash-routes, since a public gateway' +
        '\nhas no SPA fallback (app/vite.config.ts, and the Router branch in app/src/App.tsx). Half this' +
        '\nwalk is deep links, so the wrong shape is twenty-two steps of gateway 404 reported back as a' +
        '\nbroken walk. Pass the one you actually served:' +
        '\n\n  --at https://<host>/            for the server-backed build' +
        `\n  --at ${origin ?? 'https://<host>'}/#/   for the pinned build\n`,
    );
    process.exit(1);
  }
  const parsedAt = parseAt(rawAt);
  if (parsedAt.error) {
    console.log(`\nNo invite printed: ${parsedAt.error}.`);
    process.exit(1);
  }
  const chainId = Number.parseInt(flag('--chain') ?? String(SEPOLIA), 10);
  const chain = deployments().get(chainId);
  if (!chain) {
    console.log(`\nNo invite printed: this build carries no deployment for chain ${chainId}. Known: ${[...deployments().keys()].join(', ')}`);
    process.exit(1);
  }
  if (!chain.live) {
    console.log(
      `\nNo invite printed: ${chain.file} still holds the zero placeholder, so nothing is deployed on ` +
        `${CHAIN_NAMES[chainId] ?? `chain ${chainId}`} yet. Deploy first; an invite to a dead link spends a tester ` +
        `you only get to invite once.`,
    );
    process.exit(1);
  }
  for (const line of renderInvite(inviteRole, chain, parsedAt.at)) console.log(line);
  process.exit(0);
}

const reportStep = flag('--report');
if (reportStep !== undefined) {
  const step = steps.find((s) => s.id === reportStep);
  if (!step) {
    console.log(`\n'${reportStep}' is not a step — --print lists every one of them.`);
    process.exit(1);
  }
  const chainId = Number.parseInt(flag('--chain') ?? String(SEPOLIA), 10);
  // Optional here, unlike on an invite: a row filed from the repo after the fact is still worth
  // rendering when nobody remembers which address the run was on. Without it the route stays a
  // pattern, which is honest — a link nobody can open is worse than a route somebody can resolve.
  const rawAt = flag('--at');
  const parsedAt = rawAt === undefined ? {} : parseAt(rawAt);
  if (parsedAt.error) {
    console.log(`\nNo report printed: ${parsedAt.error}.`);
    process.exit(1);
  }
  for (const line of renderReport(step, chainId, deployments().get(chainId), parsedAt.at)) console.log(line);
  process.exit(0);
}

if (process.argv.includes('--print')) {
  for (const line of renderPrint()) console.log(line);
}

/* ---- report -------------------------------------------------------------------------------- */

const walked = [...covered.keys()].length;
console.log(
  `\n${steps.length} steps across ${manifest.acts.length} acts · ` +
    `${walked} of ${surface.writes.size} contract writes walked · ${excused.size} excused · ` +
    `${steps.filter((s) => s.blocking).length} blocking · ${findings.length} findings`,
);
process.exit(findings.length ? 1 : 0);
