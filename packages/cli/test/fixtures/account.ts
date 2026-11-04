/**
 * The account commands' test world: a config folder under the system temp folder (never ~/.config), a fake API
 * answering `GET /api/me` per key, and standard inputs that are piped or a terminal.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { onTestFinished } from 'vitest';
import type { Fetch } from '../../src/account/api.ts';
import type { SecretInput } from '../../src/account/secret.ts';

/** Throwaway keys of the right shape; nothing anywhere accepts them. */
export const KEY = 'mwc_pk_Tq3ZbN8xWc1LmR5vYk7HdJ2sFg9PaE4u';
export const OTHER_KEY = 'mwc_pk_Hh2KjL4mNn6PpQ8rRs0TtU1vVw3XxY5z';
export const RUNNER_KEY = 'mwc_rk_Tq3ZbN8xWc1LmR5vYk7HdJ2sFg9PaE4u';
export const SERVER = 'http://localhost:9950';
export const REMOTE = 'https://corp.example.com';

export const ACME = {
  companyId: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10',
  slug: 'acme',
  name: 'Acme',
  role: 'admin',
  status: 'active',
  companyStatus: 'active',
} as const;

export const meBody = (membership: object = ACME, memberships = [membership]) => ({
  user: {
    id: '019a4f0c-1111-7000-8000-000000000001',
    email: 'olga@example.test',
    displayName: 'Olga',
    imageUrl: null,
  },
  memberships,
  session: { via: 'api_key', pending: false },
});

const errorBody = (code: string, message: string) => ({ error: { code, message, requestId: 'req-1' } });
export const REFUSED = { status: 401, body: errorBody('unauthenticated', 'The API key was revoked') };

export interface Answer {
  readonly status: number;
  readonly body: unknown;
}

/** A fake API: `GET <server>/api/me` answers by the bearer key (an unknown key is a 401); it records each call. */
export function fakeApi(
  answers: Readonly<Record<string, Answer>> = { [KEY]: { status: 200, body: meBody() } },
) {
  const calls: { url: string; authorization: string | null; signal: boolean }[] = [];
  const fetch: Fetch = async (url, init) => {
    const authorization = new Headers(init.headers).get('authorization');
    calls.push({ url, authorization, signal: init.signal instanceof AbortSignal });
    const answer = answers[authorization?.replace(/^Bearer /, '') ?? ''] ?? {
      status: 401,
      body: errorBody('unauthenticated', 'The API key is not valid'),
    };
    const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body);
    return new Response(text, { status: answer.status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, calls };
}

/** A fetch that must not be called. */
export const noFetch: Fetch = () => Promise.reject(new Error('fetch was called'));

/** A config folder of its own for the test that calls it, removed when the test ends. */
export function tempConfig() {
  const root = mkdtempSync(join(tmpdir(), 'mwc-cli-test-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'mwc');
  return { root, dir, path: join(dir, 'credentials.json'), env: { MWC_CONFIG_DIR: dir } };
}

/** Standard input piped from another command. */
export const piped = (...chunks: (string | Buffer)[]): SecretInput =>
  Object.assign(Readable.from(chunks), { isTTY: false });

/** Standard input that is a terminal: what is written to `stdin` before or during the prompt is "typed". */
export function terminal() {
  const stream = new PassThrough();
  const rawModes: boolean[] = [];
  const stdin = Object.assign(stream, {
    isTTY: true,
    setRawMode: (on: boolean) => {
      rawModes.push(on);
      return stream;
    },
  }) as unknown as SecretInput & PassThrough;
  return { stdin, rawModes };
}

/** A terminal nobody types into: reading it would hang, so a test that must not read it gets this. */
export const untouchedStdin = (): SecretInput => {
  const { stdin } = terminal();
  stdin.on = () => {
    throw new Error('stdin was read');
  };
  return stdin;
};
