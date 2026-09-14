# Cases for `zrouter-approval-gate.sh --self-test`

Each file is a minimal contract carrying exactly one approval shape. `ok-*.sol` must pass the gate
and `bad-*.sol` must fail it; the self-test asserts both directions, so a gate that silently stopped
detecting a shape turns the CI step red instead of going quiet.

These are fixtures for a lexical scanner, not a compile target. They live under `scripts/` rather
than `src/` or `test/` precisely so `forge build`, `forge fmt` and `forge test` never see them --
`bad-unbounded.sol` grants an unlimited allowance to a router on purpose, and it must not be
mistakable for a contract this project deploys.
