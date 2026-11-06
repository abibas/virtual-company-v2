/**
 * The org chart in the acceptance story (S2.4): the invitee appears under the owner who invited them, placed by the
 * system with the acceptance's request id; an agent they make reports to them; and once they are removed they are off
 * the chart and their agent reports to the owner.
 */
import { expect } from 'vitest';
import { validateChart } from '../../../src/modules/org/rules.ts';
import type { AgentDetailView, OrgChartView } from '../../../src/modules/org/schemas.ts';
import { auditOf } from '../companies/companies.ts';
import type { Founded } from './steps.ts';
import type { SignedIn } from './target.ts';
import type { AcceptanceWorld } from './world.ts';

/** Whom each principal reports to on the chart as the owner reads it (undefined: not on it); the chart is valid. */
export async function managersIn(w: AcceptanceWorld, home: Founded, principalIds: readonly string[]) {
  const res = await w.as(home.owner)('GET', home.path('/org/chart'));
  expect(res.status).toBe(200);
  const chart = res.body as OrgChartView;
  expect(validateChart(chart.nodes)).toEqual([]);
  const nodes = new Map(chart.nodes.map((node) => [node.principalId, node.reportsTo]));
  return principalIds.map((id) => (nodes.has(id) ? nodes.get(id) : undefined));
}

/**
 * After the acceptance: the person reports to the owner, and their position's audit row is the system's, with one of
 * the request ids the acceptance's other rows carry.
 */
export async function expectPlacedUnderOwner(
  w: AcceptanceWorld,
  home: Founded,
  principalId: string,
  requestIds: readonly (string | null)[],
): Promise<void> {
  expect(await managersIn(w, home, [principalId])).toEqual([home.ownerPrincipalId]);
  const rows = (await auditOf(w.t.db, home.company.id)).filter(
    (row) => row.entityType === 'org_position' && row.entityId === principalId,
  );
  expect(rows).toEqual([
    expect.objectContaining({
      actorKind: 'system',
      actorPrincipalId: null,
      action: 'create',
      field: 'reportsToPrincipalId',
      newValue: home.ownerPrincipalId,
    }),
  ]);
  expect(requestIds).toContain(rows[0]?.requestId);
}

/** The person (an admin by now) makes an agent through the API, which reports to them. */
export async function makeAgentAs(
  w: AcceptanceWorld,
  home: Founded,
  person: SignedIn,
  principalId: string,
): Promise<AgentDetailView> {
  const res = await w.as(person, 'admin-creates-agent')('POST', home.path('/agents'), {
    name: 'Second Bot',
    roleTitle: 'Coder',
  });
  expect(res).toMatchObject({ status: 201, body: { reportsTo: principalId } });
  return res.body as AgentDetailView;
}
