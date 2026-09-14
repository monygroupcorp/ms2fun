#!/usr/bin/env bash
# Clone the pinned dependency set into contracts/lib.
#
# Usage (run from contracts/):
#   ./scripts/install-libs.sh          # everything src/, test/ and script/ need
#   ./scripts/install-libs.sh src      # only what compiling src/ needs
#
# contracts/lib is gitignored and carries no submodule gitlinks, so a fresh checkout has no
# dependency source and every CI job has to clone it. The revisions come from scripts/lib-pins.txt
# and nothing here supplies a default: an entry with no commit is a hard error rather than a
# silent fall back to the dependency's default branch, which is the failure this script exists to
# make impossible.
#
# Two forge flags carry weight:
#   --no-git   clone the sources only. Without it `forge install` registers each dependency as a
#              submodule of the *repository* root -- it writes 13 entries into the repo's
#              top-level .gitmodules and stages 13 gitlinks under contracts/lib, a path
#              .gitignore says is never tracked. Harmless in a throwaway CI checkout, but this
#              script also runs in real checkouts, and there it leaves exactly the staged
#              gitlinks that a later `git commit -a` would publish.
#   @rev=      pin by commit explicitly. A bare `@<sha>` is resolved as a branch, tag or commit,
#              so an upstream branch or tag named like our hex string could shadow the commit;
#              `@rev=` accepts nothing but the commit.
set -euo pipefail

scope="${1:-all}"
case "$scope" in
  src | all) ;;
  *)
    echo "usage: $0 [src|all]" >&2
    exit 2
    ;;
esac

# Resolved from this script's own location, so the destination is contracts/lib no matter where
# the caller stands. Without --root, forge takes the enclosing *git repository* root as the project
# root, which for this repo is one level above contracts/.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
pins="$root/scripts/lib-pins.txt"

specs=()
targets=()
lineno=0
while IFS= read -r line; do
  lineno=$((lineno + 1))
  line="${line%%#*}"
  read -r entry_scope repo rev extra <<<"$line" || true
  if [ -z "${entry_scope:-}" ]; then continue; fi

  case "$entry_scope" in
    src | test) ;;
    *)
      echo "$pins:$lineno: scope must be 'src' or 'test', got '$entry_scope'" >&2
      exit 1
      ;;
  esac
  if [ -z "${repo:-}" ] || [ -z "${rev:-}" ] || [ -n "${extra:-}" ]; then
    echo "$pins:$lineno: expected '<scope> <owner/repo> <commit>'" >&2
    exit 1
  fi
  if [[ ! $rev =~ ^[0-9a-f]{40}$ ]]; then
    echo "$pins:$lineno: $repo is pinned to '$rev', which is not a full 40-character commit" >&2
    exit 1
  fi

  # A src-only build must not pull the test/script-only dependencies; see lib-pins.txt.
  if [ "$scope" = src ] && [ "$entry_scope" != src ]; then
    continue
  fi

  specs+=("$repo@rev=$rev")
  targets+=("$root/lib/${repo#*/}")
done <"$pins"

if [ ${#specs[@]} -eq 0 ]; then
  echo "$pins: no dependencies in scope '$scope'" >&2
  exit 1
fi

# Refuse to run over an existing lib/. Cloned without git metadata, an installed dependency
# carries no record of the revision it holds, so a directory that is already there cannot be
# checked against its pin -- and forge would abort partway through anyway, leaving some
# dependencies at the new pins and some at whatever was there before. Say what to remove instead.
present=()
for target in "${targets[@]}"; do
  if [ -e "$target" ]; then
    present+=("$target")
  fi
done
if [ ${#present[@]} -gt 0 ]; then
  {
    echo "already installed, and an installed dependency does not record its revision:"
    printf '  %s\n' "${present[@]}"
    echo "remove them and re-run, or remove $root/lib entirely for a clean set."
  } >&2
  exit 1
fi

forge install --root "$root" --no-git "${specs[@]}"
