# Art delivery service

A read-through cache in front of the public IPFS gateway roster, so a visitor's first cold view of a
collection grid does not spend a request on a third-party gateway that meters by client IP — and,
separately, time-boxed hosting for art a creator uploads through the launch wizard, so they can
launch without setting up IPFS first (see [Hosted uploads](#hosted-uploads)).

It answers these requests:

```
GET /art/<ipfs-path>?w=<width>    the image, at one of the rungs in ART_WIDTHS
GET /meta/<ipfs-path>             the collection's metadata JSON, verbatim
GET /ipfs/<cid>/<file>            gateway-shaped: hosted bytes first, else cache and roster
GET /car/<cid>                    a hosted upload's CAR: whole for the images root, metadata only
                                  for the metadata root
GET /hosting/<instance>           whether a launched collection has graduated or moved to IPFS
    /upload/...                   sign-in, upload, bind (hosted uploads only)
```

`<ipfs-path>` is `<cid>` or `<cid>/<file>`. Both shapes are fixed by `artServiceUrl()` and
`metaServiceUrl()` in `app/src/lib/metadata/uri.ts` — those functions are the specification and this
service answers them.

**Both, because one without the other does not achieve the thing.** A card cannot render art until it
has read the JSON that names the art's CID, so a grid served art from here and metadata from a public
gateway still spends one metered third-party request per card — and spends it FIRST, before anything
appears on screen. The art half shipped alone to begin with, which is why this is spelled out.

The metadata route has no width and no variants: one document, one key, prefixed so it can never
collide with an image. It also refuses to STORE an answer that is not JSON. A public gateway that
cannot serve a CID often replies `200` with an HTML error page, and that page cached under a metadata
key and then served from our own origin is a worse bug than a cache miss — so the body is checked and
parsed before it is stored, and an answer that fails either check moves to the next operator.

## A cache, not custody — except for uploads

**The read path stores what it has served and evicts. It claims no permanence.** A collection whose
own pin dies degrades visibly rather than being hosted here forever. Nothing on that path pins,
re-pins, or promises to hold anything: pinning art that is not ours is an unbounded bill, a
moderation surface, and a promise we would then have to keep.

**The one exception is art uploaded through the site.** That art is hosted: kept in its own bucket,
addressed by the IPFS CIDs it was built under, for a limited time, with no permanence claim. An
upload no launched collection uses is deleted after seven days; a launched collection's art is
expected to move to IPFS after the collection graduates. Everything else this service holds is still
a cache. The details, and why the CID makes the later move free, are under
[Hosted uploads](#hosted-uploads).

Eviction of the cache belongs to the cache bucket, not to this code. Apply a lifecycle rule when you
create it:

```
wrangler r2 bucket create <your-cache-bucket>
wrangler r2 bucket lifecycle add <your-cache-bucket> --prefix "" --expire-days 30
```

Thirty days is a starting point, not a law. The rule is what bounds the cache's bill; without one it
becomes storage that only grows. **Never apply it to the hosted bucket** — see below.

## Lead with a gateway you control

**Set `ART_GATEWAY_LEAD`, or this service answers 502.** The public roster meters by client IP, and
the client here is a Cloudflare datacentre rather than a visitor. Measured 2026-09-29 against a
deployed worker: the shipped roster returned it nothing at all and every card 502'd, while the same
CID came back `200 image/png` to a laptop on a home connection seconds later. `ipfs.io` and
`dweb.link` answer a plain request `429`.

A dedicated gateway answers because its quota belongs to the account that pins the art instead of
to whoever happens to be asking:

```
wrangler deploy --var ART_GATEWAY_LEAD:https://<name>.mypinata.cloud
```

Either spelling works — the origin alone, or the full `/ipfs/` base. A value that is not an https
origin is ignored rather than prepended, because a broken entry at the head of the roster is a
guaranteed timeout on every fetch and is worse than having no lead at all.

**It leads the roster; it does not replace it.** A dedicated gateway that is down, over quota or
misconfigured falls through to the public entries exactly as any operator does, and a deployment
that sets nothing behaves precisely as it did before this existed.

## Hosted uploads

The first creator to launch here said the hardest part was setting up IPFS before they could start.
So the launch wizard offers **Upload art** beside the paste-a-link field: the creator picks image
files, the browser packs them into IPFS directories and one CAR, the creator signs in with their
wallet, and the CAR is uploaded here. The wizard then writes the collection's per-token base as
`https://<art-host>/ipfs/<metaCid>/`.

### What is stored, and what it is not

- **Content-addressed.** The browser builds the CIDs with the same UnixFS parameters as the release
  packer (`app/src/lib/art/unixfs.ts`: CIDv1, raw leaves, wrapped directory). This service accepts a
  block only if its bytes hash to its CID, and an upload only if the whole DAG under its two roots is
  present and nothing else is (`src/hosted/car.ts`). So the CIDs are facts about the bytes, and they
  are the CIDs any IPFS node will give the same art.
- **A convenience, not custody.** Unlaunched uploads are deleted after seven days. A launched
  collection's art stays hosted; nothing here ends it automatically, and nothing here promises to
  keep it forever. The policy is that art belongs on IPFS, and creators are encouraged to move it
  there once the collection graduates (see [Moving to IPFS](#moving-to-ipfs)).
- **Movable for free.** Every pointer — the on-chain base and the `image` in each piece's JSON — is
  gateway-shaped (`https://<art-host>/ipfs/<cid>/<file>`). The app reads such a link as the IPFS
  pointer it is and falls back to the public roster, and `/ipfs/` on this service falls through to
  the cache and roster for a CID it does not host. Once the CAR is pinned anywhere (`GET /car/<cid>`
  hands it back byte for byte), the same links keep working with no transaction.
- **Narrow.** PNG, JPEG, WebP and GIF only, each checked by its first bytes as well as its name; no
  SVG, HTML or video. Up to 10 MiB per image, 10,000 pieces and 2 GiB per upload. A creator's
  `animation_url` and any other link in their metadata is kept as written and never hosted. Every hosted byte is served with a
  content type this service chose, `nosniff`, and a sandboxing CSP. `/ipfs/` will not proxy anything
  from the roster except a raster image or a JSON document, so it is not an open gateway.

The limits are working defaults and live in one dependency-free file,
`app/src/lib/art/hostingLimits.ts`, which the wizard and this service both read.

### The shape of an upload

One CAR, two roots, in this order:

```
root 0  images     1.png, 2.jpg, ...       one image per piece, named by piece number
root 1  metadata   1, 2, ...               the creator's JSON for that piece, with its "image" set to
                                           "https://<art-host>/ipfs/<root 0>/1.png"
```

`tokenURI(id)` is `base + id`, so the metadata files have no extension, and the base is root 1.
Piece N is token N; the first NFT a collection mints is token 1.

**The metadata is the creator's own.** The wizard reads per-piece JSON, a `_metadata.json` list, or
a CSV (`app/src/lib/art/layout.ts`), keeps every field in the creator's key order, and rewrites only
`image` (`app/src/lib/art/pieceJson.ts`); images alone get `{"name": <pattern>, "description"?,
"image"}`. This service accepts any JSON object per piece, up to 512 KiB, and checks, once the CAR is
stored and before anything is indexed: each piece is UTF-8, strictly valid JSON, one object, and its
`image` links a file under root 0 (`src/hosted/metadata.ts`). Pieces are served as
`application/json`. The metadata is read back with a few ranged reads, because the browser writes the
CAR in DAG order with the metadata together at the end; a CAR that scatters it is refused.

### Routes

```
GET    /upload/nonce          a fresh sign-in nonce, valid 10 minutes, usable once
POST   /upload/session        { message, signature } -> { token, address, expiresAt }   (1 hour)
PUT    /upload/car            the CAR in one request (up to 95 MiB), Content-Length required
POST   /upload/parts          { bytes, imgCid, metaCid } -> an upload in parts, new or resumed
GET    /upload/parts/<id>     { upload: { id, bytes, partSize, parts: [held part numbers], ... } }
PUT    /upload/parts/<id>/<n> part n (from 1): bytes [(n-1)*partSize, n*partSize) of the CAR
POST   /upload/parts/<id>/complete   assemble, verify the whole CAR, index -> the draft
GET    /upload/drafts         the signed-in wallet's uploads
DELETE /upload/drafts/<id>    delete one of them, unless a launched collection uses it
POST   /upload/bind           { instance } -> the upload that instance's on-chain base points at
GET    /ipfs/<cid>/<file>     hosted bytes, else cache and roster
GET    /car/<cid>             images root: the whole upload. metadata root: just the metadata
```

Every upload route but sign-in needs `Authorization: Bearer <token>`.

**Uploads in parts** are how a full-size collection gets past the 100 MB request ceiling, and how it
survives a dropped connection or a page reload. `POST /upload/parts` reserves the upload's full size
against the wallet's caps and starts an R2 multipart upload; asked again by the same wallet for the
same roots and size, it answers with the same upload and the parts already held, and the wizard sends
only the rest. Parts are 16 MiB (R2 requires equal parts of at least 5 MiB, the last excepted);
the first part's CAR header must name exactly the declared roots, none denied. Nothing is indexed or
served until `complete`, which assembles the parts and streams the whole CAR back through the same
verifier a one-request upload goes through — every block against its CID, the two-root shape, the
metadata — and deletes it if anything fails. `complete` is safe to repeat. An upload that never
completes counts against the wallet at its full size and is deleted, parts and all, when the 7-day
draft clock runs out; the uploader can delete it sooner. If the roots are already hosted,
`POST /upload/parts` answers with that draft and nothing is sent.

Measured locally (`wrangler dev`, 10,000 pieces, a 1.87 GiB CAR): `complete` took 18 s; the
verifier on its own used about 6 s of CPU and 50 MiB of heap in Node for the same CAR. That fits
inside the Workers Paid default of 30 s CPU per request; a deployment that sees it run close can
raise `[limits] cpu_ms` in its own config.

Sign-in is EIP-4361 (Sign-In with Ethereum). An ordinary signature is checked locally; anything
else is checked on chain through `UPLOAD_RPC_URL` with viem's `verifyHash`, so ERC-1271 smart
wallets (and ERC-6492 counterfactual ones) work. The session token is an HMAC over the address and
an expiry — nothing is stored per session.

Bind needs no sign-in. It reads `metadataURI()` from the instance and `isRegisteredInstance()` from
the registry over RPC, and binds only the upload whose metadata root that base names. The wizard
calls it right after a deploy; anyone may call it again later.

### Moving to IPFS

Hosting is a convenience for launching without IPFS, not a permanence promise. **Policy: art belongs
on IPFS, and creators are encouraged to move it there once their collection graduates.** Nothing
moves or stops automatically: a bound collection stays hosted until the operator acts by hand
(`ART_DENYLIST`, or deleting its objects — see [Takedown](#takedown)).

The collection page offers the owner the move in three steps:

1. **Get the art on IPFS.** The browser downloads the hosted CARs, checks every block against its
   CID, and builds a new CAR under one root holding the images and **regenerated metadata**: the
   hosted JSON with only `image` switched to `ipfs://<imgCid>/<n>.<ext>` instead of this host's
   link. The images stream through, so a full-size collection is never held in memory at once. The creator uploads it to a
   pinning service they control. The platform pins nothing into an account of its own.
2. **Check it is retrievable.** Public gateways from the app's roster — never this host — are asked
   for a sample of both roots; the metadata must match byte for byte.
3. **Point the collection at it**: `setMetadataURI("ipfs://<new metadata root>/")`, sent by the
   creator.

The new metadata root depends only on the images root and the hosted JSON, rewritten by
`app/src/lib/art/ipfsMigration.ts` and imported with the same UnixFS parameters, so anyone can
recompute it from the hosted copy (`GET /car/<metaCid>`, checked against `metaCid`). The collection
page does, in the visitor's browser, once the chain points at IPFS, and shows **verified on IPFS**
when the chain points at the result. A bare upload's JSON (`{"name":"#1","image":...}`) migrates to
exactly what it always did, so the shared test vectors from before still hold.

**Holders keep copies too.** Every collection page has a "keep this collection alive" panel: any
holder can pin the collection on their own IPFS node, ask their own pinning service to pin it, or
download its CAR. For a hosted collection the CAR comes from `GET /car/<cid>`, and the holder's
browser checks every block against its CID and every root against the chain before anything
reaches their node; when this host no longer has the upload, the browser rebuilds the CAR from the
public gateway roster instead (`?format=car`). Nothing here stores, pins or pays for those copies:
they live on the holder's node or in the holder's account. See `app/src/lib/art/keep/`.

**What the service knows.** The ledger's Durable Object alarm runs a watcher: at bind it reads the
upload's image names and hosted metadata and works out that root once; every `HOSTED_CHECK_MINUTES` (60) it reads each
collection's `graduated()` and `metadataURI()` over `UPLOAD_RPC_URL`. It **only informs** — it
records graduation the first time it is seen and marks a collection migrated when its base is
exactly `ipfs://<migrationCid>/`, and then stops reading it. A read that fails changes nothing and
waits a full interval. A collection type without `graduated()` simply never shows as graduated;
with no `UPLOAD_RPC_URL` nothing is read.

```
GET /hosting/<instance> -> {
  instance, state: "hosted" | "graduated" | "migrated",
  imgCid, metaCid, migrationCid, pieces: ["1.png", ...], migrated,
  boundAt, graduatedAt, migratedAt
}
```

Public, no sign-in, cached for a minute; 404 for a collection with nothing hosted. There are no
deadline fields because there is no deadline. `graduated` is what the app turns into its
recommendation to move. A migrated collection's hosted copy keeps being served, so caches and
marketplaces that remember the old links still resolve; reclaiming it is the operator's call.

The platform does not send the migration transaction. Collections that enabled agent delegation
could in principle have it sent by a protocol agent, but that needs an agent key held by the service
and gas spent on the creator's behalf; neither exists here, so that path is not built.

### Caps and kill switches

| what | default | where |
| --- | --- | --- |
| one request | 95 MiB | `UPLOAD_MAX_CAR_BYTES` — a one-request upload or one part; under the 100 MB request ceiling of Free/Pro zones |
| one upload | 2 GiB of CAR, 10,000 pieces | `hostingLimits.ts` — sent in 16 MiB parts |
| metadata | 512 KiB per piece, 32 MiB per upload | `hostingLimits.ts` |
| unlaunched art per wallet | 2 GiB, 3 uploads, unfinished ones included at full size | `hostingLimits.ts` |
| unlaunched lifetime | 7 days, unfinished uploads included | `hostingLimits.ts` |
| a launched collection | 2 GiB or 10,000 files | `hostingLimits.ts` |
| everything hosted | 500 GiB | `HOSTED_MAX_TOTAL_BYTES` — refuses new uploads once reached; about $7.50 a month in R2 storage if full |
| manual stop | off | `UPLOADS_PAUSED=1` — refuses new uploads; reads, downloads and binds carry on |
| chain checks | every 60 minutes | `HOSTED_CHECK_MINUTES` — how often the watcher reads each collection; informational only |

The caps are counted in a Durable Object (`src/hosted/ledger.ts` explains why not KV or D1), which
also deletes lapsed unlaunched uploads and runs the watcher on its own alarm — nothing to schedule. `pnpm spend` reports the hosted
bucket's storage alongside the cache's; when it says the month is over budget, set
`UPLOADS_PAUSED=1`.

### Provisioning

Nothing below is done by this repository. In your own Cloudflare account:

1. **A Workers Paid plan.** Verifying an upload hashes every byte of it; the free plan's 10 ms CPU
   limit cannot. Durable Objects on SQLite storage are included.
2. **The hosted bucket, with no lifecycle rule:**

   ```sh
   wrangler r2 bucket create noesis-art-hosted
   ```

   Check it has none: `wrangler r2 bucket lifecycle list noesis-art-hosted`. A rule here would
   delete launched collections' art on a timer. The one exception is R2's default rule that aborts
   incomplete multipart uploads after 7 days, which new buckets carry: it touches only uploads in
   parts that never finished, the same ones the ledger deletes at 7 days, and can stay.
3. **The session secret:** `wrangler secret put UPLOAD_SESSION_SECRET` (any long random string;
   rotating it signs everyone out and nothing else).
4. **The vars**, at deploy time or in the dashboard — `UPLOAD_SIWE_DOMAINS` (the host the app is
   served from), `UPLOAD_CHAIN_ID`, `UPLOAD_RPC_URL`, `UPLOAD_REGISTRY` (the master registry's
   address on that chain). Optionally `HOSTED_MAX_TOTAL_BYTES` and `HOSTED_CHECK_MINUTES`.
   `UPLOAD_RPC_URL` also feeds the watcher, two view calls per unmigrated collection per check.
5. **A route or custom domain** for the worker at the art host the app names (`VITE_ART_HOST`, set
   in `app/.env.production`). The same worker can serve `VITE_ART_SERVICE`.
6. **Optional: the Images binding** (uncomment `[images]` in `wrangler.toml`, on a wrangler that
   supports it) to serve hosted art at the width rungs and resize a new upload's first grid ahead of
   its first visitor. Without it hosted originals are served at every width.
7. `wrangler deploy`. The first deploy applies the `hosting-v1` Durable Object migration. Upgrading
   an existing deployment needs no new migration: the ledger creates its `collections` and `parts`
   tables and adds the columns uploads in parts need on start, and the watcher picks up
   already-bound uploads on the next upload, bind, or `GET /hosting/` read. Uploads in parts use the
   same hosted bucket; there is nothing new to create. Uploads made before metadata CARs were kept
   are served whole under `/car/<metaCid>`, which the app reads just the same.

With no `UPLOAD_SIWE_DOMAINS` or no secret, the upload routes answer 503 and the wizard's upload
fails with that reason; the paste field and every read route are unaffected.

### Trying it locally

```sh
anvil --port 8546 &                       # only needed for smart-wallet sign-in and bind
wrangler dev --port 8788 \
  --var UPLOAD_SESSION_SECRET:dev --var UPLOAD_SIWE_DOMAINS:localhost:5173 \
  --var UPLOAD_CHAIN_ID:31337 --var UPLOAD_RPC_URL:http://127.0.0.1:8546 \
  --var UPLOAD_REGISTRY:<a registry on that chain>
cd ../../app && VITE_ART_HOST=http://127.0.0.1:8788 pnpm dev
```

`wrangler dev` simulates the bucket and the Durable Object locally. The `[images]` binding is not
simulated by wrangler 3, so locally hosted art is served at its original size.

To watch the migration path, add `--var HOSTED_CHECK_MINUTES:0.1` (a check every six seconds) and
use a stand-in instance on anvil — any contract with `metadataURI()`, `setMetadataURI(string)` and
`graduated()`, registered with a stand-in registry answering `isRegisteredInstance(address)`.
Upload, deploy the instance with the hosted base, bind, and watch `GET /hosting/<instance>`: flip
`graduated` to see `graduated`, then `setMetadataURI("ipfs://<migrationCid>/")` to see `migrated`.

## The roster stays underneath

The app addresses this service only when `VITE_ART_SERVICE` names one, and it reports failures
against the same health tracking it uses for gateways. A service that is down, throttled, over
budget or switched off cools and is skipped, and the public roster carries on exactly as it did
before this existed.

**Unset is a supported state, not a degraded one.** Every test and local build runs that way. Nothing
about walkawayability changes because this exists: a fork can stand up its own, or run with none.

## Deploying your own

This repository carries no account identifier, credential or hostname, and it must stay that way.
Both blanks are filled in your own environment:

```
export CLOUDFLARE_ACCOUNT_ID=...      # never in this repo
export CLOUDFLARE_API_TOKEN=...       # never in this repo
wrangler deploy
```

Then point the app at it by setting `VITE_ART_SERVICE` to the deployment's origin at build time. A
deployment that also accepts uploads has more to provision first — see
[Provisioning](#provisioning).

A test in the app package (`artService.contract.test.ts`) asserts that this directory names no
deployment identifier, and that the width rungs here match the app's. Both are read from these files
rather than repeated, so they cannot drift quietly.

## Widths

`ART_WIDTHS` in `wrangler.toml` must mirror `ART_WIDTHS` in the app. A width the app asks for and
this does not list is refused with 400 — deliberately, rather than being snapped to a nearby rung,
because snapping would let any caller mint a new stored object per width it invents. That is an
unbounded bill wearing the clothes of a convenience.

Resizing happens at the edge when the zone has Image Resizing enabled. Where it is not, the original
is returned and cached under the requested width's key, so the service is correct either way and
merely less efficient.

## Takedown

This serves other people's content from our origin, which means there has to be a way to remove
something and a person who answers.

1. Requests go to the contact point published on the site's terms page.
2. Add the CID to `ART_DENYLIST` and redeploy:

   ```sh
   wrangler deploy --var ART_DENYLIST:"<cid>,<cid>"
   ```

   The list may be separated by commas, spaces or newlines, and an entry pasted as `ipfs://<cid>` or
   as a path under the CID still denies the right work. From then on the service answers `410 Gone`
   for that CID and every path under it, drops whatever it had cached at every rung, and — because
   the check runs before the bucket read — never re-fetches or re-stores it. The 410 is sent
   `no-store`, so removing an entry takes effect on the next request rather than whenever an edge
   cache happens to expire.
3. A manual delete without a denylist entry is a PAUSE, not a takedown: the next request re-fetches
   the object and stores it again. Use the list. `wrangler r2 object delete <bucket>/<cid>@w<width>`
   remains useful only for reclaiming space on something already denied.
4. **Hosted uploads obey the same list.** A denied CID is refused at upload, and a hosted one is
   answered `410` on every route, `/ipfs/` and `/car/` included. The list stops it being SERVED; to
   reclaim the space as well, delete the upload's objects from the hosted bucket
   (`hosted/car/<draft>.car`, `hosted/meta/<draft>.car`, and `hosted/idx/<cid>.json` for both of
   its roots).
5. **Deleting from this cache does not remove the content from IPFS**, which is not ours and not
   addressable by us, and it does not stop the app's public gateway roster from serving it — the
   denylist is scoped to our own origin, deliberately, because the roster is what makes the app
   walk-away-able. What the list removes is OUR redistribution. Say that plainly when answering; a
   takedown that implies more than it did is worse than one that explains the limit.

## Spend

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... ART_BUDGET_USD=25 pnpm spend
```

Prints the month so far — R2 storage, Class A and Class B operations, Worker requests, each as
billable-over-free — then the total against the budget, and exits 1 when it is over, so the same
command works as a scheduled check and not only as something a person reads. The token needs
Account Analytics:Read. Storage and operations cover both buckets, the cache and the hosted uploads;
`ART_BUCKET`, `ART_HOSTED_BUCKET` and `ART_WORKER` override the names it asks about. Over budget, it
says so and names the lever: `UPLOADS_PAUSED=1` stops new hosted uploads while reads carry on.

Two things it does on purpose:

- **It prints the prices it used, and the date and pages they were read from.** A cost is measured
  usage times a published price, and the price is the half that goes stale: a table nobody notices
  has moved prints a confident wrong number, which is worse than printing nothing. After
  `STALE_AFTER_DAYS` every run says the table may have moved, and a test fails the day it does — so
  re-read those two pages, update the table, move the date.
- **It fails rather than under-reports.** A figure it cannot read, or an R2 operation it cannot put
  on one side of the Class A/B split, is an error and never a zero. A spend report that quietly
  omits a cost is the surprise this exists to remove.

What it has NOT done is talk to the live API from this repository: the query's field names come from
Cloudflare's documentation, not from a captured response, so the first real run is also the first
proof the query is right. It will say so loudly if it is not.

The lifecycle rule above is still the only thing that BOUNDS the cache's bill, and
`HOSTED_MAX_TOTAL_BYTES` bounds hosting's. This measures both.
