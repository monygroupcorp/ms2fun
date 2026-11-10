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


claim: the new `approvedDeployer` bypass in `receivePOL` keys the position by the caller-supplied
`instance` argument, so a T2 registered instance can call `receivePOL` for ITSELF with a 1-wei dust
escrow before graduation; the slot then permanently reads `POLAlreadyDeployed`, and the graduation
venue's module (the approved deployer) can never stand up the protocol's POL position for that
instance — `LiquidityDeployerModule._fundProtocolOwnedLiquidity` makes that call WITHOUT try/catch.
trust level crossed: T2 (the instance itself; setup uses owner to configure + seat the deployer).
steps: owner wires POL + approvedDeployer -> instance self-funds POL slot with 1 wei/leg -> graduation:
module brings the 1 ETH protocol fee leg -> receivePOL reverts POLAlreadyDeployed, fee leg stays out.
impact: protocol-owned LP is locked out per-instance for the instance's whole life (only an owner
withdrawPOL of the attacker's dust frees the slot; the owner gate `setApprovedDeployer` is T0 and
unrelated). No attacker profit; the harm is protocol capital denied deployment + a hard revert in the
graduation payout path.
test name: test_lateJoinDustSealsInstancePolSlotAgainstProtocolFunding — attack (PASS).
