# Phase 2 — Reconciliation: the API + the Crux

**Status:** 🟡 Mostly DONE — T1/T2/T3/T5/T6 complete and merged to `main` 2026-06-23 (`a3d310a`); **T4 (Aave vault) is the lone open item** and gates the entire create/write path.
**Depends on:** Phase 1 (stack proven)
**Exit gate owner:** Mony

> A documented, typed domain model + API exists over the (mostly-built) contracts; the Aave
> vault is in on the fork; and the information-architecture + 3-scope metadata problem is solved
> on paper and in types.

> **This is the long pole — but it is reconciliation, not greenfield. The contracts mostly
> exist. The hard part is the information architecture and metadata, not Solidity.**

---

## Goal
Turn the existing contract capability into a coherent, typed surface the wizard and NOEMA both
consume, and add the one new economic piece (the Aave vault).

## Scope
**In:**
- **Inventory** the existing collection + modular-component contracts (ERC404/DNT, whitelist,
  password tiers, liquidity-pool selection, vault selection); record what works and the testnet
  bug list.
- **Aave vault**: integrate a simple, defensible (likely off-the-shelf) vault into the existing
  **vault-selection** seam. Economics: 20% in → on withdrawal 20% to creator's alignment target
  + 1% platform; optional maturity / pay-to-unlock-early.
- **The crux — information architecture:** a typed schema for the module option space
  (whitelist, password tiers, pool selection, vault selection, Aave params) that the wizard can
  render — defaults, dependencies, progressive disclosure.
- **The crux — metadata:** the 3-scope model (account / collection / per-NFT) — where each is
  stored (onchain vs IPFS), keying, versioning, edit permissions. (Build on
  `docs/plans/2026-03-28-metadata-uri-separation*.md`.)
- **The typed domain layer / API** over the generated bindings: profiles, collections, metadata
  scopes, modules, and the **unified message system + scopes**. *This is also NOEMA's API surface.*

**Out (deferred):**
- The wizard UI and frontend flows → Phase 3 (this phase produces the model they consume).
- Multiple implementations per module → post-launch (MVP ships one of each; keep the seams).

## Design decisions
**Locked:**
- Contracts are built-out; Phase 2 reconciles + adds Aave, it does not rebuild. *(WAR_PATH)*
- The typed domain layer is the single source for both frontend and NOEMA. *(WAR_PATH)*
- Preserve the unified message system + scopes. *(INVARIANT)*

**Open (the real design work):**
1. **Metadata storage per scope** — onchain vs IPFS for account/collection/NFT; mutable vs frozen; who edits.
2. **Metadata keying/versioning** — how a URI/pointer is structured so 3 scopes stay coherent and updatable.
3. **Module option schema shape** — how factory params are described so the wizard renders them generically.
4. **Off-the-shelf Aave vault choice** — which base; how the 20/20/1 + maturity wraps it.
5. **Domain-layer boundary** — what's generated (bindings) vs hand-authored (semantics); how NOEMA consumes it.
6. **Which testnet bugs are blockers** vs deferrable.

## Task units
- [x] T1 — Contract inventory + classification (read-only survey). **DONE 2026-06-22 — see
  "T1 — Inventory & classification" below.**
- [x] T2 — Metadata model design (3 scopes) → written spec + types. **DONE 2026-06-23** —
  design locked in [ADR-0004](../decisions/0004-metadata-model.md); backend-free types built
  (`app/src/lib/metadata/{schemas,uri,encode}.ts`: lenient parsers + data-URI encode); the NEW
  account scope realized as the ownerless `ProfileRegistry` contract (`address → profileURI`).
- [x] T3 — Module option schema design → written spec + types. **DONE 2026-06-23** —
  [ADR-0005](../decisions/0005-module-option-schema.md): hybrid source (on-chain ComponentRegistry
  enumerates modules + `configType`; client holds typed config forms + hand-authored factory
  descriptors), generic declarative `FieldSchema` + shared evaluator, vault slot modelled (provider
  pending T4). Types in `app/src/lib/wizard/` (schema/projectTypes/configTypes/useApprovedModules);
  live `useApprovedModules` verified on the fork (gating→3, liquidity→3, vault→0).
- [ ] T4 — Aave vault: select base, implement the endowment splits + maturity, Foundry tests.
  **Build handoff ready → [t4-aave-vault-handoff.md](./t4-aave-vault-handoff.md)** (seams pinned,
  prerequisites + open decisions flagged). The lone open Phase-2 item; gates the create/write path.
- [~] T5 — Typed domain layer over bindings (profiles/collections/metadata/modules/messages).
  **Profiles + collections DONE** (ProfileRegistry + metadata hooks; `getHomePageData` cards).
  Remaining: the **GlobalMessageRegistry feed** (invariant) + creator→collections enumeration
  (`CreatorInstanceAdded`) + modules.
- [~] T6 — Deploy the reconciled set + Aave vault to the fork via the existing pipeline + seeds.
  **Fork deploy + seed DONE** (`SeedAnvil.s.sol`: 3 featured ERC1155 collections + 2 profiles,
  all backend-free `data:` metadata; verified via `getHomePageData`/`profileURI`). Aave pending T4.

## T1 — Inventory & classification (2026-06-22)

Read-only survey of the contracts the local deploy (`DeployAnvil.s.sol` → `DeployCore.sol`,
mirrored in `contracts/deployments/anvil.json`) currently stands up, classified against the
then-locked direction (lean Aave-vault platform; legacy alignment-vault/LP + DAO retired). Paths are
under `contracts/src/`. *(Dated-history note, 2026-07-01: the "LP retired" half of this was reversed —
LP vaults are now a first-class family; see the RETIRE section's reversal banner + ADR-0008. DAO
retirement stands.)*

### KEEP — go-forward platform (user- or agent-facing)
| Contract | Path | Role | Key surface (frontend/NOEMA) |
| --- | --- | --- | --- |
| MasterRegistryV1 | `master/MasterRegistryV1.sol` | Phone book: factories, instances, vaults. Registration seam. | `registerInstance(...)`, `getInstanceInfo(instance)`, `getFactoryInfo(id)`; event `CreatorInstanceAdded(creator, instance)` (the profile→collections index) |
| ComponentRegistry | `registry/ComponentRegistry.sol` | Curated allowlist of gating/pricing/deployer modules. | `getApprovedComponentsByTag(tag)`, `isApprovedComponent(c)` |
| **GlobalMessageRegistry** | `registry/GlobalMessageRegistry.sol` | **INVARIANT** — unified message/activity feed, wired into instances. | `post(...)`, `postBatch(...)`; event `MessagePosted(...)` (scope = instance/creator/global) |
| AlignmentRegistryV1 | `master/AlignmentRegistryV1.sol` | Curates alignment **targets** (tithe destinations) + assets. | `getAlignmentTarget(id)`, `getAlignmentTargetAssets(id)`, `isAlignmentTargetActive(id)` |
| FeaturedQueueManager | `master/FeaturedQueueManager.sol` | Paid featured-placement queue (rank decay). | `getFeaturedInstances(a,b)`, `rentFeatured(...)` |
| QueryAggregator | `query/QueryAggregator.sol` | Read-only batch aggregator for cards (registry + queue + instance state), try/catch-tolerant. | `getProjectCard(instance)` + batch reads — the primary discovery read |
| ERC404Factory / ERC1155Factory / ERC721AuctionFactory | `factories/{erc404,erc1155,erc721}/...` | Create collection instances; validate components; register. | `createInstance(...)` (⚠ vault-coupled — see crux) |
| LaunchManager | `factories/erc404/LaunchManager.sol` | ERC404 graduation presets (NICHE/STANDARD/HYPE). Pure config. | preset getters |
| CurveParamsComputer | `factories/erc404/CurveParamsComputer.sol` | Bonding-curve param math (extracted to dodge bytecode bloat). | computed reads |
| DynamicPricingModule | `factories/erc1155/DynamicPricingModule.sol` | Exponential pricing for ERC1155 dynamic editions. | price math |
| PasswordTierGatingModule | `gating/PasswordTierGatingModule.sol` | Password-tier mint gating (singleton, keyed by instance). | gating checks |
| ProtocolTreasuryV1 | `treasury/ProtocolTreasuryV1.sol` | Receives the 1% protocol fee + queue revenue. | `receiveETH()`; **carries leftover `RevenueConductor`/`revenueRouted` refs to delete** |

> Also referenced for whitelist gating: a **Merkle gating** module (`ModuleMerkleGating`) — KEEP as
> the whitelist seam alongside password tiers.

### RETIRE — only the legacy alignment **vault** (the Aave vault replaces it)
> **⚠️ Reversed 2026-07-01 (dated history — this Phase-2 classification is superseded):** the "retire
> the LP alignment vaults, replace with a single Aave vault" call below is **no longer the direction.**
> The current direction is **two vault families, creator's choice** — the LP vaults
> (`UniAlignmentVault` / `ZAMMAlignmentVault` / `CypherAlignmentVault`) are **first-class and NOT
> retired**, alongside the Aave endowment. The code never removed them; they were re-audited this
> cycle and Uni V4 is live on the fork. See [ADR-0008](../decisions/0008-two-vault-families.md) +
> `docs/phases/vault-flavors.md`. The DAO/governance retirement below still holds. The section is kept
> as the dated Phase-2 record.
> **Corrected 2026-06-23 (Mony):** the earlier draft wrongly retired the liquidity deployers/LP
> backends. The **collection's bonding→DEX LP is NECESSARY and stays** — "lean kills the LP *vault*,
> not the LP." Only the alignment-vault contracts retire; everything that builds the collection's
> own market is KEEP.
- **Alignment vaults (RETIRE):** `vaults/uni/UniAlignmentVault*`, `vaults/cypher/CypherAlignmentVault*`,
  `vaults/zamm/ZAMMAlignmentVault*` (+ their factories) — these took the 19% cut and LP'd the
  *alignment* token. Replaced by the **Aave yield vault** (same `IAlignmentVault` seam).
- **DAO/governance (RETIRE):** GrandCentral, Safe/Timelock voting, ShareOffering, RevenueConductor,
  OTC escrow (already zero-addressed in config; see [[dao-is-legacy]]).

### KEEP (corrected) — the collection's own DEX liquidity
- **Liquidity deployers** (`factories/erc404/LiquidityDeployerModule.sol` + cypher/zamm variants) and
  the **ComponentRegistry LP backends** (`ModuleUniV4Deployer`, `ModuleZAMMDeployer`,
  `ModuleCypherDeployer`) = **KEEP** — they deploy the collection token's own DEX LP at graduation
  (the bonding market) and ARE the "liquidity-pool selection" modular feature. They route the 19%
  to whatever vault via `receiveContribution`, so pointing them at the Aave vault needs little/no
  change. The settlement split stays **1% platform / 19% vault / 80% LP** (`RevenueSplitLib`
  unchanged) — only the vault's WITHDRAWAL economics are new.

### UTILITY / UNSURE
- `peripherals/zRouter.sol` (multi-AMM swap util) and `peripherals/UniswapVaultPriceValidator.sol`
  (TWAP guard) — only used by the RETIRE vaults today; keep only if the Aave vault needs swap/oracle
  help (likely not). `test/mocks/MockComponentModule.sol` — testnet wizard stub, replace with
  off-chain metadata.

### 🔴 THE CRUX — vault coupling blocks "create a collection" (gates the wizard)
Every KEEP factory **hard-requires a vault at `createInstance`** — verified:
`ERC404Factory.sol:166-167` reverts `VaultRequired`/`VaultMustBeContract` on a zero/non-contract
vault (ERC1155 `:91-92`, ERC721 `:77-78` identical). Separately, the ERC404 instance also takes a
**`liquidityDeployer`** — a caller-chosen address validated against ComponentRegistry
(`ERC404Factory.sol:180` reverts `UnapprovedLiquidityDeployer`) and baked into the instance at
`initialize(...)` (`:237-239`). That deployer (not the vault) owns the LP wiring + the 1/19/80
split at graduation.
**Consequence (refined 2026-06-23, G-C):** the create path needs an **Aave vault** contract that
(a) passes the `createInstance` vault checks and (b) implements `IAlignmentVault` (`receiveContribution`
+ `alignmentToken` + share tracking) so the EXISTING liquidity deployers route the 19% to it
unchanged. The **deployers/LP backends are KEEP** (they build the collection's own DEX market) — no
new deployer required, contrary to the earlier draft. The settlement split (1/19/80) is unchanged;
the new logic is confined to the **vault's withdrawal economics**. → The wizard (Phase 3) still sits
on the Aave decision (a registerable vault must exist), but the blast radius is the vault contract,
not the deployer pipeline. Read/discovery side has no dependency and is built.

### Metadata — the 3 scopes, as they exist today
| Scope | Stored where | Key | On-chain vs URI |
| --- | --- | --- | --- |
| Account / profile | No on-chain entity — derived from `CreatorInstanceAdded` + `MessagePosted` events; name/bio off-chain | `creator` address | off-chain URI / indexer |
| Collection | `MasterRegistry.instanceInfo[instance].metadataURI` (mandatory at register; creator/owner-updatable) | instance address | **URI** (IPFS/HTTPS) |
| Per-NFT | ERC404: baseURI+tokenId (+ on-chain `styleUri`); ERC1155: `Edition.metadataURI`; ERC721: `_tokenURIs[tokenId]` | tokenId | URI or on-chain |
| (Alignment target) | `AlignmentRegistry.alignmentTargets[id].metadataURI` + assets | targetId | URI |
| (Component) | `ComponentRegistry.componentName[c]` + inline JSON data-URI presets | component addr | data-URI |

**Profile = an address with many instance registrations + an event log; there is no Profile
contract.** Phase 2 metadata design (T2) must decide whether profiles get a first-class on-chain
home or stay event-derived.

### Independent vs gated work (so the build can continue while Aave/metadata are unconfirmed)
- **Independent (build now):** the typed **read** domain layer over KEEP registries —
  enumerate creators→collections (`CreatorInstanceAdded` + `getInstanceInfo`), project cards
  (`QueryAggregator`), the **GlobalMessageRegistry feed** (invariant), and per-instance state reads.
  All verifiable on the fork (empty until seeds, but the pipeline proves out like hello-chain).
- **Gated on G-C (do not build yet):** anything on the **create/write** path — the wizard, factory
  `createInstance` wiring, the Aave vault + its deployer, the metadata write/keying model.

## Exit criteria
1. A written, typed **domain model + API** covering profiles, collections, the 3 metadata scopes,
   modules, and the message system — accepted by the human.
2. Aave vault deployed on the fork with passing Foundry tests for: settlement deposit (19% in),
   yield-withdraw split, principal-withdraw split (80/19/1), and the maturity / early-unlock option.
3. Existing contracts green on the fork with seed scenarios; bug list triaged (blockers vs deferred).

## Verification
- Doc review of the domain/metadata/module specs.
- `forge test` green for the vault; fork deploy + seed run.

## Decision log
- **2026-06-23 — T2 shipped + T5/T6 partial: account scope + backend-free metadata seed.**
  Implemented `ProfileRegistry` (ownerless, non-upgradeable — zero admin surface; every address
  self-edits one `profileURI`) as the on-chain account scope from ADR-0004; built the backend-free
  metadata type layer (lenient parsers + `data:` encode) and the profile UI stack (`ProfileView`,
  `ProfileEditForm`, `/profile` route reading/writing the generated bindings). Added `SeedAnvil.s.sol`
  (anvil-only) standing up 3 featured collections + 2 profiles with inline `data:` JSON/SVG, verified
  on the fork. Read/discovery path remains independent of the (deferred) Aave vault. See [[dev-fork-seed]].
- **2026-06-23 — G-C ratified by Mony (with a correction).** (1) Keep/retire map AGREED — but the
  draft wrongly retired the LP deployers; **corrected**: only the alignment *vaults* retire, the LP
  deployers/backends are KEEP (the collection's bonding→DEX LP is necessary; "lean kills the LP
  vault, not the LP"). (3) Metadata 3-scope model LOCKED — [ADR-0004](../decisions/0004-metadata-model.md): minimal
  on-chain profiles (`address → profileURI`), collection list event-derived, every scope = on-chain
  pointer + decentralized (IPFS/Arweave/data-URI) content → backend-free + feature-rich. (2) Aave vault economics LOCKED — the **endowment model**, full spec in
  [ADR-0003](../decisions/0003-aave-alignment-vault.md): aligned collections are a perpetual
  endowment for their community. Type-specific intake (DN404 19%→vault/80%→LP; mints
  80%→vault/19%→creator); principal refundable (maturity 80 creator / 19 community / 1 platform;
  early 80 community / 19 creator / 1); yield auto-compounds and distributes 80 community / 19
  creator / 1 platform. Inner = Aave `StaticATokenV2` (WETH); outer = custom principal-tracking
  vault implementing `IAlignmentVault` so existing deployers route the cut in unchanged. NOTE: the
  mint (ERC1155/ERC721) settlement allocation changes (80→vault, 19→creator); DN404 intake unchanged.
- **2026-06-22 — T1 inventory complete; keep/retire classified** (see section above; LP-deployer
  line superseded by the 2026-06-23 correction above).
- **2026-06-22 — the crux is vault coupling, not metadata alone.** Factories hard-require a vault at
  `createInstance` and bake in a legacy-coupled liquidity deployer → the create/wizard path is
  gated on the Aave vault + a new Aave-shaped deployer. Read/discovery path is independent → build
  that next.

## Open questions
- Does "alignment target" as a tithe destination need its own onchain registry, or is it a free-form address per collection? *(AlignmentRegistry exists and is KEEP — leaning "reuse it as the tithe-target registry"; confirm in T2/T4.)*
- ~~Can the existing factory express the Aave vault purely through vault-selection, or does the seam need widening?~~ **Resolved (G-C, 2026-06-23): mostly a drop-in.** The existing liquidity deployers stay and route the 19% via `IAlignmentVault.receiveContribution`; the only new contract is the **Aave vault** itself (implements `IAlignmentVault`, registerable via `alignmentToken()` + active target). No new deployer. The settlement split is unchanged; new logic is confined to the vault's withdrawal economics.
