import { describe, expect, it } from 'vitest';
import { loginShell, TERMINAL_TERM, terminalEnv, utf8Locale } from '../../src/terminal/shell.ts';

describe('the login shell', () => {
  it('is SHELL when it exists, else /bin/bash, else /bin/sh', () => {
    const all = () => true;
    expect(loginShell({ SHELL: '/opt/homebrew/bin/fish' }, all)).toBe('/opt/homebrew/bin/fish');
    expect(loginShell({ SHELL: '/bin/zsh' }, (path) => path === '/bin/bash')).toBe('/bin/bash');
    expect(loginShell({ SHELL: 'zsh' }, all)).toBe('/bin/bash');
    expect(loginShell({}, (path) => path === '/bin/sh')).toBe('/bin/sh');
    expect(loginShell({}, () => false)).toBe('/bin/sh');
  });
});

describe("a terminal's environment", () => {
  it("is the runner's without MWC_* variables, with TERM and a UTF-8 locale when none is set", () => {
    const env = terminalEnv(
      {
        PATH: '/usr/bin',
        TERM: 'dumb',
        MWC_RUNNER_CONFIG: '/x',
        MWC_ENROLL_TOKEN: 'mwc_et_x',
        EMPTY: undefined,
      },
      'darwin',
    );
    expect(env).toEqual({ PATH: '/usr/bin', TERM: TERMINAL_TERM, LANG: 'en_US.UTF-8' });
    expect(terminalEnv({}, 'linux').LANG).toBe('C.UTF-8');
    expect(terminalEnv({ LANG: 'uk_UA.UTF-8' }, 'linux').LANG).toBe('uk_UA.UTF-8');
    expect(terminalEnv({ LC_ALL: 'C' }, 'linux')).toEqual({ LC_ALL: 'C', TERM: TERMINAL_TERM });
    expect(terminalEnv({ LC_CTYPE: 'UTF-8' }, 'darwin')).toEqual({ LC_CTYPE: 'UTF-8', TERM: TERMINAL_TERM });
    expect(utf8Locale('darwin')).toBe('en_US.UTF-8');
  });
});
