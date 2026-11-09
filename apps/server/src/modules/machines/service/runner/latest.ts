import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { RunnerBuild, RunnerBuiltAt, RunnerVersion } from '@mwc/shared/runner-protocol';
import { z } from 'zod';

/**
 * The latest runner, the one this server hands out (docs/machines.md, "Runner versions"): what the runner build wrote
 * beside the bundle, `runner.json` (`{ version, builtAt, sha256 }`), read again only when its time or size changed; null
 * while the bundle or its manifest is missing, or the manifest does not parse.
 */

export interface LatestRunner {
  readonly version: string;
  readonly builtAt: string;
  /** The bundle's SHA-256, as the build wrote it. */
  readonly build: string;
}

const Manifest = z.object({ version: RunnerVersion, builtAt: RunnerBuiltAt, sha256: RunnerBuild });

/** The manifest beside the bundle at `bundlePath`. */
export const manifestPath = (bundlePath: string): string => join(dirname(bundlePath), 'runner.json');

/** The manifests already read, by path, with the file's time and size then. */
const manifests = new Map<
  string,
  { readonly mtimeMs: number; readonly size: number; readonly latest: LatestRunner | null }
>();

const statOf = async (path: string) => {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
};

async function parsed(path: string): Promise<LatestRunner | null> {
  try {
    const manifest = Manifest.parse(JSON.parse(await readFile(path, 'utf8')));
    return { version: manifest.version, builtAt: manifest.builtAt, build: manifest.sha256 };
  } catch {
    return null;
  }
}

/** The runner this server hands out from the bundle at `bundlePath`, or null when there is none to tell of. */
export async function latestRunner(bundlePath: string): Promise<LatestRunner | null> {
  const path = manifestPath(bundlePath);
  const [bundle, info] = await Promise.all([statOf(bundlePath), statOf(path)]);
  if (bundle === undefined || info === undefined) return null;
  const known = manifests.get(path);
  if (known !== undefined && known.mtimeMs === info.mtimeMs && known.size === info.size) return known.latest;
  const latest = await parsed(path);
  manifests.set(path, { mtimeMs: info.mtimeMs, size: info.size, latest });
  return latest;
}
