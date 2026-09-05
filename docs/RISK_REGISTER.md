# Risk register

Accepted and controlled risks in the deployed protocol: what the exposure is, what holds it in
check, and what has to be re-read if the control ever moves. A risk belongs here once it has been
audited and a decision has been taken about it — either the exposure is accepted at its current
size, or something in the tree keeps it that size. A defect that is simply going to be fixed does
not belong here; it belongs in a branch.

Entries are appended and never silently rewritten. Changing a control means changing the entry that
names it, in the same commit as the change.

| id | risk | severity | status |
|---|---|---|---|
| [P1-12 / INV-1](#p1-12--inv-1--standing-erc20-allowance-on-the-shared-zrouter) | a standing ERC20 allowance on the shared zRouter is spendable by any caller | low, given the control | controlled |

---

## P1-12 / INV-1 — standing ERC20 allowance on the shared zRouter

**The exposure.** Both alignment vault families sell collected fee tokens for ETH through zRouter,
a shared and permissionless router. Every one of its swap legs pulls the input token with
`transferFrom(payer, …)`, so a vault must grant it an ERC20 allowance to be sold at all. Any
allowance left standing on that router after the swap is a claim on vault-held tokens that any
subsequent caller can spend through any route they can construct — the vault has no say in who
spends it or at what price. The two shapes that would create such a claim are an unbounded
approval (`type(uint256).max`, the common idiom) and an approval whose swap happens in a later
transaction.

**Severity: low, and low *because of* the control below, not on its own merits.** Nothing in the
tree grants either shape today, so the live exposure is nil. Were one introduced, the amount at
risk would be whatever fee tokens the vault holds at the moment someone noticed — real value, but
bounded by the vault's fee balance rather than by principal, which is held as LP rather than as a
loose token balance.

**The control.** The invariant, stated in full with its call-site audit in
[`contracts/docs/spec/ZROUTER_AMOUNTLIMIT.md`](../contracts/docs/spec/ZROUTER_AMOUNTLIMIT.md) §4:

> **INV-1.** Every approval granted to zRouter is sized to the exact amount that same transaction's
> swap will pull, and is fully consumed before the transaction ends.

`contracts/scripts/zrouter-approval-gate.sh` enforces it over `src/` and `script/` on every CI run
(`.github/workflows/contracts-ci.yml`, "zRouter allowance gate (INV-1)"). It fails on an unbounded
allowance, on one whose value is not among the arguments of the swap it guards, on an approval with
no zRouter swap after it in the same function, and on an approval paired with an exact-out leg —
exact-out being refused outright because the router does not pull `swapAmount` on that path. The
step runs `--self-test` first, against one fixture per shape, so a gate that stopped detecting
something reds the build instead of passing quietly.

**Verified at.** The two allowance sites are `UniAlignmentVault._convertVaultFeesToEth`
(`contracts/src/vaults/uni/UniAlignmentVault.sol:568`) and `ZAMMAlignmentVault._removeFeeLP`
(`contracts/src/vaults/zamm/ZAMMAlignmentVault.sol:472`). Both approve exactly the amount their own
swap consumes, in the same call. The `BestRouteAcquirer` legs pay native ETH and grant no allowance
at all.

**What the control does not cover.** The gate is lexical. It reads an approval and the swap that
follows it in the same function body, and it does not follow a value through a helper, an assembly
block, or a low-level `call`. It also does not read the frontend: the swap panels approve zRouter
from the *user's* wallet, and that allowance is the user's exposure, not the protocol's, governed by
whatever those panels choose to request.

**Re-read this entry if:** a vault gains a swap path that pays in ERC20 rather than ETH; any call
site adopts an exact-out leg; a swap moves behind a helper the gate cannot see through; or the
vendored `src/peripherals/zRouter.sol` is replaced, since the pull semantics audited above are read
from that file and have never been diffed against the deployed router's bytecode.
