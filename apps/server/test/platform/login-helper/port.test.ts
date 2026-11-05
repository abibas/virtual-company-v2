import { describe, expect, it } from 'vitest';
import { homePath, LoginHelperError } from '../../../src/platform/login-helper/port.ts';

describe('homePath', () => {
  it("takes plain paths under the sandbox's home, dot files included", () => {
    for (const path of ['.claude/.credentials.json', '.claude.json', '.codex/auth.json', 'a/b-c_d.e']) {
      expect(homePath(path)).toBe(path);
    }
  });

  it('refuses absolute paths, `.` and `..` parts, and odd characters', () => {
    for (const path of ['/etc/passwd', '../x', 'a/../b', './a', 'a/.', 'a//b', 'a b', 'a;b', '$HOME/x', '']) {
      expect(() => homePath(path), path).toThrow(RangeError);
    }
  });
});

describe('LoginHelperError', () => {
  it('is an Error with its own name and the plain message', () => {
    const error = new LoginHelperError('Docker is not available on this server.');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('LoginHelperError');
    expect(error.message).toBe('Docker is not available on this server.');
  });
});
