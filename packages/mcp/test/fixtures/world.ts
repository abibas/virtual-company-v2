/**
 * The MCP tests' world: the real API (`createTestApp()` with the fake identity provider) reached in-process through a
 * fetch that calls `app.request()`, a company of people and agents with the owner's personal API key, and an SDK client
 * connected to the server through the SDK's in-memory transport. Config folders are temporary, never ~/.config.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Fetch } from '@mwc/cli/api/client';
import {
  createTestApp,
  FakeIdentityProvider,
  seedAgent,
  seedApiKey,
  seedCompany,
  seedMember,
  type TestApp,
} from '@mwc/testkit';
import { onTestFinished } from 'vitest';
import type { Env } from '../../src/auth.ts';
import { createMcpServer } from '../../src/server.ts';

/** The server the tools are pointed at; nothing listens there, the fetch below answers in-process. */
export const SERVER = 'http://mwc.test';
/** A well-formed personal key that no server knows. */
export const UNKNOWN_KEY = 'mwc_pk_Tq3ZbN8xWc1LmR5vYk7HdJ2sFg9PaE4u';
export const RUNNER_KEY = 'mwc_rk_Tq3ZbN8xWc1LmR5vYk7HdJ2sFg9PaE4u';

export interface McpWorld {
  readonly t: TestApp;
  readonly fetch: Fetch;
  readonly company: { readonly id: string; readonly slug: string; readonly name: string };
  readonly key: string;
  /** A suspended member's key: `GET /api/me` answers, the company's routes refuse it. */
  readonly suspendedKey: string;
  readonly principals: Readonly<Record<'olga' | 'bob' | 'slop' | 'lost', string>>;
}

/** A config folder of its own for the test that calls it (`MWC_CONFIG_DIR`), removed when the test ends. */
export function tempConfig() {
  const root = mkdtempSync(join(tmpdir(), 'mwc-mcp-test-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'mwc');
  return { dir, path: join(dir, 'credentials.json'), env: { MWC_CONFIG_DIR: dir } };
}

/**
 * Acme: Olga (owner) at the top, Bob (admin, CTO) and the agent SLOP BOX under her, the archived agent Old QA off the
 * chart, and the agent Lost, whose manager left (an orphan). Globex is another company the key cannot reach.
 */
export async function mcpWorld(): Promise<McpWorld> {
  const t = await createTestApp({ identity: new FakeIdentityProvider() });
  const { company, owner } = await seedCompany(t.db, {
    slug: 'acme',
    name: 'Acme',
    owner: { displayName: 'Olga', email: 'olga@acme.test' },
  });
  const id = company.id;
  const olga = owner.principal.id;
  const bob = await seedMember(t.db, id, {
    role: 'admin',
    displayName: 'Bob',
    email: 'bob@acme.test',
    reportsTo: olga,
    title: 'CTO',
  });
  const slop = await seedAgent(t.db, id, {
    name: 'SLOP BOX',
    slug: 'slop-box',
    roleTitle: 'Coder',
    effort: 'xhigh',
    reportsTo: olga,
  });
  await seedAgent(t.db, id, {
    name: 'Old QA',
    slug: 'old-qa',
    roleTitle: 'QA',
    status: 'archived',
    reportsTo: olga,
  });
  const gone = await seedMember(t.db, id, { status: 'removed', reportsTo: null });
  const lost = await seedAgent(t.db, id, {
    name: 'Lost',
    slug: 'lost',
    roleTitle: 'Tester',
    reportsTo: gone.principal.id,
  });
  const suspended = await seedMember(t.db, id, { status: 'suspended', reportsTo: null });
  await seedCompany(t.db, { slug: 'globex', name: 'Globex' });
  return {
    t,
    fetch: async (url, init) => t.app.request(url, init),
    company: { id, slug: 'acme', name: 'Acme' },
    key: (await seedApiKey(t.db, id, olga)).key,
    suspendedKey: (await seedApiKey(t.db, id, suspended.principal.id)).key,
    principals: { olga, bob: bob.principal.id, slop: slop.principal.id, lost: lost.principal.id },
  };
}

/** An SDK client connected to a new server through the in-memory transport; closed when the test ends. */
export async function connect(env: Env, fetch: Fetch): Promise<Client> {
  const server = createMcpServer({ env, fetch });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'mwc-test', version: '0.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  onTestFinished(() => client.close());
  return client;
}

/** The world's owner key and server in the environment (and a config folder of its own). */
export const keyEnv = (w: McpWorld, key = w.key): Env => ({
  ...tempConfig().env,
  MWC_SERVER_URL: SERVER,
  MWC_API_KEY: key,
});

/** Calls a tool and gives its texts and whether it is an error. */
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const texts = result.content.map((item) => (item.type === 'text' ? item.text : `<${item.type}>`));
  return { isError: result.isError === true, texts };
}
