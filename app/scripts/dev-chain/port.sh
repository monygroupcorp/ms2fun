# Shared port-ownership probe for fork.sh / stop.sh. Sourced, not executed.
#
# port_holder_pid <port>
#   Prints the pid holding <port> on stdout and returns an explicit three-valued exit code:
#     0 + pid on stdout  — port held, holder identified
#     1 + no output      — port verifiably free (a probe ran and found nothing)
#     2 + no output       — UNKNOWN: no probe tool is installed
#   Probe order, first available wins: lsof -> ss -> fuser. Availability is decided with
#   `command -v`, never by running the tool and reading its exit code — an absent binary and a
#   "nothing on the port" answer must not look alike. Takes the first pid when a probe reports
#   several, matching the previous `| head -n1` behaviour.
#
# DEV_CHAIN_PORT_PROBE overrides the probe order for testing (space-separated subset of
# "lsof ss fuser"); unset/empty uses the default order above.

port_holder_pid() {
  local port="$1"
  local probes="${DEV_CHAIN_PORT_PROBE:-lsof ss fuser}"
  local probe

  for probe in $probes; do
    case "$probe" in
      lsof)
        if command -v lsof >/dev/null 2>&1; then
          local pid
          pid="$(lsof -ti:"$port" 2>/dev/null | head -n1)"
          if [ -n "$pid" ]; then
            echo "$pid"
            return 0
          fi
          return 1
        fi
        ;;
      ss)
        if command -v ss >/dev/null 2>&1; then
          local line pid
          line="$(ss -ltnpH "sport = :$port" 2>/dev/null | head -n1)"
          if [ -n "$line" ]; then
            pid="$(printf '%s' "$line" | grep -oP 'pid=\K[0-9]+' | head -n1)"
            if [ -n "$pid" ]; then
              echo "$pid"
              return 0
            fi
          fi
          return 1
        fi
        ;;
      fuser)
        if command -v fuser >/dev/null 2>&1; then
          local pid
          pid="$(fuser -n tcp "$port" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' | head -n1)"
          if [ -n "$pid" ]; then
            echo "$pid"
            return 0
          fi
          return 1
        fi
        ;;
    esac
  done

  # No probe tool available.
  return 2
}

# dev_chain_port
#   Resolves the mainnet dev channel's port from ANVIL_PORT, defaulting to 8545. An unset or empty
#   ANVIL_PORT yields exactly the historical port, so the default loop is unchanged. A value that is
#   not a decimal port number is refused rather than handed to anvil, which would otherwise fail
#   later and less legibly. Prints the port on stdout; returns 1 with a message on stderr if invalid.
dev_chain_port() {
  local port="${ANVIL_PORT:-8545}"

  case "$port" in
    '' | *[!0-9]*)
      echo "❌ ANVIL_PORT must be a port number, got '$port'" >&2
      return 1
      ;;
  esac
  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo "❌ ANVIL_PORT must be between 1 and 65535, got '$port'" >&2
    return 1
  fi

  echo "$port"
}

# dev_chain_pid_file <repo_root> <port>
#   The ownership record for the mainnet channel at <port>. At the default port this is the
#   historical `/.anvil.pid` verbatim, so nothing about the untouched loop moves. An overridden port
#   gets its own file under the already-ignored `.cache/`, because one fixed path shared by two
#   ports would let the second fork overwrite the first's record and orphan it — and the refusal in
#   fork.sh/stop.sh is only as good as the record it compares against.
dev_chain_pid_file() {
  local repo_root="$1" port="$2"

  if [ "$port" = "8545" ]; then
    echo "$repo_root/.anvil.pid"
  else
    echo "$repo_root/.cache/anvil-$port.pid"
  fi
}
