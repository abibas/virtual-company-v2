/**
 * The checks the S1 acceptance scenario makes beside its steps: step 8, the audit trail (every change made through the
 * API has its rows with the person who made it and the request's id; the jobs' and the webhooks' changes are the
 * system's), and step 9, a company someone else owns, which stays out of sight throughout.
 */
import { expect } from 'vitest';
import { auditOf } from '../companies.ts';
import { type Founded, providerRoleOf } from './steps.ts';
import type { SignedIn } from './target.ts';
import type { AcceptanceWorld } from './world.ts';

/** A change made through the API: its request's label, who made it, and the audit rows it must have left. */
export interface AuditedChange {
  readonly label: string;
  readonly principalId: string;
  readonly entity: string;
  readonly action: string;
}

/**
 * Step 8: each change has at least one audit row of its entity and action, by the user who made it (their principal)
 * with the request's id; every row by a user carries a principal and one of the scenario's request ids; the company's
 * provisioning is the system's; and the acceptance left its rows (the membership activated, the invitation accepted)
 * as the system, with the request ids `acceptance` names (a webhook delivery's id, the id of the request that ran the
 * reconcile, none for the periodic reconcile).
 */
export async function expectAuditTrail(
  w: AcceptanceWorld,
  home: Founded,
  changes: readonly AuditedChange[],
  acceptance: readonly (string | null)[],
): Promise<void> {
  const rows = await auditOf(w.t.db, home.company.id);
  for (const { label, principalId, entity, action } of changes) {
    const requestId = w.requestId(label);
    const found = rows.filter(
      (row) => row.requestId === requestId && row.entityType === entity && row.action === action,
    );
    expect(found.length, `${label}: ${entity} ${action}`).toBeGreaterThan(0);
    for (const row of found) expect(row).toMatchObject({ actorKind: 'user', actorPrincipalId: principalId });
  }
  const scenarioIds = changes.map((change) => w.requestId(change.label));
  for (const row of rows.filter((one) => one.actorKind === 'user')) {
    expect(row.actorPrincipalId).not.toBeNull();
    expect(scenarioIds).toContain(row.requestId);
  }
  expect(rows).toContainEqual(
    expect.objectContaining({ actorKind: 'system', entityType: 'company', action: 'provision' }),
  );
  const accepted = rows.filter(
    (row) => acceptance.includes(row.requestId) && ['membership', 'invitation'].includes(row.entityType),
  );
  expect(accepted.map((row) => `${row.entityType} ${row.action}`)).toEqual(
    expect.arrayContaining(['membership activate', 'invitation accept']),
  );
  for (const row of accepted) expect(row).toMatchObject({ actorKind: 'system', actorPrincipalId: null });
}

/**
 * Step 9: `stranger`'s company answers 404 to every credential of ours (the owner, `people`, the API key while it is
 * valid) on every route tried, and is in none of their lists; ours answers 404 to the stranger; and at the provider
 * the stranger's organization still has its owner only.
 */
export async function expectStrangers(
  w: AcceptanceWorld,
  home: Founded,
  stranger: Founded,
  people: readonly SignedIn[],
  key?: string,
): Promise<void> {
  const theirs = stranger.path;
  const intruder = { email: w.target.email('intruder'), role: 'viewer' };
  const attempts: ReadonlyArray<readonly [string, string, unknown?]> = [
    ['GET', theirs()],
    ['GET', theirs('/members')],
    ['GET', theirs('/invitations')],
    ['POST', theirs('/invitations'), intruder],
    ['PATCH', theirs(), { name: 'Mine Now' }],
    ['POST', theirs('/sync')],
    ['GET', theirs('/api-keys')],
  ];
  for (const who of [home.owner, ...people, ...(key === undefined ? [] : [key])]) {
    const as = w.as(who);
    for (const [method, path, body] of attempts) {
      expect((await as(method, path, body)).status, `${method} ${path}`).toBe(404);
    }
    const listed = (await as('GET', '/api/companies')).body as { companies: { id: string }[] };
    expect(listed.companies.map((company) => company.id)).not.toContain(stranger.company.id);
  }
  const asStranger = w.as(stranger.owner);
  for (const path of [home.path(), home.path('/members'), home.path('/invitations')]) {
    expect((await asStranger('GET', path)).status, `stranger: GET ${path}`).toBe(404);
  }
  const theirList = (await asStranger('GET', '/api/companies')).body as { companies: { id: string }[] };
  expect(theirList.companies.map((company) => company.id)).toEqual([stranger.company.id]);
  const { provider } = w.target;
  for (const person of people)
    expect(await providerRoleOf(provider, stranger.orgId, person.subject)).toBeUndefined();
  expect(await providerRoleOf(provider, stranger.orgId, stranger.owner.subject)).toBeDefined();
}
