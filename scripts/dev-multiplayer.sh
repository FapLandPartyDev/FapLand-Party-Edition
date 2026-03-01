#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ELECTRON_BIN="$ROOT_DIR/node_modules/.bin/electron"
VITE_BIN="$ROOT_DIR/node_modules/.bin/vite"
REQUESTED_PORT="${FLAND_MP_PORT:-3000}"
MAX_PORT_SCAN="${FLAND_MP_MAX_PORT_SCAN:-100}"
DEV_LAUNCHER=()

is_port_free() {
  local port="$1"
  node -e '
    const net = require("node:net");
    const port = Number(process.argv[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65535) process.exit(2);
    const hosts = ["127.0.0.1", "::1"];
    let index = 0;

    const tryNext = () => {
      if (index >= hosts.length) {
        process.exit(0);
      }

      const host = hosts[index++];
      const server = net.createServer();
      server.unref();
      server.once("error", (error) => {
        const code = error && typeof error === "object" ? error.code : "";
        // Skip unavailable address families, but fail for "in use" and other errors.
        if (code === "EADDRNOTAVAIL" || code === "EAFNOSUPPORT") {
          tryNext();
          return;
        }
        process.exit(1);
      });
      server.listen({ host, port, exclusive: true }, () => {
        server.close(() => tryNext());
      });
    };

    tryNext();
  ' "$port" >/dev/null 2>&1
}

find_free_port() {
  local start_port="$1"
  local max_scan="$2"
  local port="$start_port"

  for ((i = 0; i <= max_scan; i++)); do
    if is_port_free "$port"; then
      echo "$port"
      return 0
    fi
    port=$((port + 1))
  done

  return 1
}
if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "Electron binary not found at $ELECTRON_BIN. Run npm install first." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required to probe free ports." >&2
  exit 1
fi

DEV_PORT="$(find_free_port "$REQUESTED_PORT" "$MAX_PORT_SCAN")" || {
  echo "No free port found between $REQUESTED_PORT and $((REQUESTED_PORT + MAX_PORT_SCAN))." >&2
  exit 1
}
DEV_SERVER_URL="http://127.0.0.1:${DEV_PORT}"

if [[ "$DEV_PORT" != "$REQUESTED_PORT" ]]; then
  echo "Port $REQUESTED_PORT is in use; using $DEV_PORT instead."
fi

if command -v npm >/dev/null 2>&1; then
  DEV_LAUNCHER=(npm run dev -- --port "$DEV_PORT" --strictPort)
elif [[ -x "$VITE_BIN" ]]; then
  DEV_LAUNCHER=("$VITE_BIN" --port "$DEV_PORT" --strictPort)
else
  echo "Vite binary not found at $VITE_BIN. Run npm install first." >&2
  exit 1
fi

cleanup() {
  if [[ -n "${SECOND_PID:-}" ]] && kill -0 "$SECOND_PID" 2>/dev/null; then
    kill "$SECOND_PID" 2>/dev/null || true
  fi

  if [[ -n "${VITE_PID:-}" ]] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Starting primary dev instance (profile: mp1)..."
FLAND_USER_DATA_SUFFIX=mp1 "${DEV_LAUNCHER[@]}" &
VITE_PID=$!

echo "Waiting for Electron build output..."
for _ in {1..120}; do
  if [[ -f "$ROOT_DIR/dist-electron/main.js" ]]; then
    break
  fi
  sleep 0.5
done

if [[ ! -f "$ROOT_DIR/dist-electron/main.js" ]]; then
  echo "Timed out waiting for dist-electron/main.js from vite." >&2
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  echo "Waiting for Vite dev server on ${DEV_SERVER_URL}..."
  for _ in {1..120}; do
    if curl --silent --fail --output /dev/null "${DEV_SERVER_URL}"; then
      break
    fi
    sleep 0.5
  done
fi

echo "Starting secondary dev instance (profile: mp2)..."
FLAND_USER_DATA_SUFFIX=mp2 VITE_DEV_SERVER_URL="${DEV_SERVER_URL}" "$ELECTRON_BIN" "$ROOT_DIR/dist-electron/main.js" &
SECOND_PID=$!

echo "Two multiplayer test instances are running. Press Ctrl+C to stop both."
wait "$VITE_PID"
