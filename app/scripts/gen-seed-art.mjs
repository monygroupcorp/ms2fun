#!/usr/bin/env node
/**
 * gen-seed-art.mjs — drive a local ComfyUI (MyComfy) to generate the seed's gallery art into the
 * gitignored public/seed-art/ tree. Decoupled from the Solidity seed: SeedAnvil only references
 * hardcoded paths; this just has to put a PNG at each one (missing files fall back to glyphs).
 *
 * USAGE
 *   1. In ComfyUI, load the `klein-aeonflux` workflow and "Save (API Format)" → save the JSON to
 *      app/scripts/klein-aeonflux.api.json (or set COMFY_WORKFLOW to its path).
 *   2. node app/scripts/gen-seed-art.mjs            # generates everything missing
 *      node app/scripts/gen-seed-art.mjs --force    # regenerate even if the file exists
 *      node app/scripts/gen-seed-art.mjs --only nft/vapor   # path-prefix filter
 *
 * CONFIG (env overrides)
 *   COMFY_URL        ComfyUI server         (default http://127.0.0.1:8188)
 *   COMFY_WORKFLOW   API-format workflow    (default app/scripts/klein-aeonflux.api.json)
 *   SEED_ART_DIR     output root            (default public/seed-art — set to app/public/seed-art if
 *                                            that's the dir your dev server serves; see plan Step 9.0)
 *   PROMPT_NODE      node id whose inputs.text is the POSITIVE prompt (default: auto-detect the
 *                    CLIPTextEncode node; if two, the one NOT wired to KSampler.negative)
 *   SEED_NODE        node id whose inputs.seed to randomize    (default: auto-detect KSampler)
 *
 * The MANIFEST below lists {file, prompt} for every image the seed references. Edit/extend it to match
 * the collections you actually seed (slugs from Phases 2–4). Prompts are on-brand (monochrome Gallery
 * Brutalism) — tune freely.
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const COMFY_URL = process.env.COMFY_URL ?? 'http://127.0.0.1:8188'
const WORKFLOW_PATH = resolve(process.env.COMFY_WORKFLOW ?? 'app/scripts/klein-aeonflux.api.json')
const OUT_ROOT = resolve(process.env.SEED_ART_DIR ?? 'public/seed-art')
const FORCE = process.argv.includes('--force')
const ONLY = (() => {
  const i = process.argv.indexOf('--only')
  return i !== -1 ? process.argv[i + 1] : null
})()

// ── The art manifest — one entry per path the seed references. Extend to match your seeded slugs. ──
const STYLE = 'monochrome, high-contrast black and white, brutalist gallery, grain, no text'
const MANIFEST = [
  // collection cards / banners
  ...[
    'neon-drift',
    'monolith',
    'ghost-mint',
    'spectra',
    'vault-club',
    'gallery-relics',
    'live-salon',
    'ember',
    'vapor',
    'cinder',
    'haze',
  ].map((s) => ({
    file: `collections/${s}.png`,
    prompt: `${s} abstract cover art, ${STYLE}`,
  })),
  // ERC1155 edition heroes (slug-editionId)
  {
    file: 'editions/neon-drift-1.png',
    prompt: `glitched generative fragment, aberration, ${STYLE}`,
  },
  { file: 'editions/neon-drift-2.png', prompt: `open-edition drift field, ${STYLE}` },
  { file: 'editions/monolith-1.png', prompt: `single black slab monolith, ${STYLE}` },
  { file: 'editions/ghost-mint-1.png', prompt: `faint ghostly signal, fossil layer, ${STYLE}` },
  { file: 'editions/spectra-1.png', prompt: `rising spectral bands, ${STYLE}` },
  { file: 'editions/spectra-2.png', prompt: `scarce relic object, ${STYLE}` },
  { file: 'editions/spectra-3.png', prompt: `embargoed sealed form, ${STYLE}` },
  { file: 'editions/vault-club-1.png', prompt: `members-only vault key, ${STYLE}` },
  // ERC721 pieces (slug-n)
  { file: 'pieces/gallery-relics-1.png', prompt: `gallery relic I, ${STYLE}` },
  { file: 'pieces/gallery-relics-2.png', prompt: `gallery relic II, ${STYLE}` },
  { file: 'pieces/live-salon-1.png', prompt: `salon piece I, ${STYLE}` },
  { file: 'pieces/live-salon-2.png', prompt: `salon piece II, ${STYLE}` },
  // ERC404 per-NFT art for the hero bonding collection `vapor` (variety, tokenIds 1..8)
  ...Array.from({ length: 8 }, (_, i) => ({
    file: `nft/vapor/${i + 1}.png`,
    prompt: `vapor specimen #${i + 1}, ${STYLE}`,
  })),
  // profile avatars (by handle)
  ...['ms2labs', 'vela', 'rune', 'mire', 'cael', 'onyx', 'veil', 'ash', 'dusk', 'iris'].map(
    (h) => ({
      file: `profiles/${h}.png`,
      prompt: `portrait avatar for ${h}, ${STYLE}`,
    }),
  ),
]

// ── ComfyUI driving ───────────────────────────────────────────────────────────

async function exists(p) {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

/** Which seed-like input key a node carries (covers KSampler `seed` + Flux RandomNoise `noise_seed`). */
function seedKey(node) {
  const inp = node?.inputs ?? {}
  if ('seed' in inp) return 'seed'
  if ('noise_seed' in inp) return 'noise_seed'
  return null
}

/** Find the positive-prompt text node id and a seed node id in an API-format workflow.
 *  Robust to Flux variants: matches any CLIPTextEncode* class and any node with seed/noise_seed. */
function detectNodes(wf) {
  const entries = Object.entries(wf)
  // Prompt: any *CLIPTextEncode* (or *TextEncode*) node; prefer the one NOT wired as a sampler negative.
  let clip = entries.filter(([, n]) => /CLIPTextEncode/i.test(n.class_type ?? ''))
  if (clip.length === 0) clip = entries.filter(([, n]) => /TextEncode/i.test(n.class_type ?? ''))
  const sampler = entries.find(([, n]) => /KSampler|Sampler/i.test(n.class_type ?? ''))
  let negId
  const neg = sampler?.[1].inputs?.negative
  if (Array.isArray(neg)) negId = String(neg[0])
  const positive = clip.find(([id]) => id !== negId) ?? clip[0]
  // Seed: first node carrying a seed/noise_seed input.
  const seeded = entries.find(([, n]) => seedKey(n) !== null)
  return {
    promptNode: process.env.PROMPT_NODE ?? (positive ? positive[0] : null),
    seedNode: process.env.SEED_NODE ?? (seeded ? seeded[0] : null),
  }
}

async function queuePrompt(wf) {
  const res = await fetch(`${COMFY_URL}/prompt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: wf }),
  })
  if (!res.ok) throw new Error(`/prompt ${res.status}: ${await res.text()}`)
  return (await res.json()).prompt_id
}

async function waitForImage(promptId) {
  // Poll /history until the prompt completes; return the first output image descriptor.
  for (let i = 0; i < 600; i++) {
    // up to ~5 min at 500ms
    const res = await fetch(`${COMFY_URL}/history/${promptId}`)
    if (res.ok) {
      const hist = await res.json()
      const entry = hist[promptId]
      if (entry?.outputs) {
        for (const out of Object.values(entry.outputs)) {
          if (out.images?.length) return out.images[0]
        }
      }
      if (entry?.status?.status_str === 'error') throw new Error(`prompt ${promptId} errored`)
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`timed out waiting for prompt ${promptId}`)
}

async function downloadImage(img, destPath) {
  const q = new URLSearchParams({
    filename: img.filename,
    subfolder: img.subfolder ?? '',
    type: img.type ?? 'output',
  })
  const res = await fetch(`${COMFY_URL}/view?${q}`)
  if (!res.ok) throw new Error(`/view ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(dirname(destPath), { recursive: true })
  await writeFile(destPath, buf)
}

async function main() {
  if (!(await exists(WORKFLOW_PATH))) {
    console.error(`No workflow at ${WORKFLOW_PATH}. In ComfyUI: Save (API Format) → that path.`)
    process.exit(1)
  }
  const template = JSON.parse(await readFile(WORKFLOW_PATH, 'utf8'))
  const { promptNode, seedNode } = detectNodes(template)
  if (!promptNode) {
    console.error('Could not find a CLIPTextEncode prompt node. Set PROMPT_NODE=<id>.')
    process.exit(1)
  }
  console.log(
    `ComfyUI ${COMFY_URL} · prompt node ${promptNode}${seedNode ? ` · seed node ${seedNode}` : ''}`,
  )

  const work = MANIFEST.filter((m) => !ONLY || m.file.startsWith(ONLY))
  let done = 0,
    skipped = 0
  for (const item of work) {
    const dest = join(OUT_ROOT, item.file)
    if (!FORCE && (await exists(dest))) {
      skipped++
      continue
    }
    // Clone the workflow, inject the prompt + a fresh seed.
    const wf = JSON.parse(JSON.stringify(template))
    wf[promptNode].inputs.text = item.prompt
    const sk = seedNode ? seedKey(wf[seedNode]) : null
    if (sk) wf[seedNode].inputs[sk] = Math.floor(Math.random() * 1e15)
    try {
      const id = await queuePrompt(wf)
      const img = await waitForImage(id)
      await downloadImage(img, dest)
      done++
      console.log(`✓ ${item.file}`)
    } catch (err) {
      console.error(`✗ ${item.file}: ${err.message}`)
    }
  }
  console.log(`\nGenerated ${done}, skipped ${skipped} (existing). Output: ${OUT_ROOT}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
