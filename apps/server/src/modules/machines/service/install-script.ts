import { RUNNER_BUNDLE_PATH, RUNNER_PTY_PATH, RUNNER_SHA256_HEADER } from '@mwc/shared/runner-protocol';

/**
 * The installer a machine runs (`GET /api/runner/install.sh`, docs/machines.md "Installing a runner"), a POSIX shell
 * script: Node 22 or newer, the runner bundle downloaded to a temporary folder, its SHA-256 checked against the
 * server's header (by Node, so macOS and Linux check alike), the terminal's PTY for this system downloaded, checked the
 * same way and unpacked beside it (without it, or without `tar`, the runner installs with no terminal; one that does not
 * match its SHA-256 stops the install), then `node runner.mjs install` with the script's own arguments. Everything is in functions called on the last line, so nothing runs before `curl … | sh` has delivered the
 * whole script, and nothing reads the script's standard input. The same text for every machine: the server and the
 * token come as arguments, and `--via`, when given, is the address the downloads (and the runner's enroll) use instead
 * of `--server`, which stays the address the runner keeps.
 */

/** Node's check of the bundle against the SHA-256 header (`node -e`; no single quotes, the shell quotes it). */
const VERIFY_JS = `
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const [file, headers] = process.argv.slice(1);
const what = path.basename(file);
const name = "${RUNNER_SHA256_HEADER}:";
const line = fs.readFileSync(headers, "utf8").split("\\n").reverse().find((l) => l.toLowerCase().startsWith(name));
const expected = line ? line.slice(name.length).trim() : "";
const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
if (!expected) {
  console.error("mwc-runner install: the server sent no SHA-256 for " + what);
  process.exit(1);
}
if (actual !== expected) {
  console.error("mwc-runner install: " + what + " does not match its SHA-256 (" + actual + ", expected " + expected + ")");
  process.exit(1);
}
`;

export const INSTALL_SCRIPT = `#!/bin/sh
# Installs the Most Wanted Corp runner on this machine (docs/machines.md, "Installing a runner"):
#
#   curl -fsSL <server>/api/runner/install.sh | sh -s -- --server <server> --token mwc_et_...
#
# --via <url> (optional) is the address this install reaches the server at, when it is not --server: the downloads and
# the enroll go through it, and the runner keeps --server (the Airia devbox installs through its own forwarded port).
#
# It needs Node.js 22 or newer and curl. It downloads the runner (one JavaScript file) from the server, checks its
# SHA-256, downloads the terminal's PTY for this system (checked the same way, unpacked with tar beside the runner) and
# runs "node runner.mjs install" with the same arguments: the machine is enrolled with the one-time token, the runner
# and its PTY copied to ~/.local/share/mwc-runner and started as a service (a launchd agent on macOS, a systemd user
# unit on Linux).
set -eu

fail() {
  printf 'mwc-runner install: %s\\n' "$*" >&2
  exit 1
}

# The value of --NAME URL or --NAME=URL ($1 is NAME) among the other arguments.
option_of() {
  option="--$1"
  shift
  previous=''
  for argument in "$@"; do
    case $argument in
      "$option"=*)
        printf '%s' "\${argument#"$option"=}"
        return
        ;;
    esac
    if [ "$previous" = "$option" ]; then
      printf '%s' "$argument"
      return
    fi
    previous=$argument
  done
}

# Checks a downloaded file ($1) against the SHA-256 in its response headers ($2).
verify() {
  node -e '${VERIFY_JS}' "$1" "$2"
}

# The terminal's PTY for this system (prebuilt node-pty), checked like the runner and unpacked beside it as
# node_modules/; without it the runner installs and works, with no terminal.
fetch_pty() {
  target=$(node -p 'process.platform + "-" + process.arch')
  if ! command -v tar >/dev/null 2>&1; then
    printf 'mwc-runner install: tar is needed for the terminal; installing without it\\n' >&2
    return 0
  fi
  if ! curl -fsSL -D "$dir/pty-headers" -o "$dir/pty.tgz" "$from${RUNNER_PTY_PATH}/$target.tgz"; then
    printf 'mwc-runner install: no terminal for %s from %s; installing without it\\n' "$target" "$from" >&2
    return 0
  fi
  verify "$dir/pty.tgz" "$dir/pty-headers"
  tar -xzf "$dir/pty.tgz" -C "$dir" || fail 'cannot unpack the terminal'
}

main() {
  server=$(option_of server "$@")
  [ -n "$server" ] ||
    fail 'usage: sh install.sh --server <url> [--via <url>] --token <mwc_et_...> [--name <name>] [--slots <n>] [--force]'
  server=\${server%/}
  via=$(option_of via "$@")
  from=\${via%/}
  from=\${from:-$server}
  command -v node >/dev/null 2>&1 || fail 'Node.js 22 or newer is needed, and node is not on the PATH'
  node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' ||
    fail "Node.js 22 or newer is needed; this is $(node --version)"
  command -v curl >/dev/null 2>&1 || fail 'curl is needed to download the runner'
  dir=$(mktemp -d)
  trap 'rm -rf "$dir"' EXIT
  curl -fsSL -D "$dir/headers" -o "$dir/runner.mjs" "$from${RUNNER_BUNDLE_PATH}" ||
    fail "cannot download the runner from $from"
  verify "$dir/runner.mjs" "$dir/headers"
  fetch_pty
  node "$dir/runner.mjs" install "$@" </dev/null
}

main "$@"
`;
