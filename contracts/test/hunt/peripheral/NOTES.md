# hunt/peripheral notes

claim: a T4 pool hook whose beforeSwap re-enters AlignmentHookSwapRouter.swap on the same router, mid-unlock, cannot have its nested swap's ETH leg settled out of the outer victim's held msg.value (or have the victim's change redirected) — the pool manager's transient AlreadyUnlocked lock spans the whole outer unlock, so the nested unlock reverts and the router never holds a second caller's value.
trust level crossed: T4 (anyone; the hook is chosen by graduating a collection into that pool shape).
steps: 1) victim calls router.swap{value: 1 ether} on the hooked pool; 2) hook.beforeSwap re-enters router.swap{value: 0.01 ether} for itself; 3) nested unlock hits AlreadyUnlocked, hook's catch swallows it; 4) outer swap settles normally and refunds only the victim's own change.
impact: none as shipped — defended. Victim loses exactly its own named 1 ETH, router keeps nothing, hook gains nothing.
test name: test_Defended_HookReentryCannotSettleEthLegFromOuterMsgValue — PASS, defended.

victim choice that made the attack plausible: the victim had to trade through a graduated pool whose mined hook is the attacker's contract — the app routes hooked-ETH/token pools through exactly this router, and any collection's graduation can mine a hook that re-enters.
run note: drives v4-core's real PoolManager (exact pragma =0.8.26), so it compiles only under FOUNDRY_CONFIG=foundry.v4.toml, the same way test/hooks/UniAlignmentV4Hook_RealSettlement.t.sol runs. scripts/real-v4-gate.sh keeps its RUN table in one place; adding this path there (or an explicit non-run record) is the captain's call, not touched by this hunt.
