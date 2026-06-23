# ADR-0004 — Metadata model (3 scopes, backend-free, feature-rich)

**Status:** Direction LOCKED 2026-06-23 (Mony). Implementation = Phase 2 (T2 spec → contract +
typed domain layer). Builds on `docs/plans/2026-03-28-metadata-uri-separation*.md`.

## The constraint that shapes everything
**The app runs with no backend (statically hosted, walk-away-able) yet profiles/collections must be
feature-rich.** The resolution: split every metadata scope into an **on-chain canonical pointer**
(a URI you own and edit) + **decentralized content** behind it (IPFS / Arweave / inline data-URI).
The static client reads the pointer from chain and fetches the content from the URI — no server, no
database, ever. NOEMA agents write metadata the same way: pin JSON, set the on-chain URI.

> Pointer on-chain (canonical, owned, cheap). Content off-chain-but-decentralized (rich, any JSON).
> Client = read chain + fetch URI. This is the whole model.

## The 3 scopes
| Scope | On-chain pointer (canonical) | Key | Editable by | Content |
| --- | --- | --- | --- | --- |
| **Account / profile** | **NEW** `ProfileRegistry: profileURI[address]` | `address` | the account itself | profile JSON (IPFS/Arweave/data-URI) |
| **Collection** | `MasterRegistry.instanceInfo[instance].metadataURI` (exists) | `instance` | creator / owner (`updateInstanceMetadata`) | collection JSON |
| **Per-NFT** | per-factory: ERC404 `baseURI`+tokenId (+on-chain `styleUri`); ERC1155 `Edition.metadataURI`; ERC721 `_tokenURIs[tokenId]` (exists) | `tokenId` | instance owner | token JSON |

The **collection list** for a profile stays **event-derived** (`CreatorInstanceAdded`) — no on-chain
index to maintain; the client/NOEMA reconstructs it from logs. So a profile = `profileURI` (rich
identity) + the event-derived list of its collections. Minimal on-chain, feature-rich off it.

## Profile contract (minimal)
A tiny standalone `ProfileRegistry` (single responsibility; keep it out of MasterRegistry):
```
setProfile(string uri)              // msg.sender sets/updates THEIR OWN profile pointer
profileURI(address account) → string
event ProfileUpdated(address indexed account, string uri)   // the index + history trail
```
~15 lines. Edits are self-only (the account owns its pointer). No on-chain version counter — the
`ProfileUpdated` event stream is the history. URI validated as a well-formed URI (reuse
`MetadataUtils.isValidURI`).

## Content schemas (where "feature-rich" lives — and NOEMA's contract)
The richness is in the JSON behind each pointer; the typed schemas are also **NOEMA's API surface**
(build once, serve frontend + agents). Sketch, to be finalized in T2:
- **profile.json:** `name, handle, bio, avatar, banner, links[], socials{}, theme?, version`.
- **collection.json:** `name, description, image, banner, links[], category, traits?, version`.
- **nft.json:** standard token metadata (`name, description, image, attributes[]`) + collection
  conventions.
Each schema is versioned (a `version` field) so the client can evolve them without on-chain changes.

## Keying / versioning / permissions (falls out of the above)
- **Keying:** the scope's natural on-chain key — `address` / `instance` / `tokenId`. No bespoke ID
  scheme.
- **Versioning:** swap the URI (new pinned content); history via the on-chain update events. The JSON
  also self-describes a `version` for schema evolution.
- **Permissions:** profile = self-only; collection = creator/owner; per-NFT = instance owner. All
  already enforced (or trivially enforced for the new ProfileRegistry).

## No-backend guarantees (how the static app actually works)
- **Reads:** chain (viem) for pointers + instance state; `fetch()` the URIs for content. Pin via
  IPFS/Arweave; the client resolves through a configurable list of **public gateways** (rotate on
  failure) or `ipfs://` natively. data-URIs need no fetch at all.
- **Writes:** the creator/agent pins JSON (client-side pinning service or NOEMA), then sends one tx
  to set the URI. No server mediates.
- **The ERC-8244 micro-build** can inline small profile/collection JSON as **data-URIs** (fully
  on-chain) for the contract-hosted variant.

## Deferred / open
- Pinning UX (which pin service the wizard suggests) — product, not protocol.
- Whether `ProfileRegistry` is UUPS-upgradeable (like the other registries) or immutable — lean
  toward immutable; it's a trivial mapping, nothing to upgrade.
- Optional: a reverse-resolver / ENS-style handle → address (nice-to-have, not MVP).

## Decision log
- **2026-06-23** — Minimal on-chain profiles (`address → profileURI`), collection list stays
  event-derived; all scopes = on-chain pointer + decentralized content; no backend. Chosen to keep
  the app statically hostable/walk-away-able while giving NOEMA a real, agent-writable profile
  object and feature-rich content via IPFS/Arweave/data-URI.
