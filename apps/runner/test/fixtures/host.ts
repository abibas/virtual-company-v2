/**
 * The runner's own commands' test world: a temporary home folder with the real files (`nodeFs`), a machine that only
 * pretends to have the paths outside it (`/.dockerenv`, the devbox's keepalive), a fake `exec` that records every
 * process the command would start and answers what the test says, a fake `fetch`, and the output kept.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createTestApp, FakeIdentityProvider, seedApiKey, seedCompany, type TestApp } from '@mwc/testkit';
import type { ExecResult, Host } from '../../src/install/host.ts';
import { nodeFs } from '../../src/install/system.ts';
import { tempDir } from './runner.ts';

export interface ExecCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>> | undefined;
}

export type Fetch = Host['fetch'];

export interface HostOptions {
  readonly platform?: NodeJS.Platform;
  readonly env?: Record<string, string | undefined>;
  /** Paths outside the home folder the machine has. */
  readonly files?: readonly string[];
  /** What each process does; a success with no output unless it says. */
  readonly exec?: (file: string, args: readonly string[]) => ExecResult | undefined;
  readonly fetch?: Fetch;
  /** The script the process runs; `<home>/Downloads/runner.mjs` by default. */
  readonly selfPath?: string;
  readonly username?: () => string;
}

export const NODE = '/opt/node/bin/node';
export const OK: ExecResult = { code: 0, stdout: '', stderr: '' };

/** A fetch that must not be called. */
export const noFetch: Fetch = () => Promise.reject(new Error('fetch was called'));

/** A host on a temporary home folder; `PATH` is its `bin/` (empty) unless the env says. */
export function testHost(options: HostOptions = {}) {
  const home = tempDir();
  const files = new Set(options.files ?? []);
  const execs: ExecCall[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const sleeps: number[] = [];
  const mine = (path: string) => path.startsWith(home);
  const host: Host = {
    env: { HOME: home, PATH: join(home, 'bin'), ...options.env },
    platform: options.platform ?? 'linux',
    arch: 'arm64',
    execPath: NODE,
    selfPath: options.selfPath ?? join(home, 'Downloads', 'runner.mjs'),
    uid: 501,
    version: '0.1.0',
    hostname: () => 'ihors-mac.local',
    homedir: () => home,
    username: options.username ?? (() => 'ihor'),
    fs: {
      ...nodeFs,
      exists: (path) => (mine(path) ? nodeFs.exists(path) : files.has(path)),
      isExecutable: (path) => mine(path) && nodeFs.isExecutable(path),
      listDir: (path) => (mine(path) ? nodeFs.listDir(path) : []),
    },
    exec: async (file, args, execOptions) => {
      execs.push({ file, args: [...args], env: execOptions?.env });
      return options.exec?.(file, args) ?? OK;
    },
    fetch: options.fetch ?? noFetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    out: (text) => out.push(text),
    err: (text) => err.push(text),
  };
  return { host, home, execs, sleeps, out: () => out.join(''), err: () => err.join('') };
}

/** Puts an executable `name` in `dir` (made if needed); returns its path. */
export function executable(dir: string, name: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, '#!/bin/sh\n');
  chmodSync(path, 0o755);
  return path;
}

/** A downloaded bundle at the host's `selfPath`. */
export function downloadedBundle(host: Host, text = '// runner\n'): void {
  mkdirSync(dirname(host.selfPath), { recursive: true });
  writeFileSync(host.selfPath, text);
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The server the commands are pointed at; nothing listens there, the fetch answers through the test app. */
export const SERVER = 'https://corp.example.test';

/** The real API on PGlite with a company and its owner's personal key, which makes enrollment tokens. */
export async function enrollWorld() {
  const t: TestApp = await createTestApp({ identity: new FakeIdentityProvider() });
  const { company, owner } = await seedCompany(t.db);
  const { key } = await seedApiKey(t.db, company.id, owner.principal.id);
  const fetch: Fetch = async (url, init) => t.app.request(url, init);
  const token = async (): Promise<string> => {
    const res = await t.app.request(`/api/companies/${company.id}/machines/enrollment-tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
    });
    return ((await res.json()) as { token: string }).token;
  };
  const machines = async () => {
    const res = await t.app.request(`/api/companies/${company.id}/machines`, {
      headers: { authorization: `Bearer ${key}` },
    });
    return ((await res.json()) as { machines: Record<string, unknown>[] }).machines;
  };
  return { t, company, fetch, token, machines };
}
