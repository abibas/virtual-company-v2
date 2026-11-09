import { describe, expect, it } from 'vitest';
import { loadPty, type PtyOptions, ptyPackage, ptyTarget } from '../../src/terminal/loader.ts';
import { FakePty } from '../fixtures/pty.ts';

const OPTIONS: PtyOptions = { name: 'xterm-256color', cols: 80, rows: 24, cwd: '/', env: {}, encoding: null };

describe('the PTY loader', () => {
  it('knows the four systems a PTY is built for', () => {
    expect(ptyTarget('darwin', 'arm64')).toBe('darwin-arm64');
    expect(ptyTarget('linux', 'x64')).toBe('linux-x64');
    expect(ptyTarget('linux', 'arm')).toBeUndefined();
    expect(ptyTarget('win32', 'x64')).toBeUndefined();
    expect(ptyPackage('linux-arm64')).toBe('@lydell/node-pty-linux-arm64');
  });

  it("loads this system's package and spawns through it", () => {
    const loaded: string[] = [];
    const calls: unknown[][] = [];
    const pty = new FakePty(1);
    const result = loadPty({
      platform: 'darwin',
      arch: 'x64',
      load: (name) => {
        loaded.push(name);
        return {
          spawn: (...values: unknown[]) => {
            calls.push(values);
            return pty;
          },
        };
      },
    });
    expect(loaded).toEqual(['@lydell/node-pty-darwin-x64']);
    if (!result.ok) throw new Error(result.reason);
    expect(result.target).toBe('darwin-x64');
    const args = ['-l'] as const;
    expect(result.spawn('/bin/zsh', args, OPTIONS)).toBe(pty);
    expect(calls).toEqual([['/bin/zsh', ['-l'], OPTIONS]]);
  });

  it('says why when it cannot: no build for the system, not installed, broken, or no spawn', () => {
    const fail = (load: (name: string) => unknown, platform = 'linux', arch = 'x64') =>
      loadPty({ platform, arch, load });
    const unused = () => {
      throw new Error('loaded');
    };
    expect(fail(unused, 'freebsd')).toEqual({
      ok: false,
      reason: 'no terminal PTY is built for freebsd-x64',
    });
    const missing = Object.assign(
      new Error("Cannot find module '@lydell/node-pty-linux-x64'\nRequire stack:"),
      {
        code: 'MODULE_NOT_FOUND',
      },
    );
    expect(
      fail(() => {
        throw missing;
      }),
    ).toEqual({
      ok: false,
      reason:
        '@lydell/node-pty-linux-x64 is not installed next to the runner; install the runner again (install.sh) to get it',
    });
    expect(
      fail(() => {
        throw new Error('/lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34` not found\nmore');
      }),
    ).toEqual({
      ok: false,
      reason:
        'cannot load @lydell/node-pty-linux-x64: /lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34` not found',
    });
    expect(
      fail(() => {
        throw 'odd';
      }),
    ).toEqual({ ok: false, reason: 'cannot load @lydell/node-pty-linux-x64: odd' });
    expect(fail(() => ({}))).toEqual({
      ok: false,
      reason: '@lydell/node-pty-linux-x64 has no spawn function',
    });
    expect(fail(() => null)).toEqual({
      ok: false,
      reason: '@lydell/node-pty-linux-x64 has no spawn function',
    });
  });
});
