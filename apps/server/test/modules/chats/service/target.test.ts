import { BRIEFING_HEADING, INSTRUCTIONS_HEADING } from '@mwc/shared/agent-briefing';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { TerminalTicketView } from '../../../../src/modules/machines/index.ts';
import {
  ANSWER,
  type ChatsWorld,
  chatPath,
  chatsWorld,
  ended,
  endTurn,
  scene,
  sendEvents,
  startedTurn,
} from '../../../fixtures/chats/world.ts';
import { openTerminal, terminalUrl } from '../../../fixtures/machines/terminal.ts';
import { as } from '../../../fixtures/members/members.ts';
import { agentsPath, makeAgent, positionPath } from '../../../fixtures/org.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

describe("a turn's standing instructions", () => {
  it('are the agent’s place on the chart, then its own instructions, read again for each turn of the chat', async () => {
    const s = await scene(w);
    const owner = s.company.owner;
    await as(w, owner)('PATCH', agentsPath(s.company, s.agentId), { instructions: 'Ship small commits.' });
    const first = await startedTurn(w, s);
    const lines = first.spec.instructions?.split('\n') ?? [];
    expect(lines[0]).toBe(BRIEFING_HEADING);
    expect(lines).toContain(`- You report to Owner ${owner.subject} (a person).`);
    expect(first.spec.instructions?.endsWith(`\n\n${INSTRUCTIONS_HEADING}\n\nShip small commits.`)).toBe(
      true,
    );

    const runner = s.runner as FakeRunner;
    sendEvents(runner, first.turnId, ANSWER);
    endTurn(runner, first.turnId);
    await ended(w.t.db, first.turnId);
    const lead = await makeAgent(w, s.company, owner, { name: 'Lead', roleTitle: 'PM' });
    const agent = await as(w, owner)('GET', agentsPath(s.company, s.agentId));
    const { principalId } = agent.body as { principalId: string };
    await as(w, owner)('PUT', positionPath(s.company, principalId), {
      reportsToPrincipalId: lead.principalId,
    });

    const next = await startedTurn(w, s, 'And now?');
    expect(next.spec.sessionId).toBe('b4c1f0e2-session');
    expect(next.spec.instructions).toContain('- You report to Lead (PM; an agent).');
    expect(next.spec.instructions).not.toContain(`- You report to Owner ${owner.subject}`);
  });

  it('go to the chat’s terminal too', async () => {
    const s = await scene(w);
    const res = await as(w, s.company.owner)('POST', chatPath(s.company, s.chat.id, '/terminal-tickets'));
    const { ticket } = res.body as TerminalTicketView;
    const browser = await openTerminal(terminalUrl(w, { ticket, cols: 80, rows: 24 }));
    const open = await (s.runner as FakeRunner).frames.next('terminal.open');
    expect(open.harness?.instructions?.startsWith(BRIEFING_HEADING)).toBe(true);
    browser.socket.close();
  });
});
