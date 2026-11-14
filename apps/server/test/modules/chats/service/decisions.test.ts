import type { ChatTurn, TenantDb } from '@mwc/db';
import { STANDING_INSTRUCTIONS_MAX } from '@mwc/shared/agent-briefing';
import { DECISION_LINE, LEAD_TOOLS, stepTools } from '@mwc/shared/flows';
import { TEST_NOW } from '@mwc/testkit';
import type { FakeRunner } from '@mwc/testkit/runner';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chatBus } from '../../../../src/modules/chats/service/bus.ts';
import {
  type DecisionsHook,
  decisionCall,
  withDecisionTool,
} from '../../../../src/modules/chats/service/decisions.ts';
import { openStream } from '../../../fixtures/chats/stream.ts';
import { chatPath, scene, sendEvents, startedTurn, turnRow } from '../../../fixtures/chats/world.ts';
import {
  type DecisionsWorld,
  decisionAudit,
  decisionRows,
  decisionsWorld,
} from '../../../fixtures/decisions/decisions.ts';
import { inboundScene, message } from '../../../fixtures/integrations/slack-inbound.ts';
import { said, startsByAgent } from '../../../fixtures/room.ts';
import { agentOf } from '../../../fixtures/runs.ts';
import { makeTask, stepOf } from '../../../fixtures/tasks.ts';
import { leadTurn, toolCall, toolScene } from '../../../fixtures/tools.ts';
import { wakeScene } from '../../../fixtures/wakes.ts';

/**
 * The decision log in the chats' turns (2026-11-14): `record_decision` and its one line in every message turn of every
 * agent whose runner offers it (an agent's own chat, a task's step, a Lead's chat, the team room, a Slack
 * conversation), none from an older runner; a call kept with its chat, turn, agent, task and place in the turn,
 * streamed to the chat and audited as the agent.
 */

let w: DecisionsWorld;
const streams: { close(): Promise<void> }[] = [];
beforeAll(async () => {
  w = await decisionsWorld();
});
afterEach(async () => {
  for (const stream of streams.splice(0)) await stream.close();
  await w.disconnectAll();
  w.provider.reset();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

const OFFERS = { agentTools: true, decisions: true };
const endsWithLine = (instructions: string | undefined) => instructions?.endsWith(`\n\n${DECISION_LINE}`);

describe('record_decision in every kind of turn', () => {
  it('an agent’s own chat: the tool, and its line after the standing instructions', async () => {
    const s = await scene(w, { caps: OFFERS });
    const start = await startedTurn(w, s);
    expect(start.spec.tools).toEqual(['record_decision']);
    expect(start.spec.instructions?.startsWith('## Your place in the company')).toBe(true);
    expect(endsWithLine(start.spec.instructions)).toBe(true);
  });

  it('a task step’s turn: after its kind’s tools', async () => {
    const s = await toolScene(w, { caps: { decisions: true } });
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.tools).toEqual([...stepTools('work'), 'record_decision']);
    expect(endsWithLine(start.spec.instructions)).toBe(true);
  });

  it('a Lead’s own chat: after the board tools, its line after the Lead’s section', async () => {
    const s = await toolScene(w, { caps: { decisions: true } });
    const { start } = await leadTurn(w, s);
    expect(start.spec.tools).toEqual([...LEAD_TOOLS, 'record_decision']);
    const text = start.spec.instructions ?? '';
    expect(text.indexOf('## Leading your team')).toBeGreaterThan(0);
    expect(text.indexOf(DECISION_LINE)).toBeGreaterThan(text.indexOf('## Leading your team'));
    expect(endsWithLine(text)).toBe(true);
  });

  it('the team room: every agent’s room turn', async () => {
    const s = await wakeScene(w, { decisions: true });
    await said(w, s, s.c.owner, 'Should we ship T-2 today?');
    const starts = await startsByAgent(w, s, 2);
    expect(starts.get(s.c.lead)?.spec.tools).toEqual([...LEAD_TOOLS, 'record_decision']);
    expect(starts.get(s.c.developer)?.spec.tools).toEqual(['record_decision']);
    expect(endsWithLine(starts.get(s.c.developer)?.spec.instructions)).toBe(true);
  });

  it('a Slack conversation’s turn', async () => {
    const s = await inboundScene(w, { caps: OFFERS });
    await s.conn.deliver(message());
    const start = await (s.runner as FakeRunner).frames.next('turn.start');
    expect(start.spec.tools).toEqual(['record_decision']);
    // The Slack tools' own line comes after it (they are the server's tools, offered after the agents' tools).
    const text = start.spec.instructions ?? '';
    expect(text.indexOf(DECISION_LINE)).toBeGreaterThan(0);
    expect(start.spec.serverTools?.length).toBeGreaterThan(0);
  });

  it('an older runner, with the agents’ tools but not the decision log: neither the tool nor its line', async () => {
    const s = await scene(w, { caps: { agentTools: true } });
    const start = await startedTurn(w, s);
    expect(start.spec.tools).toBeUndefined();
    expect(start.spec.instructions).not.toContain(DECISION_LINE);
    const step = await toolScene(w);
    const { start: lead } = await leadTurn(w, step);
    expect(lead.spec.tools).toEqual([...LEAD_TOOLS]);
  });
});

describe('a record_decision call', () => {
  it('is kept with its chat, turn, agent, task and place in the turn, streamed to the chat and audited', async () => {
    const s = await toolScene(w, { caps: { decisions: true } });
    const task = await makeTask(w, s.c, s.c.owner, {
      flowId: s.flow.id,
      stepId: stepOf(s.flow, 'Code review').id,
    });
    const start = await s.runner.frames.next('turn.start');
    const chatId = (await turnRow(w.t.db, start.turnId))?.chatId as string;
    const stream = await openStream(w.t.app, chatPath(s.c, chatId, '/stream'), {
      authorization: `Bearer fake:${s.c.owner.subject}`,
    });
    streams.push(stream);
    sendEvents(s.runner, start.turnId, [
      { type: 'session', sessionId: 'b4c1f0e2-session' },
      { type: 'text', text: 'The tests pass.' },
      { type: 'tool', id: 'toolu_1', name: 'mcp__mwc__record_decision', summary: 'Approve' },
    ]);
    const input = {
      what: 'Pass the review',
      why: 'The change is small and the tests cover it.',
      sources: ['https://github.com/acme/app/pull/12', 'src/login.ts'],
      outcome: 'approved',
    };
    const result = await toolCall(s.runner, start.turnId, 'record_decision', input);
    expect(result).toMatchObject({
      ok: true,
      text: 'Recorded your decision "Pass the review" with your reasons and sources.',
    });
    const reviewer = await agentOf(w.t.db, s.c.reviewer);
    const [row] = await decisionRows(w.t.db, chatId);
    expect(row).toMatchObject({
      ...input,
      companyId: s.c.companyId,
      agentId: reviewer.id,
      chatId,
      turnId: start.turnId,
      taskId: task.id,
      contactId: null,
      eventSeq: 3,
      createdAt: new Date(TEST_NOW),
    });
    await stream.until('the decision', (messages) => messages.some((m) => m.event === 'decision'));
    const sent = stream.messages.find((m) => m.event === 'decision')?.data as { decision: { id: string } };
    expect(sent.decision).toMatchObject({
      id: row?.id,
      what: 'Pass the review',
      eventSeq: 3,
      taskId: task.id,
    });
    const audit = await decisionAudit(w.t.db, row?.id as string);
    expect(
      new Set(audit.map((a) => [a.actorKind, a.actorPrincipalId, a.requestId, a.action].join(' '))),
    ).toEqual(new Set([`agent ${s.c.reviewer} ${start.turnId} record`]));
    expect(audit.map((a) => a.field)).toEqual([
      'agentId',
      'chatId',
      'eventSeq',
      'outcome',
      'sources',
      'taskId',
      'turnId',
      'what',
      'why',
    ]);
  });

  it('a Lead’s chat keeps one with no task, no outcome and no sources; a bad input keeps nothing', async () => {
    const s = await toolScene(w, { caps: { decisions: true } });
    const { chatId, start } = await leadTurn(w, s);
    const bad = await toolCall(s.runner, start.turnId, 'record_decision', { what: '', why: 'x' });
    expect(bad.ok).toBe(false);
    expect(bad.text).toMatch(/^record_decision did nothing; fix its input and call it again:\nwhat: /);
    expect(await decisionRows(w.t.db, chatId)).toEqual([]);
    const done = await toolCall(s.runner, start.turnId, 'record_decision', {
      what: 'Decline T-9',
      why: 'It is outside the team’s flow.',
    });
    expect(done.ok).toBe(true);
    expect(await decisionRows(w.t.db, chatId)).toMatchObject([
      { what: 'Decline T-9', taskId: null, outcome: null, sources: [], eventSeq: 0 },
    ]);
  });
});

describe('withDecisionTool and decisionCall', () => {
  const hook: DecisionsHook = { record: async () => ({ reply: { ok: true, text: 'kept' } }) };
  const turn = { hook, offers: true, kind: 'message' as const, instructions: 'Standing.' };

  it('adds nothing without the hook, an offer or a message turn; leaves the line out when it would not fit', () => {
    const plan = { tools: ['task_read'] };
    expect(withDecisionTool(plan, { ...turn, hook: undefined })).toBe(plan);
    expect(withDecisionTool(plan, { ...turn, offers: false })).toBe(plan);
    expect(withDecisionTool(plan, { ...turn, kind: 'compact' })).toBe(plan);
    expect(withDecisionTool({}, { ...turn, instructions: undefined })).toEqual({
      tools: ['record_decision'],
      instructions: DECISION_LINE,
    });
    const full = 'x'.repeat(STANDING_INSTRUCTIONS_MAX);
    expect(withDecisionTool(plan, { ...turn, instructions: full })).toEqual({
      tools: ['task_read', 'record_decision'],
    });
    expect(withDecisionTool({ tools: [], instructions: 'Lead.' }, { ...turn, instructions: full })).toEqual({
      tools: ['record_decision'],
      instructions: `Lead.\n\n${DECISION_LINE}`,
    });
  });

  it('answers that nothing was kept when its write fails', async () => {
    const run = async (work: () => Promise<void>) => {
      await work().catch(() => undefined);
    };
    const of = {
      turn: { id: 't', chatId: 'c' } as ChatTurn,
      agentPrincipalId: 'a',
      taskId: undefined,
      bus: chatBus(),
    };
    const call = { callId: 'c1', tool: 'record_decision', input: {} };
    expect(await decisionCall(hook, run, {} as TenantDb, of, call)).toEqual({
      ok: false,
      text: 'The decision was not recorded; call record_decision again.',
    });
  });
});
