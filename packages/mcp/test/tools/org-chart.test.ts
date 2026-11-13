import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compactNode } from '../../src/tools/org-chart.ts';
import {
  callTool,
  connect,
  keyEnv,
  type McpWorld,
  mcpWorld,
  SERVER,
  UNKNOWN_KEY,
} from '../fixtures/world.ts';

let w: McpWorld;
beforeAll(async () => {
  w = await mcpWorld();
});
afterAll(() => w.t.close());

const TREE =
  'Acme (acme): 2 people, 2 agents\n' +
  'Olga · owner\n' +
  '├── Bob · CTO · admin\n' +
  '└── ◆ SLOP BOX · Coder · active · claude-opus-5-5/xhigh\n' +
  '◆ Lost · Tester · active · no profile [orphan]\n';

describe('org_chart', () => {
  it('answers the readable tree, then the nodes as compact JSON', async () => {
    const client = await connect(keyEnv(w), w.fetch);
    const r = await callTool(client, 'org_chart');
    expect(r.isError).toBe(false);
    expect(r.texts[0]).toBe(TREE);
    expect(r.texts[1]).not.toContain('\n');
    const { olga, bob, slop, lost } = w.principals;
    expect(JSON.parse(r.texts[1] ?? '')).toEqual({
      company: w.company,
      nodes: [
        {
          principalId: olga,
          kind: 'person',
          reportsTo: null,
          title: null,
          name: 'Olga',
          email: 'olga@acme.test',
          role: 'owner',
        },
        {
          principalId: bob,
          kind: 'person',
          reportsTo: olga,
          title: 'CTO',
          name: 'Bob',
          email: 'bob@acme.test',
          role: 'admin',
        },
        {
          principalId: slop,
          kind: 'agent',
          reportsTo: olga,
          title: null,
          agentId: expect.any(String),
          name: 'SLOP BOX',
          slug: 'slop-box',
          roleTitle: 'Coder',
          status: 'active',
          runsWith: { model: 'claude-opus-5-5', effort: 'xhigh', mode: 'manual', provider: 'claude' },
        },
        expect.objectContaining({ principalId: lost, kind: 'agent', orphan: true, name: 'Lost' }),
      ],
    });
  });

  it('takes the company by slug or id, and refuses one the key cannot reach as a tool error', async () => {
    const client = await connect(keyEnv(w), w.fetch);
    expect((await callTool(client, 'org_chart', { company: 'acme' })).texts[0]).toBe(TREE);
    expect((await callTool(client, 'org_chart', { company: w.company.id })).texts[0]).toBe(TREE);
    expect(await callTool(client, 'org_chart', { company: 'globex' })).toEqual({
      isError: true,
      texts: ['no company "globex" for this key; it can reach acme'],
    });
  });

  it("answers the server's refusals as tool errors: a bad key, a member the company refuses", async () => {
    const bad = await callTool(await connect(keyEnv(w, UNKNOWN_KEY), w.fetch), 'org_chart');
    expect(bad.isError).toBe(true);
    expect(bad.texts[0]).toMatch(
      new RegExp(`^${SERVER} refused the key \\(.+\\)\\. Make a new key and run mwc login`),
    );
    const suspended = await callTool(await connect(keyEnv(w, w.suspendedKey), w.fetch), 'org_chart');
    expect(suspended).toEqual({ isError: true, texts: ['Company not found'] });
  });

  it('gives a person their email as the name when they have no display name', () => {
    const node = {
      principalId: 'p1',
      reportsTo: null,
      title: null,
      kind: 'person' as const,
      person: { userId: 'u1', displayName: null, email: 'ann@acme.test', imageUrl: null, role: 'viewer' },
    };
    expect(compactNode(node, new Set())).toEqual({
      principalId: 'p1',
      kind: 'person',
      reportsTo: null,
      title: null,
      name: 'ann@acme.test',
      email: 'ann@acme.test',
      role: 'viewer',
    });
  });
});
