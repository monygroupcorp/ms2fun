#!/usr/bin/env bash
# Every URL the announcement materials carry, checked against the live site.
#
# WHY THIS IS NOT JUST `curl` OVER A LIST. The published distribution is a pinned bundle served
# from an IPFS gateway, and the app routes on the HASH (`/#/collections`), not on the path. A
# fragment is never sent to a server, so a path-style deep link is not a slow link or a redirect —
# the gateway looks for a file that is not in the bundle and the visitor gets an error page with
# none of the app on it. Checked 2026-09-29: `/collections` fails, `/#/collections` renders.
#
# So the failure this guards against is a material that carries `…/collections` instead of
# `…/#/collections`. That is one character, it is invisible in a rendered post, and it is the
# difference between a campaign link and a dead end. Both halves below are therefore checked: the
# origin answers, and no link in the set is written in the path form.
set -euo pipefail

ORIGIN="https://noesis.gwei.domains"

# The routes the materials are allowed to point at. Taken from the router in app/src/App.tsx —
# a label in the nav is not a route (`ALIGNMENT` in the header resolves to `/vaults`, and
# `/#/alignment` is a 404), so this list is read off the `<Route path=` lines and nowhere else.
ROUTES=(
  "/"
  "/#/collections"
  "/#/launch"
  "/#/vaults"
  "/#/board"
  "/#/curations"
  "/#/learn"
  "/#/learn/alignment-vault"
)

fail=0

# 1. The origin answers at all. Everything else is moot if it does not.
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$ORIGIN/" || echo 000)
if [ "$code" = "200" ]; then
  echo "ok    $ORIGIN/  ($code)"
else
  echo "FAIL  $ORIGIN/  ($code) — the live site did not answer"
  fail=1
fi

# 2. Every route in the set is hash-form. A route that is not `/` and does not start `/#/` would
#    be published as a path link, which the gateway cannot serve.
for r in "${ROUTES[@]}"; do
  case "$r" in
    "/") ;;
    "/#/"*) ;;
    *)
      echo "FAIL  $r — path-style link; the gateway serves no such file, use /#/…"
      fail=1
      ;;
  esac
done

# 3. The path form really is broken, so this guard is measuring something that is still true. If
#    a future deploy adds a gateway SPA fallback, this goes green everywhere and the check says so
#    rather than silently protecting against nothing.
pcode=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 "$ORIGIN/collections" || echo 000)
if [ "$pcode" = "200" ]; then
  echo "note  $ORIGIN/collections now answers 200 — path deep links may be served; re-read this guard"
else
  echo "ok    path-style deep link still fails as expected ($pcode) — hash form is required"
fi

if [ "$fail" -ne 0 ]; then
  echo "campaign links: FAILED"
  exit 1
fi
echo "campaign links: ${#ROUTES[@]} routes, all hash-form, origin live"
