import { AgentTool, LEAD_TOOLS, missingToolsSection } from '@mwc/shared/flows';
import { TEST_NOW } from '@mwc/testkit';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ChatsWorld, chatsWorld } from '../../../../fixtures/chats/world.ts';
import { closedAtReview, said } from '../../../../fixtures/tasks/reopen.ts';
import { makeTask, stepOf } from '../../../../fixtures/tasks.ts';
import { leadTurn, toolScene } from '../../../../fixtures/tools.ts';

let w: ChatsWorld;
beforeAll(async () => {
  w = await chatsWorld();
});
afterEach(async () => {
  await w.disconnectAll();
  w.clock.set(TEST_NOW);
});
afterAll(() => w.close());

/** Every agents' tool but these, as a runner older than them says it knows them (`caps.agentToolNames`). */
const allBut = (...older: string[]) => AgentTool.options.filter((tool) => !older.includes(tool));

const LACKING = '## Tools you lack on this machine (from Most Wanted)';

describe('a runner that names the agents’ tools it knows (T-29)', () => {
  it('the closed task’s conversation on a runner without task_reopen: task_read only, and the lack said', async () => {
    const s = await toolScene(w, { caps: { agentToolNames: allBut('task_reopen') } });
    const closed = await closedAtReview(w, s);
    const start = await said(w, s, closed.review, 'It is wrong: fix the login here.');
    expect(start.spec.tools).toEqual(['task_read']);
    const instructions = start.spec.instructions ?? '';
    expect(instructions).toContain('## This task is closed (from Most Wanted)');
    expect(instructions).toContain(
      'If you have no task_reopen tool, change nothing: say so, put their correction in your reply, and tell them ' +
        'to reopen it with Reopen… on the task page',
    );
    expect(instructions.endsWith(missingToolsSection(['task_reopen']))).toBe(true);
    expect(instructions.indexOf(LACKING)).toBeGreaterThan(instructions.indexOf('## This task is closed'));
  });

  it('a Lead’s chat: the board tools it knows, and the ones it lacks named after its section', async () => {
    const s = await toolScene(w, { caps: { agentToolNames: allBut('task_queue', 'task_reopen') } });
    const { start } = await leadTurn(w, s);
    expect(start.spec.tools).toEqual(LEAD_TOOLS.filter((tool) => tool !== 'task_queue'));
    const instructions = start.spec.instructions ?? '';
    expect(instructions).toContain('## Leading your team (from Most Wanted)');
    expect(instructions).toContain(
      "This machine's runner is older than some of your tools and does not offer them: task_queue. ",
    );
  });

  it('a step’s turn gets all its tools and nothing said when the runner knows them', async () => {
    const s = await toolScene(w, { caps: { agentToolNames: allBut('task_reopen', 'task_queue') } });
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.tools).toEqual(['task_read', 'task_hand_on', 'task_attach', 'task_blocked']);
    expect(start.spec.instructions ?? '').not.toContain(LACKING);
  });

  it('a runner that knows none of them: no tools, and every one of the turn’s named as lacking', async () => {
    const s = await toolScene(w, { caps: { agentToolNames: [] } });
    await makeTask(w, s.c, s.c.owner, { flowId: s.flow.id, stepId: stepOf(s.flow, 'Develop').id });
    const start = await s.runner.frames.next('turn.start');
    expect(start.spec.tools).toBeUndefined();
    expect(start.spec.instructions).toContain(
      'does not offer them: task_read, task_hand_on, task_attach, task_blocked. ',
    );
  });

  it('a runner that names none (older than T-29) is given every tool, nothing said', async () => {
    const s = await toolScene(w);
    const { start } = await leadTurn(w, s);
    expect(start.spec.tools).toEqual([...LEAD_TOOLS]);
    expect(start.spec.instructions ?? '').not.toContain(LACKING);
  });
});
