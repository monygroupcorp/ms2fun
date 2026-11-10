# hunt/endowment notes

claim: after an ambassador `execute` drains most of the corpus, a T4 who deposits right after, then
calls `harvest` + `claimYieldPurse` once Aave yield accrues, earns creator yield at a per-wei rate
above the earlier benefactors' rate on their remaining principal — i.e. steals yield from before them.
trust level crossed: T4 (anyone can deposit and harvest; the execute is setup by T3).
steps: alice+bob deposit 10 ETH each -> ambassador executes 18 ETH (principal 20->2, price/share 0.1)
-> carol (T4) deposits 2 ETH, minting 20e18 shares -> simulateYield(+2 ETH) -> harvest -> claims.
impact: none — defended. Carol gets 0.8 ETH on 2 ETH (40%), alice+bob get 0.8 ETH on 2 ETH remaining
principal (40%): identical rates. Shares mint as `amount * shares / principal`, exactly pro-rata to
the sliver, so the join-time crystallize plus pro-rata minting makes the yield rate match the honest
rate to division dust.
test name: test_Defended_lateJoinerYieldRateMatchesPrincipal — defended.
