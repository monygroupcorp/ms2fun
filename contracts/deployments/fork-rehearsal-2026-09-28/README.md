# Sepolia fork rehearsal — 2026-09-28

Artifacts from the §4 fork rehearsal on the merged tree at 70864997. Kept as the
record of that run; nothing here describes the live network.

Every address below the six registry proxies is fork-ephemeral. The registries
themselves are CREATE3 addresses and are the same on any chain, which is exactly
why a fork record and a live record cannot be told apart by shape alone.

`local-deployment.sepolia.json` is the copy that was in `app/src/config/`. It
carries no `forkRehearsal` stamp — the guard that protects the other three files
does not cover it — so it was reverted to its committed all-zero state rather
than left in the app's config directory.
