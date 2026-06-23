# Phase 2 — Reconciliation: the API + the Crux

**Status:** Not started
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
- [ ] T2 — Metadata model design (3 scopes) → written spec + types.
- [ ] T3 — Module option schema design → written spec + types.
- [ ] T4 — Aave vault: select base, implement 20/20/1 + maturity, Foundry tests.
- [ ] T5 — Typed domain layer over bindings (profiles/collections/metadata/modules/messages).
- [ ] T6 — Deploy the reconciled set + Aave vault to the fork via the existing pipeline + seeds.

## T1 — Inventory & classification (2026-06-22)

Read-only survey of the contracts the local deploy (`DeployAnvil.s.sol` → `DeployCore.sol`,
mirrored in `contracts/deployments/anvil.json`) currently stands up, classified against the locked
direction (lean Aave-vault platform; legacy alignment-vault/LP + DAO retired). Paths are under
`contracts/src/`.

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

### RETIRE — legacy alignment-vault + LP model (hide from UI; remove from the go-forward deploy)
- **Vaults:** `vaults/uni/UniAlignmentVault*`, `vaults/cypher/CypherAlignmentVault*`,
  `vaults/zamm/ZAMMAlignmentVault*` (+ their factories) — Uniswap-V4 / Algebra / ZAMM LP vaults.
- **Liquidity deployers:** `factories/erc404/LiquidityDeployerModule.sol`,
  `factories/erc404cypher/CypherLiquidityDeployerModule.sol`,
  `factories/erc404zamm/ZAMMLiquidityDeployerModule.sol` — each hard-wired to one vault type; carry
  the 1%/19%/80% split (`RevenueSplitLib`).
- **Deployer modules in ComponentRegistry:** `ModuleUniV4Deployer`, `ModuleZAMMDeployer`,
  `ModuleCypherDeployer` — selectable LP backends being killed.
- **DAO/governance:** GrandCentral, Safe/Timelock voting, ShareOffering, RevenueConductor, OTC
  escrow (already zero-addressed in config; see [[dao-is-legacy]]).

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
split at graduation, and the only approved deployers today are the *legacy* Uni/ZAMM/Cypher ones.
**Consequence:** the go-forward create path needs BOTH (a) an **Aave vault** contract that passes
the vault checks AND (b) a new **Aave-shaped deployer/settlement module approved in
ComponentRegistry** (the legacy split is wrong for the new model). → This is the dependency that
puts the **wizard (Phase 3) on top of the Aave decision (G-C)**. The **read/discovery side has no
such dependency** and is buildable now.
*(Answers this doc's open question #2: the seam needs a new approved deployer + Aave vault, not
just picking a vault in the existing selector.)*

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
2. Aave vault deployed on the fork with passing Foundry tests for the 20/20/1 (+maturity) logic.
3. Existing contracts green on the fork with seed scenarios; bug list triaged (blockers vs deferred).

## Verification
- Doc review of the domain/metadata/module specs.
- `forge test` green for the vault; fork deploy + seed run.

## Decision log
- **2026-06-22 — T1 inventory complete; keep/retire classified** (see section above). KEEP = the
  registries, message system, factories, gating (password + merkle), launch/curve/pricing config,
  treasury. RETIRE = all alignment vaults + their factories + liquidity deployers (Uni/ZAMM/Cypher)
  + the 1/19/80 split + DAO. Surfaced to [[../HUMAN_GATES.md]] G-C for ratification.
- **2026-06-22 — the crux is vault coupling, not metadata alone.** Factories hard-require a vault at
  `createInstance` and bake in a legacy-coupled liquidity deployer → the create/wizard path is
  gated on the Aave vault + a new Aave-shaped deployer. Read/discovery path is independent → build
  that next.

## Open questions
- Does "alignment target" as a tithe destination need its own onchain registry, or is it a free-form address per collection? *(AlignmentRegistry exists and is KEEP — leaning "reuse it as the tithe-target registry"; confirm in T2/T4.)*
- ~~Can the existing factory express the Aave vault purely through vault-selection, or does the seam need widening?~~ **Resolved (T1): the seam needs widening** — a new Aave-shaped liquidity/settlement deployer is required (instances bake in a vault-type-specific deployer at construction; vault is mandatory at `createInstance`). Not a drop-in via vault-selection alone.
