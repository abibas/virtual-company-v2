import { readFileSync } from 'node:fs';

/** The server version from apps/server/package.json (read once at startup). */
export function readServerVersion(packageJson: URL = new URL('../../package.json', import.meta.url)): string {
  const { version } = JSON.parse(readFileSync(packageJson, 'utf8')) as { version?: unknown };
  if (typeof version !== 'string' || version === '')
    throw new Error(`${packageJson.pathname} has no version`);
  return version;
}
