import type { ChatTurn, TenantDb } from '@mwc/db';
import { describe, expect, it } from 'vitest';
import { NO_TOOLS_HERE, toolCall } from '../../../../src/modules/chats/service/live-tools.ts';
import type { ServerToolsHook, ServerToolTurn } from '../../../../src/modules/chats/service/server-tools.ts';
import type { AgentToolTurn, TaskTurnHook } from '../../../../src/modules/chats/service/task-hook.ts';

/** An agent's tool call during a live turn: answered by the tasks module's hook on the turn's queue, or by no one. */

const t = {} as TenantDb;
const turn = { id: 'turn-1', chatId: 'chat-1', createdBy: 'person-1' } as ChatTurn;
const call = { callId: 'c1', tool: 'task_note', input: {} };
const task = {
  taskId: 'task-1',
  stepId: 'step-1',
  chatId: 'chat-1',
  agentPrincipalId: 'agent-of-step',
  round: 1,
  artifactsDir: 'tasks/T-1',
  turnId: 'turn-1',
};

/** A hook whose tool answers and remembers whom for; `queued` counts the writes run on the turn's queue. */
function hookOf() {
  const seen: AgentToolTurn[] = [];
  const hook = {
    tool: async (_t: TenantDb, at: AgentToolTurn) => {
      seen.push(at);
      return { ok: true, text: 'noted' };
    },
  } as unknown as TaskTurnHook;
  let queued = 0;
  const run = async (work: () => Promise<void>) => {
    queued++;
    await work();
  };
  return { hook, seen, run, queued: () => queued };
}

describe('toolCall', () => {
  it('answers that the turn has no tools without a hook, a tool, or an agent', async () => {
    const { hook, run } = hookOf();
    const none = { ok: false, text: NO_TOOLS_HERE };
    expect(await toolCall({}, run, t, { turn, context: { agentPrincipalId: 'a' } }, call)).toEqual(none);
    expect(
      await toolCall(
        { tasks: {} as TaskTurnHook },
        run,
        t,
        { turn, context: { agentPrincipalId: 'a' } },
        call,
      ),
    ).toEqual(none);
    expect(await toolCall({ tasks: hook }, run, t, { turn, context: {} }, call)).toEqual(none);
  });

  it("asks the hook on the turn's queue, as the chat's agent, else as its task step's", async () => {
    const own = hookOf();
    expect(
      await toolCall({ tasks: own.hook }, own.run, t, { turn, context: { agentPrincipalId: 'lead' } }, call),
    ).toEqual({
      ok: true,
      text: 'noted',
    });
    expect(own.seen).toEqual([
      { turnId: 'turn-1', chatId: 'chat-1', agentPrincipalId: 'lead', by: 'person-1', task: undefined },
    ]);
    expect(own.queued()).toBe(1);
    const step = hookOf();
    await toolCall({ tasks: step.hook }, step.run, t, { turn, context: { task } }, call);
    expect(step.seen[0]).toMatchObject({ agentPrincipalId: 'agent-of-step', task });
  });
});

describe('toolCall of a server tool (S7.1c)', () => {
  const serverTools = (seen: ServerToolTurn[]): ServerToolsHook => ({
    toolsFor: async () => ({ tools: [] }),
    owns: (tool) => tool === 'getJiraIssue',
    tool: async (_t, at) => {
      seen.push(at);
      return { ok: true, text: 'AP-301' };
    },
  });

  it('goes to the server tools’ hook off the turn’s queue, with the profile the turn runs on', async () => {
    const seen: ServerToolTurn[] = [];
    const tasks = hookOf();
    const ran = { ...turn, profileId: 'profile-1' } as ChatTurn;
    const hooks = { tasks: tasks.hook, serverTools: serverTools(seen) };
    const get = { callId: 'c2', tool: 'getJiraIssue', input: { issueIdOrKey: 'AP-301' } };
    expect(
      await toolCall(hooks, tasks.run, t, { turn: ran, context: { agentPrincipalId: 'dev' } }, get),
    ).toEqual({
      ok: true,
      text: 'AP-301',
    });
    expect(seen).toEqual([
      { turnId: 'turn-1', chatId: 'chat-1', agentPrincipalId: 'dev', profileId: 'profile-1', by: 'person-1' },
    ]);
    expect(tasks.queued()).toBe(0);
    expect(
      await toolCall(hooks, tasks.run, t, { turn: ran, context: { agentPrincipalId: 'dev' } }, call),
    ).toEqual({
      ok: true,
      text: 'noted',
    });
    expect(tasks.queued()).toBe(1);
  });
});
