/**
 * The org commands' test world: the real API (`createTestApp()` with the fake identity provider, on PGlite or the dev
 * Postgres) reached in-process through a fetch that calls `app.request()`, with a company of people and agents and the
 * owner's personal API key. The config folder is a temporary one (`tempConfig`), never ~/.config.
 */
import {
  createTestApp,
  FakeIdentityProvider,
  seedAgent,
  seedApiKey,
  seedCompany,
  seedMember,
  type TestApp,
} from '@mwc/testkit';
import type { Fetch } from '../../src/api/client.ts';

/** The server the commands are pointed at; nothing listens there, the fetch below answers in-process. */
export const ORG_SERVER = 'http://mwc.test';

export interface OrgWorld {
  readonly t: TestApp;
  readonly fetch: Fetch;
  readonly company: { readonly id: string; readonly slug: string; readonly name: string };
  /** The owner's personal API key. */
  readonly key: string;
  /** A suspended member's key: `GET /api/me` answers, the company's routes refuse it. */
  readonly suspendedKey: string;
  /** The key of Globex's owner, a company without agents. */
  readonly globexKey: string;
  readonly principals: Readonly<Record<'olga' | 'bob' | 'ann' | 'slop' | 'reviewer' | 'lost', string>>;
}

/** A fetch that answers through the test app, as the real server would. */
export const appFetch =
  (t: TestApp): Fetch =>
  async (url, init) =>
    t.app.request(url, init);

/** Gives a position its title through the API (`PUT .../org/positions/:principalId`), as the key's owner. */
async function titled(t: TestApp, key: string, path: string, title: string): Promise<void> {
  const res = await t.app.request(path, {
    method: 'PUT',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (res.status !== 200) throw new Error(`PUT ${path} answered ${res.status}: ${await res.text()}`);
}

/** Acme's people: Olga (owner, CEO, with the key), Bob (admin, CTO) under her, Ann (no display name) under Bob. */
async function seedPeople(t: TestApp) {
  const { company, owner } = await seedCompany(t.db, {
    slug: 'acme',
    name: 'Acme',
    owner: { displayName: 'Olga', email: 'olga@acme.test' },
  });
  const id = company.id;
  const olga = owner.principal.id;
  const { key } = await seedApiKey(t.db, id, olga);
  await titled(t, key, `/api/companies/${id}/org/positions/${olga}`, 'CEO');
  const bob = await seedMember(t.db, id, {
    role: 'admin',
    displayName: 'Bob',
    email: 'bob@acme.test',
    reportsTo: olga,
    title: 'CTO',
  });
  const ann = await seedMember(t.db, id, {
    role: 'viewer',
    displayName: null,
    email: 'ann@acme.test',
    reportsTo: bob.principal.id,
  });
  return { id, key, olga, bob: bob.principal.id, ann: ann.principal.id };
}

/** Acme's agents: SLOP BOX under Olga, the paused Reviewer under it, the archived Old QA, Lost whose manager left. */
async function seedAgents(t: TestApp, id: string, olga: string) {
  const named = (name: string, slug: string, roleTitle: string) => ({ name, slug, roleTitle });
  const slop = await seedAgent(t.db, id, {
    ...named('SLOP BOX', 'slop-box', 'Coder'),
    effort: 'xhigh',
    reportsTo: olga,
  });
  const reviewer = await seedAgent(t.db, id, {
    ...named('Reviewer', 'reviewer', 'Code reviewer'),
    status: 'paused',
    reportsTo: slop.principal.id,
  });
  await seedAgent(t.db, id, { ...named('Old QA', 'old-qa', 'QA'), status: 'archived', reportsTo: olga });
  const gone = await seedMember(t.db, id, { status: 'removed', reportsTo: null });
  const lost = await seedAgent(t.db, id, {
    ...named('Lost', 'lost', 'Tester'),
    reportsTo: gone.principal.id,
  });
  return { slop: slop.principal.id, reviewer: reviewer.principal.id, lost: lost.principal.id };
}

/**
 * Acme: Olga (owner, CEO) at the top; Bob (admin, CTO) and the agent SLOP BOX under her; Ann (a viewer with no display
 * name) under Bob; the paused agent Reviewer under SLOP BOX; the archived Old QA off the chart; and the agent Lost,
 * whose manager left (an orphan). Another company, Globex, with no agents, which the owner's key cannot reach.
 */
export async function orgWorld(): Promise<OrgWorld> {
  const t = await createTestApp({ identity: new FakeIdentityProvider() });
  const { id, key, ...people } = await seedPeople(t);
  const agents = await seedAgents(t, id, people.olga);
  const suspended = await seedMember(t.db, id, { status: 'suspended', reportsTo: null });
  const globex = await seedCompany(t.db, { slug: 'globex', name: 'Globex' });
  return {
    t,
    fetch: appFetch(t),
    company: { id, slug: 'acme', name: 'Acme' },
    key,
    suspendedKey: (await seedApiKey(t.db, id, suspended.principal.id)).key,
    globexKey: (await seedApiKey(t.db, globex.company.id, globex.owner.principal.id)).key,
    principals: { ...people, ...agents },
  };
}
