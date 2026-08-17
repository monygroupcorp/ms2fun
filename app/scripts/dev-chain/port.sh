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
