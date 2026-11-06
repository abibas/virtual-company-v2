import { RUNNER_BUNDLE_PATH, RUNNER_SHA256_HEADER } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { INSTALL_SCRIPT } from '../../../../src/modules/machines/service/install-script.ts';

/**
 * The installer is checked by reading it, never by running it here (it would enroll and install a service). These
 * tests pin what it must do and that it stays POSIX sh.
 */

const lines = INSTALL_SCRIPT.split('\n');
/** The script without its comments, where the checks below look for commands. */
const code = lines.filter((line) => !line.trimStart().startsWith('#')).join('\n');

describe('the runner installer', () => {
  it('is a POSIX sh script that stops at the first failure and at an unset variable', () => {
    expect(lines[0]).toBe('#!/bin/sh');
    expect(code).toMatch(/^set -eu$/m);
    // No bash-only syntax: [[ ]], arrays, `function`, `local`, `source`, $'…' strings, `==` in a test.
    for (const bashism of [
      '[[',
      'function ',
      'local ',
      'source ',
      "$'",
      ' == ',
      'declare ',
      '<<<',
      'pipefail',
    ]) {
      expect(code, bashism).not.toContain(bashism);
    }
  });

  it('runs nothing before the whole script has arrived: all in functions, main called on the last line', () => {
    expect(lines.filter((line) => line !== '').at(-1)).toBe('main "$@"');
    expect(code).toMatch(/^main\(\) \{$/m);
    expect(code.match(/^[a-z_]+\(\) \{$/gm)).toEqual(['fail() {', 'server_of() {', 'verify() {', 'main() {']);
  });

  it('takes the server from --server URL or --server=URL, and needs it', () => {
    expect(code).toContain('--server=*)');
    expect(code).toContain(`printf '%s' "\${argument#--server=}"`);
    expect(code).toContain('if [ "$previous" = \'--server\' ]; then');
    expect(code).toContain(
      '[ -n "$server" ] || fail \'usage: sh install.sh --server <url> --token <mwc_et_...>',
    );
    expect(code).toContain(`server=\${server%/}`);
  });

  it('needs Node 22 or newer and curl', () => {
    expect(code).toContain('command -v node >/dev/null 2>&1 ||');
    expect(code).toContain(
      `node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' ||`,
    );
    expect(code).toContain('command -v curl >/dev/null 2>&1 ||');
  });

  it('downloads the bundle to a temporary folder it removes, with the response headers', () => {
    expect(code).toContain('dir=$(mktemp -d)');
    expect(code).toContain(`trap 'rm -rf "$dir"' EXIT`);
    expect(code).toContain(
      `curl -fsSL -D "$dir/headers" -o "$dir/runner.mjs" "$server${RUNNER_BUNDLE_PATH}" ||`,
    );
  });

  it("checks the bundle's SHA-256 against the server's header before running it", () => {
    const verify = code.indexOf('verify "$dir/runner.mjs" "$dir/headers"');
    const install = code.indexOf('node "$dir/runner.mjs" install "$@" </dev/null');
    expect(verify).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(verify);
    expect(code).toContain(`const name = "${RUNNER_SHA256_HEADER}:";`);
    expect(code).toContain('crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")');
    expect(code).toContain('if (actual !== expected) {');
    expect(code).toContain('if (!expected) {');
    // The Node check is one single-quoted shell word: it holds no single quote of its own.
    const js = code.slice(code.indexOf("node -e '\n") + 9, code.indexOf('\' "$1" "$2"'));
    expect(js).toContain('process.exit(1)');
    expect(js).not.toContain("'");
  });
});
