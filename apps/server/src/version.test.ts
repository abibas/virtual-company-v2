import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readServerVersion } from './version.ts';

describe('readServerVersion', () => {
  it("reads apps/server/package.json's version", () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(readServerVersion()).toBe(pkg.version);
  });

  it('fails for a package.json without a version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mwc-version-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
      expect(() => readServerVersion(pathToFileURL(join(dir, 'package.json')))).toThrow(/has no version/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
