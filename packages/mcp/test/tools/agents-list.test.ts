import type { Fetch } from '@mwc/cli/api/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connect, keyEnv, type McpWorld, mcpWorld } from '../fixtures/world.ts';

let w: McpWorld;
beforeAll(async () => {
  w = await mcpWorld();
});
afterAll(() => w.t.close());

describe('agents_list', () => {
  it('answers the table of active and paused agents, then the agents as compact JSON', async () => {
    const r = await callTool(await connect(keyEnv(w), w.fetch), 'agents_list');
    expect(r.isError).toBe(false);
    expect(r.texts[0]).toBe(
      'Agents of Acme (acme):\n' +
        'NAME      SLUG      ROLE    STATUS  MODEL            EFFORT  REPORTS TO\n' +
        'SLOP BOX  slop-box  Coder   active  claude-opus-5-5  xhigh   Olga\n' +
        'Lost      lost      Tester  active  no profile       -       (off the chart)\n',
    );
    const body = JSON.parse(r.texts[1] ?? '');
    expect(body.company).toEqual(w.company);
    expect(body.agents[0]).toEqual({
      id: expect.any(String),
      principalId: w.principals.slop,
      name: 'SLOP BOX',
      slug: 'slop-box',
      roleTitle: 'Coder',
      status: 'active',
      harness: 'claude_code',
      runsWith: { model: 'claude-opus-5-5', effort: 'xhigh', provider: 'claude' },
      maxConcurrentRuns: 1,
      reportsTo: w.principals.olga,
      reportsToName: 'Olga',
      title: null,
    });
    expect(body.agents[1]).toMatchObject({ slug: 'lost', reportsToName: null, runsWith: null });
  });

  it('lists one status or all of them, and says so when there are none', async () => {
    const client = await connect(keyEnv(w), w.fetch);
    const archived = await callTool(client, 'agents_list', { status: 'archived' });
    expect(archived.texts[0]).toMatch(/^Agents of Acme \(acme\):\nNAME {4}SLUG {4}ROLE/);
    expect(JSON.parse(archived.texts[1] ?? '').agents).toEqual([
      expect.objectContaining({ slug: 'old-qa', status: 'archived', reportsTo: null, reportsToName: null }),
    ]);
    const all = await callTool(client, 'agents_list', { status: 'all', company: 'acme' });
    expect(JSON.parse(all.texts[1] ?? '').agents.map((a: { slug: string }) => a.slug)).toEqual([
      'slop-box',
      'old-qa',
      'lost',
    ]);
    const paused = await callTool(client, 'agents_list', { status: 'paused' });
    expect(paused.texts[0]).toBe('No paused agents in Acme (acme).\n');
    expect(JSON.parse(paused.texts[1] ?? '')).toEqual({ company: w.company, agents: [] });
  });

  it('refuses a status that is not one as a tool error, before calling the API', async () => {
    const r = await callTool(await connect(keyEnv(w), w.fetch), 'agents_list', { status: 'retired' });
    expect(r.isError).toBe(true);
    expect(r.texts[0]).toMatch(/Input validation error: Invalid arguments for tool agents_list/);
  });

  it("answers the server's refusals of the agents or the chart call as tool errors", async () => {
    const suspended = await callTool(await connect(keyEnv(w, w.suspendedKey), w.fetch), 'agents_list');
    expect(suspended).toEqual({ isError: true, texts: ['Company not found'] });
    const noChart: Fetch = async (url, init) =>
      url.endsWith('/org/chart')
        ? Response.json(
            { error: { code: 'internal', message: 'Something broke', requestId: 'r' } },
            { status: 500 },
          )
        : w.fetch(url, init);
    expect(await callTool(await connect(keyEnv(w), noChart), 'agents_list')).toEqual({
      isError: true,
      texts: ['Something broke'],
    });
  });
});
