# hunt/bonding notes

claim: buy/sell paths floor at supply/normalizationFactor separately, so split small buys plus one
  sell refund more ETH than paid, draining shared reserve
trust level crossed: T4 (permissionless trader; owner only used in setup)
steps: honest T4 buys to supply 3 units above a bucket boundary deep on the curve; attacker splits
  ~50k buckets across 4 buys with boundary-misaligning offsets, then sells the whole lot once
impact: none — floor telescopes, gross refund == gross cost exactly, attacker loses exactly the
  1% sell fee and reserve is unchanged end to end
test: test_Defended_BuySellRoundTripLeaksNoRounding — defended
