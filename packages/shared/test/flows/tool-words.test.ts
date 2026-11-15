import { describe, expect, it } from 'vitest';
import { AGENT_TOOL_INFO, missingToolsSection, newTasksWords } from '../../src/flows.ts';

describe('newTasksWords (T-38)', () => {
  it('says where a new task goes when its creator does not say: Queued with its Autotake, or a step', () => {
    expect(newTasksWords({ stepName: null, autoTake: true })).toBe('Queued, Autotake');
    expect(newTasksWords({ stepName: null, autoTake: false })).toBe('Queued, Manual');
    expect(newTasksWords({ stepName: 'Develop', autoTake: true })).toBe('"Develop"');
  });
});

describe('missingToolsSection (T-29)', () => {
  it('names the tools the runner lacks, and that their move is a person’s, never the agent’s own work', () => {
    const text = missingToolsSection(['task_reopen', 'task_queue']);
    expect(text.startsWith('## Tools you lack on this machine (from Most Wanted)\n\n')).toBe(true);
    expect(text).toContain('does not offer them: task_reopen, task_queue. ');
    expect(text).toContain('never do yourself the work it would send to another step');
    expect(text).toContain('the machine’s runner needs an update');
    expect(text).toContain('a person then makes the move (a closed task: Reopen… on its page)');
  });
});

describe('the closed task’s tool (T-28)', () => {
  it('task_reopen says it reopens the task with the correction, never a new task', () => {
    expect(AGENT_TOOL_INFO.task_reopen.title).toBe('Reopen the task');
    expect(AGENT_TOOL_INFO.task_reopen.description).toContain(
      'Never file a new task for a correction of this one.',
    );
    expect(AGENT_TOOL_INFO.task_route.description).toContain('A done or cancelled task is reopened there');
  });
});
