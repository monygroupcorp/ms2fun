#!/usr/bin/env node
// Gate the testnet walk against the app it describes. Read-only, no network, no model.
//
//   node tools/validate-walk.mjs            # the gate. exit 1 = findings
//   node tools/validate-walk.mjs --print    # render the walk a tester follows
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

/* ---- render -------------------------------------------------------------------------------- */

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
  console.log(`\n## When something is wrong\n
Write it down as a noesis row the moment you see it, with the step id, what you did, what you
expected from this page, and what happened instead. A step marked [blocking] that fails is a row
that has to be closed before launch; every other failure is a row that has to exist. ${blockingCount}
of ${steps.length} steps are blocking.\n`);
}

/* ---- report -------------------------------------------------------------------------------- */

const walked = [...covered.keys()].length;
console.log(
  `\n${steps.length} steps across ${manifest.acts.length} acts · ` +
    `${walked} of ${surface.writes.size} contract writes walked · ${excused.size} excused · ` +
    `${steps.filter((s) => s.blocking).length} blocking · ${findings.length} findings`,
);
process.exit(findings.length ? 1 : 0);
