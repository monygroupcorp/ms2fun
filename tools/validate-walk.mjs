#!/usr/bin/env node
// Gate the testnet walk against the app it describes. Read-only, no network, no model.
//
//   node tools/validate-walk.mjs                     # the gate. exit 1 = findings
//   node tools/validate-walk.mjs --print             # render the whole walk
//   node tools/validate-walk.mjs --invite <role>     # the packet one tester is handed
//   node tools/validate-walk.mjs --report <step id>  # the form a finding comes back on
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
// What this does NOT cover, and no static check can: whether a step's instructions are followable,
// whether its `expect` is the right acceptance bar, or whether anybody walked it. That is what the
// testers are for. This gate only guarantees they are all sent to the same place.

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

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

/* ---- render -------------------------------------------------------------------------------- */

// The packet one named tester is handed: the role they walk, what to bring, the steps that are
// theirs, the steps somebody else has to have walked first, and where a finding goes. It is derived
// from the same manifest the gate just checked, so an invite cannot describe a walk the app no
// longer has — and it refuses outright on a chain whose protocol is not deployed, because an invite
// to a placeholder address is the dead link that wastes a tester's one first impression.
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

  const mine = manifest.acts.filter((act) => act.role === inviteRole);
  const myIds = new Set(mine.flatMap((act) => act.steps.map((s) => s.id)));
  const myStepCount = mine.reduce((n, act) => n + act.steps.length, 0);
  const myBlocking = mine.reduce((n, act) => n + act.steps.filter((s) => s.blocking).length, 0);
  // Steps lean on each other across acts ("given: the free allocation set in C-8"). Anything a step
  // of this role names that belongs to another role is somebody else's turn, and saying so up front
  // is the difference between a tester waiting and a tester filing a defect against the wait.
  const upstream = new Set();
  const prose = [
    manifest.roles[inviteRole],
    ...mine.map((act) => act.note ?? ''),
    ...mine.flatMap((act) => act.steps.flatMap((s) => [s.title, s.given, s.do, s.expect])),
  ].join(' ');
  for (const m of prose.matchAll(/\b([OCBH]-\d+)\b/g)) {
    if (!myIds.has(m[1])) upstream.add(m[1]);
  }

  console.log(`\n# ${manifest.title} — you are walking as the ${inviteRole}\n`);
  console.log(`${manifest.purpose}\n`);
  console.log(`## The chain\n\n${chainLine(chain)}\n`);
  console.log(`## Who you are\n\n${manifest.roles[inviteRole]}\n`);
  console.log('## What to bring\n');
  for (const need of manifest.prerequisites[inviteRole]) console.log(`- ${need}`);
  if (upstream.size) {
    console.log('\n## What somebody else walks\n');
    console.log('Your steps refer to these and none of them is yours. Where one is a precondition rather than a');
    console.log('cross-reference, the step that needs it says so in its own `given`.\n');
    // In walk order, not alphabetical — C-15 before C-2 reads as a typo, and the order a tester is
    // told to wait for things in is the order somebody has to walk them in.
    for (const step of steps.filter((s) => upstream.has(s.id))) {
      console.log(`- ${step.id} (${step.act.role}) — ${step.title}`);
    }
  }
  console.log(`\n## Your steps — ${myStepCount}, of which ${myBlocking} ${myBlocking === 1 ? 'is' : 'are'} blocking\n`);
  for (const act of mine) {
    console.log(`### Act ${act.id} — ${act.title}\n`);
    if (act.note) console.log(`${act.note}\n`);
    for (const step of act.steps) {
      console.log(`- **${step.id}. ${step.title}**${step.blocking ? '   [blocking]' : ''}`);
      console.log(`  - where: ${step.route === '*' ? 'anywhere in the app' : step.route}`);
      console.log(`  - given: ${step.given}`);
      console.log(`  - do: ${step.do}`);
      console.log(`  - expect: ${step.expect}`);
    }
    console.log('');
  }
  console.log(`## When something is wrong\n\n${manifest.blockingRule}\n`);
  console.log(`${manifest.report.destination}\n`);
  if (manifest.report.secondary) console.log(`${manifest.report.secondary}\n`);
  console.log('Send one report per step, and include:\n');
  for (const field of manifest.report.include) console.log(`- ${field}`);
  console.log(
    `\nThe walk will fill the form in for you: node tools/validate-walk.mjs --report ${mine[0].steps[0].id} --chain ${chainId}\n`,
  );
  process.exit(0);
}

// One finding, in the shape a row is filed in. The step id, its route, the calls it sends, its own
// acceptance bar and — the part a tester should never have to decide — whether it blocks a launch,
// all filled in from the manifest, leaving only what the tester saw. A defect reported this way is
// already a row; one reported as a paragraph has to be turned into one by somebody who was not there.
const reportStep = flag('--report');
if (reportStep !== undefined) {
  const step = steps.find((s) => s.id === reportStep);
  if (!step) {
    console.log(`\n'${reportStep}' is not a step — --print lists every one of them.`);
    process.exit(1);
  }
  const chainId = Number.parseInt(flag('--chain') ?? String(SEPOLIA), 10);
  const chain = deployments().get(chainId);
  console.log(`\n## ${step.id} — ${step.title}${step.blocking ? '   [blocking]' : ''}\n`);
  console.log(`- chain: ${chain ? chainLine(chain) : `${chainId} — not a chain this build carries a deployment for`}`);
  console.log(`- walked as: ${step.act.role}`);
  console.log(`- where: ${step.route === '*' ? 'anywhere in the app' : step.route}`);
  console.log(`- sends: ${step.calls.join(', ')}`);
  console.log(`- the walk says to expect: ${step.expect}`);
  console.log('- what I did:');
  console.log('- what happened instead:');
  console.log('- transaction hash, or the wallet error if it never sent:');
  console.log(
    `\n${
      step.blocking
        ? 'This step is blocking: if it failed, the row it opens has to be closed before launch.'
        : 'This step is not blocking: the row it opens has to exist, and may still be open at launch.'
    }\n`,
  );
  process.exit(0);
}

if (process.argv.includes('--print')) {
  const blockingCount = steps.filter((s) => s.blocking).length;
  console.log(`\n# ${manifest.title}\n`);
  console.log(`${manifest.purpose}\n`);
  console.log('## Who you are\n');
  for (const [role, what] of Object.entries(manifest.roles)) console.log(`- **${role}** — ${what}`);
  console.log(`\n## What "blocking" means\n\n${manifest.blockingRule}\n`);
  for (const act of manifest.acts) {
    console.log(`\n## Act ${act.id} — ${act.title}   ·   ${act.role}\n`);
    if (act.note) console.log(`${act.note}\n`);
    for (const step of act.steps) {
      console.log(`### ${step.id}. ${step.title}${step.blocking ? '   [blocking]' : ''}`);
      console.log(`- where: ${step.route === '*' ? 'anywhere in the app' : step.route}`);
      console.log(`- given: ${step.given}`);
      console.log(`- do: ${step.do}`);
      console.log(`- expect: ${step.expect}`);
      console.log(`- sends: ${step.calls.join(', ')}\n`);
    }
  }
  console.log('\n## Not walked, and why\n');
  for (const entry of manifest.outOfWalk ?? []) console.log(`- \`${entry.call}\` — ${entry.why}`);
  console.log('\n## What this walk does not see\n');
  for (const spot of manifest.blindSpots ?? []) console.log(`- \`${spot.site}\` — ${spot.why}`);
  console.log(`\n## When something is wrong\n`);
  console.log(`${manifest.report.destination}\n`);
  if (manifest.report.secondary) console.log(`${manifest.report.secondary}\n`);
  console.log('Send one report per step, and include:\n');
  for (const field of manifest.report.include) console.log(`- ${field}`);
  console.log(
    `\n\`node tools/validate-walk.mjs --report <step id>\` prints that list already filled in for one step.` +
      ` ${blockingCount} of ${steps.length} steps are blocking.\n`,
  );
}

/* ---- report -------------------------------------------------------------------------------- */

const walked = [...covered.keys()].length;
console.log(
  `\n${steps.length} steps across ${manifest.acts.length} acts · ` +
    `${walked} of ${surface.writes.size} contract writes walked · ${excused.size} excused · ` +
    `${steps.filter((s) => s.blocking).length} blocking · ${findings.length} findings`,
);
process.exit(findings.length ? 1 : 0);
