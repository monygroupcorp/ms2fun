/**
 * Path-prefix smoke for the IPFS distribution build (noesis-409). Runs as the last step of
 * `pnpm build:ipfs`, the same way the precache and share-card guards close `pnpm build`.
 *
 * The failure mode it exists for: a public gateway serves the pinned directory from under a path
 * prefix (`/ipfs/<cid>/…`, or a subdomain gateway's own root), so any root-anchored URL in the
 * emitted build leaves the pin and lands on whatever the gateway has at that path — usually a 404,
 * sometimes another CID's file. That is invisible to `pnpm build`, which emits happily either way,
 * and invisible to a `vite preview` served from the root.
 *
 * So: serve the emitted directory under a prefix on a local HTTP server and assert against the
 * bytes, not the config —
 *   1. the shell answers at the prefix,
 *   2. every asset the shell references resolves UNDER the prefix,
 *   3. no referenced URL is root-anchored (the same request against the server root 404s, which is
 *      what proves the prefix is load-bearing rather than incidental),
 *   4. a hash deep link is served by the same document, because the fragment never reaches a
 *      server at all,
 *   5. the build carries no service worker registration — a precache scoped to one CID outlives a
 *      contenthash repoint.
 * No IPFS infrastructure is involved; the prefix is the only thing being simulated.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, join, normalize, resolve } from 'node:path'

const DIST_DIR = resolve(import.meta.dirname, '..', '..', 'dist', 'ipfs')
const PREFIX = '/ipfs/bafybeigatewayprefixsimulation'

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
}

const failures: string[] = []

/** A gateway-shaped static server: it serves exactly the files that exist under the prefix and
 * answers everything else with 404. No SPA fallback, no directory rewriting beyond `/` → index. */
function serve() {
  return createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith(PREFIX)) {
      res.writeHead(404).end('not under the pinned prefix')
      return
    }
    let relativePath = url.pathname.slice(PREFIX.length)
    if (relativePath === '' || relativePath.endsWith('/')) relativePath += 'index.html'
    const target = join(DIST_DIR, normalize(relativePath))
    if (!target.startsWith(DIST_DIR) || !existsSync(target) || !statSync(target).isFile()) {
      res.writeHead(404).end('no such file under this CID')
      return
    }
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(target)] ?? 'application/octet-stream',
    })
    createReadStream(target).pipe(res)
  })
}

/** Every `src`/`href` the shell document references, in source order. */
function referencedUrls(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => match[1] ?? '')
}

async function main(): Promise<void> {
  if (!existsSync(join(DIST_DIR, 'index.html'))) {
    console.error(`ipfs smoke: no index.html under ${DIST_DIR} — run the ipfs build first`)
    process.exit(1)
  }

  const server = serve()
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
  const { port } = server.address() as AddressInfo
  const origin = `http://127.0.0.1:${port}`

  try {
    // 1 — the shell answers at the prefix root.
    const shell = await fetch(`${origin}${PREFIX}/`)
    if (!shell.ok) failures.push(`GET ${PREFIX}/ answered ${shell.status}`)
    const html = await shell.text()
    if (!html.includes('id="root"'))
      failures.push('the document served at the prefix is not the app shell')

    // 2 + 3 — nothing the shell references is root-anchored, and everything resolves under it.
    const referenced = referencedUrls(html)
    const local = referenced.filter(
      (url) => !/^(?:[a-z]+:)?\/\//i.test(url) && !url.startsWith('data:'),
    )
    if (local.length === 0) failures.push('the shell references no local assets — nothing to check')
    for (const url of local) {
      if (url.startsWith('/')) {
        failures.push(`root-anchored reference escapes the pin: ${url}`)
        continue
      }
      const resolved = new URL(url, `${origin}${PREFIX}/`)
      const asset = await fetch(resolved)
      if (!asset.ok) failures.push(`${url} → ${resolved.pathname} answered ${asset.status}`)
      // Harness self-check: the same asset addressed from the server root must NOT resolve. If it
      // did, this server would be answering off-prefix requests and the assertions above would
      // pass for a build that escapes the pin.
      const fromRoot = await fetch(`${origin}/${url.replace(/^\.\//, '')}`)
      if (fromRoot.ok)
        failures.push(`${url} also resolves from the server root — prefix not exercised`)
    }

    // 4 — deep links. A fragment is never sent to a server, so `…/#/collections` is requested as
    // the prefix root and must come back as the shell; the history-mode form of the same route is
    // a path that does not exist under the CID, and a gateway answers it with a 404. That contrast
    // is the reason this target routes on the hash.
    const hashDeepLink = await fetch(new URL('#/collections', `${origin}${PREFIX}/`))
    if (!hashDeepLink.ok || (await hashDeepLink.text()) !== html) {
      failures.push('a hash deep link does not resolve to the shell document')
    }
    const historyDeepLink = await fetch(`${origin}${PREFIX}/collections`)
    if (historyDeepLink.ok) {
      failures.push('a history-mode deep link resolved — this server is not modelling a gateway')
    }

    // 5 — no service worker in this target.
    for (const marker of ['registerSW.js', 'serviceWorker.register', 'workbox']) {
      if (html.includes(marker))
        failures.push(`the shell still registers a service worker (${marker})`)
    }
    if (existsSync(join(DIST_DIR, 'sw.js'))) failures.push('sw.js was emitted into the ipfs build')

    if (failures.length > 0) {
      for (const failure of failures) console.error(`ipfs smoke: ${failure}`)
      console.error('ipfs smoke: FAILED — this build does not survive a gateway path prefix.')
      process.exit(1)
    }

    console.log(
      `ipfs smoke: OK — shell + ${local.length} referenced assets resolve under ${PREFIX}/, ` +
        'none from the server root, hash deep link serves the shell, no service worker.',
    )
  } finally {
    await new Promise<void>((closed) => server.close(() => closed()))
  }
}

main().catch((error: unknown) => {
  console.error('ipfs smoke: FAILED —', error instanceof Error ? error.message : error)
  process.exit(1)
})
