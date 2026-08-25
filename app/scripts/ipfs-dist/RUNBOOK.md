# Publishing the noesis IPFS distribution

The app ships from one source tree to two places:

|                  | ms2.fun                               | noesis.gwei.domains                                        |
| ---------------- | ------------------------------------- | ---------------------------------------------------------- |
| build            | `pnpm build` → `app/dist/`            | `pnpm build:ipfs` → `app/dist/ipfs/` + `app/dist/ipfs.car` |
| asset URLs       | root-anchored (`base: '/'`)           | document-relative (`base: './'`)                           |
| routing          | history (`/collections`)              | hash (`#/collections`)                                     |
| service worker   | on                                    | off                                                        |
| update mechanism | deploy replaces bytes at a stable URL | publish a new CID, then repoint the record                 |

The two targets diverge in exactly three places — `app/vite.config.ts` (base, output dir, service
worker), `app/src/App.tsx` (routing mode), and this directory. Everything else is one build.

## Why hash routing on the pin

A `.gwei` name is an on-chain registry entry, not DNS. The site pointer is an ENSIP-7 `contenthash`
record, and `<name>.gwei.domains` is a gateway that reads that record from chain and reverse-proxies
the referenced CID from public IPFS gateways, serving it at the subdomain root.

Nothing in that path promises an SPA fallback, and a plain IPFS gateway certainly has none: it
serves the files that exist under the CID and answers anything else with its own 404. A history-mode
deep link (`/collections`) is therefore a path that does not exist in the pinned directory. Hash
routing puts the whole route in the fragment, which is never sent to any server, so every deep link
resolves to the one document that is actually pinned. The same reasoning is why `base` is `'./'` —
under a path-prefixed gateway URL (`/ipfs/<cid>/…`) a root-anchored asset URL leaves the pin
entirely. `scripts/ipfs-dist/smoke.ts` asserts both against the emitted bytes on every ipfs build.

## Steps

### 1. Build and package

```
cd app
pnpm build:ipfs
```

This runs the ipfs-target vite build, then the path-prefix smoke, then the packer. It prints:

```
ipfs-dist: packed <n> files (<bytes> bytes) from …/app/dist/ipfs
ipfs-dist: car    …/app/dist/ipfs.car (<bytes> bytes, <n> blocks)
ipfs-dist: root   bafy…
```

`root` is the release CID. It is a function of the commit: run the build twice from a clean checkout
at the same commit and both the CID and the CAR bytes are identical (`pack.test.ts` pins the
packing half of that; the vite half is the standard content-hashed output plus the commit stamp).
Record the CID next to the commit — the footer of the running app shows the same short commit, so a
bug report from the pinned site names the build it was found on.

> `app/dist/` is a build directory. `pnpm build` (the ms2.fun target) empties it, including
> `dist/ipfs/` and `dist/ipfs.car`. Nothing is lost — re-run `pnpm build:ipfs` at the same commit and
> you get the same CID back.

### 2. Pin it

**Decision point — pin host.** rth's ruling is that we self-pin: the release lives on a node we
operate, not on a third-party pinning service. Standing that node up (or confirming it is up and
reachable) is an operator step, not fleet work, and it is a prerequisite for this step. The
alternative not chosen — a commercial pinning service — trades the operational work for a dependency
that can drop the pin or read our publishing cadence; revisit only if running the node stops being
worth it.

The packer takes no endpoint and reaches no network. Import the CAR into whichever node is doing the
pinning, addressing it by its own API endpoint:

```
# $IPFS_API is the kubo RPC endpoint of the pinning node (a parameter — never committed here).
curl -X POST -F file=@app/dist/ipfs.car "$IPFS_API/api/v0/dag/import?pin-roots=true"
```

`dag/import` reports the root it stored. **Check it equals the CID the packer printed** — that is the
cross-check that the packing parameters and the node agree, and it is worth doing at least the first
time and after any bump of `ipfs-unixfs-importer`.

Confirm the pin and that the content is retrievable before touching the chain:

```
curl -s "$IPFS_API/api/v0/pin/ls?arg=<cid>"
curl -sI "https://ipfs.io/ipfs/<cid>/"      # a public gateway can fetch it
```

A CID nobody else can retrieve makes a dead site the moment the record points at it, so do not skip
the second check: the gwei gateway proxies from public gateways, which have to be able to find the
content from our node.

### 3. Point the name at it

**This is rth's transaction, like every broadcast.** It is a wallet transaction from the address that
holds the name — no key, endpoint or account belonging to it appears anywhere in this repository.

1. Open the gwei.domains dapp and select the name.
2. **Set Website** → paste the CID from step 1.
3. Sign. The dapp writes the ENSIP-7 `contenthash` record.
4. Load `https://noesis.gwei.domains/`, confirm the footer shows the commit you just built, and walk
   one deep link (`https://noesis.gwei.domains/#/collections`).

**Decision point — CID vs IPNS.** This runbook repoints the `contenthash` record per release, which
is rth's ruling: one transaction per publish, and the record always names the exact bytes being
served. The alternative is to set the record to an IPNS name once and republish the IPNS pointer per
release — no further transactions, at the cost of an extra indirection whose resolution can lag or
fail, and a record that no longer tells you what is being served. Not chosen; noted because it is
the standard answer to "must rth sign every release".

### 4. Skew

Hot patches go to ms2.fun first; the pin is repointed on rth's cadence, so the pinned build can lag.
That is expected, not a defect — which is why both builds stamp their commit into the footer and the
console. When triaging a report from noesis.gwei.domains, read the stamp before reproducing.

## What is not covered here

- **CI.** `pnpm build:ipfs` is not in `app-ci.yml`; the ipfs target is exercised locally and by the
  routing matrix in `src/ipfs-routing.test.tsx`, which does run in CI. Adding the ipfs build to the
  workflow is a follow-on.
- **Standing up the pinning node.** Operator step, above.
- **Announcement copy.** The announcement points people at noesis.gwei.domains as the bug-hunting
  surface; that copy is not this tooling's concern.
