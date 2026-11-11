import { describe, expect, it } from 'vitest';
import { type StepPromptInput, stepPrompt } from '../../../src/flows.ts';

// The step's prompt when its turn gets the step's tools (S6a): the move to call in place of the verdict line, and what
// the tools do in place of "Nobody moves the task for you yet".

const input = (overrides: Partial<StepPromptInput> = {}): StepPromptInput => ({
  task: { key: 'T-12', title: 'Fix the login', description: 'Empty passwords pass.' },
  flowText: 'Flow: DEVBOX delivery · Lead: DEVBOX Coordinator\n',
  step: { name: 'Develop', kind: 'work', position: 1 },
  next: 'Code review',
  sendsBackTo: null,
  round: 1,
  folder: 'tasks/T-12/artifacts/1-develop/round-1',
  handoff: { arrival: { kind: 'new', from: null, reason: null }, reply: null, artifacts: [] },
  tools: true,
  ...overrides,
});

const YOUR_TOOLS =
  'Your move is recorded when you call it and applied when your turn ends; calling another one replaces it. ' +
  'task_read shows the task, task_attach {name, text | path | url} keeps a note, a file of your outputs folder or a ' +
  'link with the task now, and task_blocked {reason} says you cannot go on. Without a move, a person reads your ' +
  'reply and moves the task.';

describe('stepPrompt with the step’s tools', () => {
  it('Work: call task_hand_on with the hand-off, then end the turn; the tools in place of "nobody moves it"', () => {
    const text = stepPrompt(input(), 'full');
    expect(text).toContain(
      '## Your step\n\nDo the work the task asks for. Then call task_hand_on with your hand-off for "Code review" ' +
        '(what you did, where it is: branch, commit, files; what to check) and end your turn.\n\n' +
        YOUR_TOOLS,
    );
    expect(text).not.toContain('Nobody moves the task for you yet');
    const last = stepPrompt(input({ next: null }), 'full');
    expect(last).toContain('call task_hand_on with your hand-off for the person who closes it');
  });

  it('Check and Sign-off: pass, approve or send back with their tools, and where a send-back goes', () => {
    const check = stepPrompt(
      input({ step: { name: 'Code review', kind: 'check', position: 2 }, sendsBackTo: 'Develop' }),
      'full',
    );
    expect(check).toContain(
      'Check the work handed to you against the task; do not fix it yourself. Then call task_pass (with your ' +
        'findings, if any) or task_send_back {reason, findings: what is wrong, where, and what to change}, and end ' +
        'your turn. A send-back returns the task to "Develop" for another round.',
    );
    const signoff = stepPrompt(input({ step: { name: 'Approve', kind: 'signoff', position: 3 } }), 'full');
    expect(signoff).toContain(
      'Decide whether the task is done. Call task_approve (with a note, if any) or task_send_back {reason, findings}, and end your turn.',
    );
  });

  it('the delta names the move too, and without the tools the prompt is as before', () => {
    expect(stepPrompt(input(), 'delta')).toContain('Then call task_hand_on');
    expect(stepPrompt(input({ round: 2 }), 'delta')).toContain('Then call task_hand_on');
    const plain = stepPrompt(input({ tools: false }), 'full');
    expect(plain).toContain('Nobody moves the task for you yet');
    expect(plain).not.toContain('task_hand_on');
    const { tools: _tools, ...older } = input();
    expect(stepPrompt(older, 'full')).toBe(plain);
  });
});
