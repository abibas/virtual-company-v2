import { describe, expect, it } from 'vitest';
import { shellQuote, TERMINAL, ttyArgv } from '../../../../src/platform/processes/login-helper/tty.ts';

describe('shellQuote', () => {
  it('keeps plain arguments and single-quotes the rest', () => {
    expect(shellQuote('--device-auth')).toBe('--device-auth');
    expect(shellQuote('cli_auth_credentials_store=file')).toBe('cli_auth_credentials_store=file');
    expect(shellQuote('two words')).toBe("'two words'");
    expect(shellQuote("it's; rm -rf /")).toBe(`'it'\\''s; rm -rf /'`);
    expect(shellQuote('')).toBe("''");
  });
});

describe('ttyArgv', () => {
  it("runs the login behind script's pseudo-terminal, very wide, returning its exit code", () => {
    expect(ttyArgv(['claude', 'auth', 'login', '--claudeai'])).toEqual([
      'script',
      '-qfec',
      `stty cols ${TERMINAL.cols} rows ${TERMINAL.rows}; exec claude auth login --claudeai`,
      '/dev/null',
    ]);
    expect(ttyArgv(['codex', 'login', 'a b'])[2]).toMatch(/; exec codex login 'a b'$/);
  });

  it('needs a command', () => {
    expect(() => ttyArgv([])).toThrow(RangeError);
  });
});
