import type { Config } from '@mwc/shared/config';
import { InstallableTool, TOOL_PACKAGES } from '@mwc/shared/machines';
import type { Logger } from 'pino';
import { PINNED_TOOLS, type ToolsLatest } from '../../rules/runner.ts';

/**
 * The latest Claude Code and Codex on npm (docs/machines.md, "Tools"): the registry's `latest` of each package, read
 * through an injected `fetch` (`AppDeps.registryFetch`) with a short deadline and kept for six hours. A stale value is
 * refreshed in the background, so a request never waits for npm; until npm has answered once, or while it cannot be
 * reached, the machines are compared with the pinned versions (`PINNED_TOOLS`). Both packages are read together: one
 * failing keeps what was known before.
 */

/** How the server reads npm's registry: `fetch`, injected (tests pass a fake registry). */
export type RegistryFetch = typeof fetch;

export const NPM_REGISTRY = 'https://registry.npmjs.org';

/** The deadline of one registry read, headers and body. */
export const NPM_TIMEOUT_MS = 5_000;

/** How long npm's answer is kept before it is read again. */
export const NPM_LATEST_TTL_MS = 6 * 60 * 60_000;

/** How long after a failed read the registry is tried again. */
export const NPM_RETRY_MS = 10 * 60_000;

/** The largest answer read, in characters; a package's `latest` manifest is a few kilobytes. */
const MAX_ANSWER_LENGTH = 1024 * 1024;

/** A release version as npm publishes it: `0.167.0`, `2.1.330`, with an optional pre-release or build part. */
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** The address of a package's `latest` manifest. */
export const latestUrl = (pkg: string) => `${NPM_REGISTRY}/${pkg}/latest`;

/** One package's `latest` version, or why not (thrown). */
async function readLatest(fetchFn: RegistryFetch, pkg: string, timeoutMs: number): Promise<string> {
  const response = await fetchFn(latestUrl(pkg), {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`npm answered ${response.status} for ${pkg}`);
  }
  const body = await response.text();
  if (body.length > MAX_ANSWER_LENGTH) throw new Error(`npm's answer for ${pkg} is too long`);
  const version = (JSON.parse(body) as { version?: unknown } | null)?.version;
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new Error(`npm's answer for ${pkg} has no version`);
  }
  return version;
}

export interface NpmLatestDeps {
  readonly fetch: RegistryFetch;
  readonly clock: () => Date;
  readonly logger: Logger;
  /** The deadline of one read; `NPM_TIMEOUT_MS` unless a test shortens it. */
  readonly timeoutMs?: number;
}

export interface NpmLatest {
  /** What is known now (npm's, else the pins), starting a refresh in the background when it is stale. */
  current(): ToolsLatest;
  /** Reads npm now (one read at a time: a second call joins the first); never rejects. */
  refresh(): Promise<void>;
}

export function npmLatest(deps: NpmLatestDeps): NpmLatest {
  const timeoutMs = deps.timeoutMs ?? NPM_TIMEOUT_MS;
  let known: ToolsLatest | undefined;
  /** When the next read is due: none before the first. */
  let dueAt: number | undefined;
  let reading: Promise<void> | undefined;

  const read = async () => {
    try {
      const versions = await Promise.all(
        InstallableTool.options.map((tool) => readLatest(deps.fetch, TOOL_PACKAGES[tool].name, timeoutMs)),
      );
      const now = deps.clock();
      const [claude, codex] = versions as [string, string];
      known = { claude, codex, source: 'npm', checkedAt: now.toISOString() };
      dueAt = now.getTime() + NPM_LATEST_TTL_MS;
    } catch (error) {
      dueAt = deps.clock().getTime() + NPM_RETRY_MS;
      deps.logger.warn({ err: error }, 'tools: npm could not be read; comparing with what was known');
    }
  };

  const refresh = (): Promise<void> => {
    reading ??= read().finally(() => {
      reading = undefined;
    });
    return reading;
  };

  return {
    current() {
      if (reading === undefined && (dueAt === undefined || deps.clock().getTime() >= dueAt)) {
        void refresh();
      }
      return known ?? PINNED_TOOLS;
    },
    refresh,
  };
}

/** Refusing every read: what tests get unless they pass a fake registry, so no test reaches npm. */
const refuseInTests: RegistryFetch = () =>
  Promise.reject(new Error('No network in tests: pass a fake registry (registryFetch)'));

/** The registry client for this configuration: the platform's `fetch`, or a refusal under NODE_ENV=test. */
export function registryFetchFor(
  config: Pick<Config, 'NODE_ENV'>,
  fetchImpl: RegistryFetch = globalThis.fetch,
): RegistryFetch {
  if (config.NODE_ENV === 'test') return refuseInTests;
  return (input, init) => fetchImpl(input, init);
}
