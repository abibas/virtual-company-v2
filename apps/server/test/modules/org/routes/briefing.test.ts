import { companies } from '@mwc/db';
import { rawDb } from '@mwc/db/system';
import { BRIEFING_HEADING, briefingVersion } from '@mwc/shared/agent-briefing';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, type MembersCompany, membersCompany } from '../../../fixtures/members/members.ts';
import { agentsPath, makeAgent, placedMember, positionPath } from '../../../fixtures/org.ts';
import { type AuthWorld, authWorld } from '../../../fixtures/platform/auth.ts';

let w: AuthWorld;
beforeAll(async () => {
  w = await authWorld();
});
afterAll(() => w.t.close());

const briefingPath = (company: MembersCompany, agentId: string) => `${agentsPath(company, agentId)}/briefing`;

/** The company's name, as the briefing says it. */
async function nameOf(company: MembersCompany): Promise<string> {
  const [row] = await rawDb(w.t.db).select().from(companies).where(eq(companies.id, company.companyId));
  return row?.name as string;
}

describe('GET /api/companies/:companyId/agents/:agentId/briefing', () => {
  it('tells a viewer what the agent’s next turn is told: its place on the live chart, with a version', async () => {
    const company = await membersCompany(w);
    const owner = company.owner;
    await as(w, owner)('PUT', positionPath(company, owner.principalId), { title: 'CEO' });
    const pm = await makeAgent(w, company, owner, { name: 'DEVBOX Platform Coordinator', roleTitle: 'PM' });
    const report = { reportsToPrincipalId: pm.principalId };
    const dev = await makeAgent(w, company, owner, { name: 'Developer', roleTitle: 'Developer', ...report });
    const qa = await makeAgent(w, company, owner, { name: 'QA', roleTitle: 'QA', ...report });
    await as(w, owner)('PATCH', agentsPath(company, qa.id), { status: 'paused' });
    const viewer = await placedMember(w, company, 'viewer');

    const res = await as(w, viewer)('GET', briefingPath(company, dev.id));
    expect(res.status).toBe(200);
    const { briefing, version } = res.body as { briefing: string; version: string };
    expect(briefing).toBe(
      [
        BRIEFING_HEADING,
        '',
        `- You are Developer at ${await nameOf(company)}, an AI agent on its org chart.`,
        '- You report to DEVBOX Platform Coordinator (PM; an agent).',
        `- Your chain up to the top: DEVBOX Platform Coordinator → Owner ${owner.subject}.`,
        '- Your teammates (also reporting to DEVBOX Platform Coordinator): QA (an agent, paused).',
        '- Nobody reports to you.',
      ].join('\n'),
    );
    expect(version).toBe(briefingVersion(briefing));
    expect(briefing).not.toContain('@');
    expect(briefing).not.toContain(dev.principalId);
  });

  it('follows a move on the chart, and tells an archived agent it is off the chart', async () => {
    const company = await membersCompany(w);
    const owner = company.owner;
    const lead = await makeAgent(w, company, owner, { name: 'Lead', roleTitle: 'PM' });
    const coder = await makeAgent(w, company, owner, { name: 'Coder', roleTitle: 'Coder' });
    const read = async (agentId: string) =>
      (await as(w, owner)('GET', briefingPath(company, agentId))).body as {
        briefing: string;
        version: string;
      };
    const before = await read(coder.id);
    expect(before.briefing).toContain(`- You report to Owner ${owner.subject} (a person).`);
    await as(w, owner)('PUT', positionPath(company, coder.principalId), {
      reportsToPrincipalId: lead.principalId,
    });
    const after = await read(coder.id);
    expect(after.briefing).toContain('- You report to Lead (PM; an agent).');
    expect(after.version).not.toBe(before.version);
    expect((await read(lead.id)).briefing).toContain('- Reporting to you: Coder (an agent).');
    await as(w, owner)('PATCH', agentsPath(company, coder.id), { status: 'archived' });
    expect((await read(coder.id)).briefing).toContain(
      `- You are not on the org chart of ${await nameOf(company)}.`,
    );
  });

  it('is a 404 for an unknown agent and for another company’s', async () => {
    const company = await membersCompany(w);
    const other = await membersCompany(w);
    const theirs = await makeAgent(w, other, other.owner);
    const missing = await as(w, company.owner)(
      'GET',
      briefingPath(company, '019a4f0c-c4d5-7e6f-8a7b-9c0d1e2f3a4b'),
    );
    expect(missing.status).toBe(404);
    expect((missing.body as { error: { code: string } }).error.code).toBe('agent_not_found');
    expect((await as(w, company.owner)('GET', briefingPath(company, theirs.id))).status).toBe(404);
  });
});
