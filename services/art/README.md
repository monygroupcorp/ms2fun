# Art delivery service

A read-through cache in front of the public IPFS gateway roster, so a visitor's first cold view of a
collection grid does not spend a request on a third-party gateway that meters by client IP.

It answers two requests:

```
GET /art/<ipfs-path>?w=<width>    the image, at one of the rungs in ART_WIDTHS
GET /meta/<ipfs-path>             the collection's metadata JSON, verbatim
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

## A cache, not custody

**This stores what it has served and evicts. It claims no permanence.** A collection whose own pin
dies degrades visibly rather than being hosted here forever. Nothing in this worker pins, re-pins, or
promises to hold anything, and that is a deliberate refusal: pinning art that is not ours is an
unbounded bill, a moderation surface, and a promise we would then have to keep.

Eviction belongs to the bucket, not to this code. Apply a lifecycle rule when you create it:

```
wrangler r2 bucket create <your-bucket>
wrangler r2 bucket lifecycle add <your-bucket> --prefix "" --expire-days 30
```

Thirty days is a starting point, not a law. The rule is what bounds the bill; without one this
becomes storage that only grows.

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

Then point the app at it by setting `VITE_ART_SERVICE` to the deployment's origin at build time.

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
4. **Deleting from this cache does not remove the content from IPFS**, which is not ours and not
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
Account Analytics:Read. `ART_BUCKET` and `ART_WORKER` override the names it asks about.

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

The lifecycle rule above is still the only thing that BOUNDS the bill. This measures it.
