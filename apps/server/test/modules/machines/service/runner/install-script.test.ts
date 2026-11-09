import { execFileSync } from 'node:child_process';
import { RUNNER_BUNDLE_PATH, RUNNER_PTY_PATH, RUNNER_SHA256_HEADER } from '@mwc/shared/runner-protocol';
import { describe, expect, it } from 'vitest';
import { INSTALL_SCRIPT } from '../../../../../src/modules/machines/service/runner/install-script.ts';

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
    expect(code.match(/^[a-z_]+\(\) \{$/gm)).toEqual([
      'fail() {',
      'option_of() {',
      'verify() {',
      'fetch_pty() {',
      'main() {',
    ]);
  });

  it('takes the server from --server URL or --server=URL, and needs it', () => {
    expect(code).toContain('server=$(option_of server "$@")');
    expect(code).toContain('"$option"=*)');
    expect(code).toContain(`printf '%s' "\${argument#"$option"=}"`);
    expect(code).toContain('if [ "$previous" = "$option" ]; then');
    expect(code).toContain("fail 'usage: sh install.sh --server <url> [--via <url>] --token <mwc_et_...>");
    expect(code).toContain(`server=\${server%/}`);
  });

  it('downloads from --via when given (its trailing slash dropped), else from --server', () => {
    expect(code).toContain('via=$(option_of via "$@")');
    expect(code).toContain(`from=\${via%/}\n  from=\${from:-$server}`);
    expect(code).not.toContain('"$server/');
    expect(code.match(/"\$from\//g)).toHaveLength(2);
    expect(code).toContain('fail "cannot download the runner from $from"');
  });

  it('finds an option by name in either form, and nothing for an absent one (option_of run in sh)', () => {
    const start = code.indexOf('option_of() {');
    const fn = code.slice(start, code.indexOf('\n}\n', start) + 2);
    const optionOf = (name: string, ...args: string[]) =>
      execFileSync('sh', ['-eu', '-c', `${fn}\noption_of "$@"`, 'sh', name, ...args], { encoding: 'utf8' });
    const args = ['--server', 'http://127.0.0.1:9950', '--via=http://127.0.0.1:9954/', '--token', 'mwc_et_x'];
    expect(optionOf('server', ...args)).toBe('http://127.0.0.1:9950');
    expect(optionOf('via', ...args)).toBe('http://127.0.0.1:9954/');
    expect(optionOf('via', '--server=http://a.test', '--via', 'http://b.test')).toBe('http://b.test');
    expect(optionOf('via', '--server', 'http://a.test', '--token', 'mwc_et_x')).toBe('');
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
      `curl -fsSL -D "$dir/headers" -o "$dir/runner.mjs" "$from${RUNNER_BUNDLE_PATH}" ||`,
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

describe("the installer and the terminal's PTY", () => {
  it("downloads this system's PTY, checks it like the runner and unpacks it beside it, before the install", () => {
    expect(code).toContain(`target=$(node -p 'process.platform + "-" + process.arch')`);
    expect(code).toContain(
      `if ! curl -fsSL -D "$dir/pty-headers" -o "$dir/pty.tgz" "$from${RUNNER_PTY_PATH}/$target.tgz"; then`,
    );
    const verify = code.indexOf('verify "$dir/pty.tgz" "$dir/pty-headers"');
    const unpack = code.indexOf('tar -xzf "$dir/pty.tgz" -C "$dir" || fail');
    expect(verify).toBeGreaterThan(0);
    expect(unpack).toBeGreaterThan(verify);
    const runnerChecked = code.indexOf(
      'verify "$dir/runner.mjs" "$dir/headers"\n  fetch_pty\n  node "$dir/runner.mjs"',
    );
    expect(runnerChecked).toBeGreaterThan(0);
    // The check names the file it refused.
    expect(code).toContain('const what = path.basename(file);');
  });

  it('installs without a terminal when the server has no PTY for the system, or the machine has no tar', () => {
    expect(code).toContain(
      "printf 'mwc-runner install: no terminal for %s from %s; installing without it\\n'",
    );
    expect(code).toContain('if ! command -v tar >/dev/null 2>&1; then');
    expect(code.match(/return 0/g)).toHaveLength(2);
  });
});
