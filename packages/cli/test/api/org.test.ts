import { describe, expect, it } from 'vitest';
import type { Fetch } from '../../src/api/client.ts';
import { AGENT_FILTERS, getChart, listAgents } from '../../src/api/org.ts';

const SERVER = 'http://mwc.test';
const KEY = 'mwc_pk_Tq3ZbN8xWc1LmR5vYk7HdJ2sFg9PaE4u';

function answering(body: unknown, status = 200) {
  const urls: string[] = [];
  const fetch: Fetch = async (url) => {
    urls.push(url);
    return Response.json(body, { status });
  };
  return { fetch, urls };
}

const PERSON = {
  principalId: 'p1',
  reportsTo: null,
  title: null,
  kind: 'person',
  person: { userId: 'u1', displayName: 'Olga', email: 'olga@acme.test', role: 'owner' },
};
const TREE = [{ principalId: 'p1', kind: 'person', orphan: false, children: [] }];

describe('the org API calls', () => {
  it('lists the filters the agents list takes', () => {
    expect(AGENT_FILTERS).toEqual(['active', 'paused', 'archived', 'all']);
  });

  it("gets a company's chart, with the company id escaped in the path", async () => {
    const api = answering({ nodes: [PERSON], tree: TREE });
    expect(await getChart(api.fetch, SERVER, KEY, 'c 1')).toEqual({
      ok: true,
      body: { nodes: [PERSON], tree: TREE },
    });
    expect(api.urls).toEqual([`${SERVER}/api/companies/c%201/org/chart`]);
  });

  it('refuses a chart that does not look like one', async () => {
    for (const body of [
      { nodes: [], tree: {} },
      { nodes: [{ ...PERSON, kind: 'robot' }], tree: [] },
      { nodes: [{ ...PERSON, person: null }], tree: [] },
      { nodes: [{ ...PERSON, kind: 'agent' }], tree: [] },
      { nodes: [], tree: [{ principalId: 'p1', children: [{ principalId: 2, children: [] }] }] },
      { nodes: [], tree: [{ principalId: 'p1' }] },
    ]) {
      expect(await getChart(answering(body).fetch, SERVER, KEY, 'c1')).toMatchObject({
        ok: false,
        code: 'bad_response',
      });
    }
  });

  it('lists the agents, with the status filter in the query when there is one', async () => {
    const api = answering({ agents: [{ id: 'a1', name: 'SLOP BOX' }] });
    expect(await listAgents(api.fetch, SERVER, KEY, 'c1')).toEqual({
      ok: true,
      body: [{ id: 'a1', name: 'SLOP BOX' }],
    });
    await listAgents(api.fetch, SERVER, KEY, 'c1', 'all');
    expect(api.urls).toEqual([
      `${SERVER}/api/companies/c1/agents`,
      `${SERVER}/api/companies/c1/agents?status=all`,
    ]);
  });

  it('passes a refusal on and refuses a list that does not look like one', async () => {
    const refused = answering(
      { error: { code: 'invalid_request', message: 'Bad status', requestId: 'r' } },
      400,
    );
    expect(await listAgents(refused.fetch, SERVER, KEY, 'c1', 'x')).toEqual({
      ok: false,
      status: 400,
      code: 'invalid_request',
      message: 'Bad status',
    });
    for (const body of [{ agents: {} }, { agents: [{ id: 'a1' }] }, { agents: [null] }]) {
      expect(await listAgents(answering(body).fetch, SERVER, KEY, 'c1')).toMatchObject({
        code: 'bad_response',
      });
    }
  });
});
