# hunt/liquidity notes

## Hypothesis 1 — skewed pre-init bricks graduation (ATTACK, not defended)
- claim: a T4 who computes the graduation pool key (public inputs: ETH+token currencies, immutable
  fee/tickSpacing, hooks=0 while alignmentHookFactory is unset) and initializes it at a price outside
  MAX_INIT_PRICE_DEVIATION_BPS permanently bricks that launch's graduation; every retry reverts
  PoolPriceMismatch and the 25-ETH raise stays trapped at the instance.
- trust level crossed: T4 (anyone; no owner/factory prank even in setup beyond funding the instance).
- steps: predict key -> vm.prank(mallory) initialize at 3x sqrtPrice (price x9) -> graduate x3,
  each reverts PoolPriceMismatch -> assert live price unchanged and balances stuck.
- impact: per-launch permanent graduation DoS at zero capital cost (v4 init needs no liquidity);
  bonding buyers' ETH and the whole 80/19/1 rail payout are frozen; within-tolerance seeding is
  defended (residue returns, GraduationLpResidue), the extreme case has no recovery path.
- test: test_T4_preInitSkewedPrice_bricksGraduationForever (PASS) + test_control_freshPoolGraduates.
  File: SkewedPoolInitBricksGraduation.t.sol
