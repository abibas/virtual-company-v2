import { describe, expect, it } from 'vitest';
import {
  clipText,
  PROMPT_ARTIFACTS_MAX,
  PROMPT_CUT,
  PROMPT_REPLY_MAX,
  type PromptArtifact,
  STEP_PROMPT_MAX,
  type StepPromptInput,
  sizeWords,
  stepPrompt,
} from '../../src/flows.ts';

const FLOW = [
  'Flow: DEVBOX delivery · Lead: DEVBOX Coordinator',
  '',
  'Step          Kind    Who             Comes back again   Sends back to   Limit',
  'Develop       Work    Developer       Keep               —               —',
  'Code review   Check   Code Reviewer   Keep               Develop         3 → Lead',
  '→ Done',
  '',
].join('\n');

const develop = (overrides: Partial<StepPromptInput> = {}): StepPromptInput => ({
  task: { key: 'T-12', title: 'Fix the login', description: 'The login form accepts an empty password.' },
  flowText: FLOW,
  step: { name: 'Develop', kind: 'work', position: 1 },
  next: 'Code review',
  sendsBackTo: null,
  round: 1,
  folder: 'tasks/T-12/artifacts/1-develop/round-1',
  handoff: { arrival: { kind: 'new', from: null, reason: null }, reply: null, artifacts: [] },
  ...overrides,
});

const note = (step: string, round: number, name = 'hand-off note', size = 1229): PromptArtifact => ({
  step,
  round,
  name,
  kind: name === 'hand-off note' ? 'note' : 'file',
  size,
});

describe('stepPrompt, full', () => {
  it('Develop, round 1: the task, the flow, the step, a new hand-off and where outputs go', () => {
    const text = stepPrompt(develop(), 'full');
    expect(text).toBe(
      [
        '# T-12 · Fix the login',
        '',
        'You are working on task T-12 at step 1, "Develop" (Work), round 1 of its flow.',
        '',
        '## The task',
        '',
        'The login form accepts an empty password.',
        '',
        '## The flow',
        '',
        FLOW.trimEnd(),
        '',
        'You are at "Develop".',
        '',
        '## Your step',
        '',
        'Do the work the task asks for. End your turn with a short hand-off for "Code review": what you did, where it ' +
          'is (branch, commit, files) and what to check.',
        '',
        'Nobody moves the task for you yet: when your turn ends, a person reads your reply and moves the task on.',
        '',
        '## The hand-off',
        '',
        'The task is new here: no step handed anything on yet.',
        '',
        '## Your outputs',
        '',
        'Write the files you make for this step (notes, logs, screenshots) to ' +
          '`tasks/T-12/artifacts/1-develop/round-1/`, relative to the working directory your turn starts in, where ' +
          'it is made for you (not under `~`, unless that is where you start). When your turn ends they are collected and ' +
          'kept with the task: text and images, up to 2.0 MB each and 20 files. Your final reply is kept as the ' +
          "step's hand-off note.",
      ].join('\n'),
    );
  });

  it('Code review, round 1: the check, its verdict and send-back, what Develop handed on and its artifacts', () => {
    const text = stepPrompt(
      develop({
        step: { name: 'Code review', kind: 'check', position: 2 },
        next: null,
        sendsBackTo: 'Develop',
        folder: 'tasks/T-12/artifacts/2-code-review/round-1',
        handoff: {
          arrival: { kind: 'handed_on', from: 'Develop', reason: null },
          reply: 'Fixed on branch fix-login, commit abc123.\n\nCheck the empty-password test.',
          artifacts: [note('1-develop', 1), note('1-develop', 1, 'notes.md', 340)],
        },
      }),
      'full',
    );
    expect(text).toContain('at step 2, "Code review" (Check), round 1 of its flow.');
    expect(text).toContain(
      'End your turn with your verdict alone on its first line, PASS or SEND BACK, then your findings',
    );
    expect(text).toContain('A send-back returns the task to "Develop" for another round.');
    expect(text).toContain(
      '"Develop" handed it on to you.\n\nThe last reply of "Develop":\n> Fixed on branch fix-login, commit abc123.\n>\n> Check the empty-password test.',
    );
    expect(text).toContain(
      'The task’s artifacts so far (kept with the task):\n- 1-develop/round-1/hand-off note (note, 1.2 KB)\n- 1-develop/round-1/notes.md (file, 340 B)',
    );
  });

  it('Fresh, round 2 after a send-back: the reason and findings with the round, the reviewer’s reply', () => {
    const text = stepPrompt(
      develop({
        round: 2,
        folder: 'tasks/T-12/artifacts/1-develop/round-2',
        handoff: {
          arrival: {
            kind: 'sent_back',
            from: 'Code review',
            reason: 'Empty passwords still pass.\nAdd a test.',
          },
          reply: 'SEND BACK\nThe check is missing in LoginForm.tsx.',
          artifacts: [],
        },
      }),
      'full',
    );
    expect(text).toContain('round 2 of its flow.');
    expect(text).toContain(
      '"Code review" sent it back to you for round 2.\n\nTheir reason and findings:\n> Empty passwords still pass.\n> Add a test.',
    );
    expect(text).toContain(
      'The last reply of "Code review":\n> SEND BACK\n> The check is missing in LoginForm.tsx.',
    );
    expect(text).toContain('`tasks/T-12/artifacts/1-develop/round-2/`');
  });

  it('a Sign-off asks to approve or send back; a last Work step hands on to the person who closes it', () => {
    const signoff = stepPrompt(
      develop({
        step: { name: 'Approve', kind: 'signoff', position: 4 },
        next: null,
        sendsBackTo: 'Develop',
      }),
      'full',
    );
    expect(signoff).toContain(
      'Decide whether the task is done. End your turn with APPROVE or SEND BACK alone',
    );
    expect(signoff).toContain('A send-back returns the task to "Develop"');
    const last = stepPrompt(develop({ next: null }), 'full');
    expect(last).toContain('a short hand-off for the person who closes it');
    const check = stepPrompt(develop({ step: { name: 'QA', kind: 'check', position: 3 } }), 'full');
    expect(check).not.toContain('A send-back returns');
  });

  it('says how each arrival came', () => {
    const line = (
      kind: StepPromptInput['handoff']['arrival']['kind'],
      from: string | null,
      reason: string | null,
    ) =>
      stepPrompt(
        develop({ handoff: { arrival: { kind, from, reason }, reply: null, artifacts: [] } }),
        'full',
      );
    expect(line('passed', 'QA', null)).toContain('"QA" passed it.');
    expect(line('signed_off', 'Approve', null)).toContain('"Approve" approved it.');
    expect(line('handed_on', null, null)).toContain('The step before handed it on to you.');
    expect(line('sent_back', null, 'x')).toContain('A later step sent it back to you for round 1.');
    expect(line('routed', 'QA', 'Skip the review')).toContain(
      'The team\'s Lead put it at this step from "QA".\n\nWhy:\n> Skip the review',
    );
    expect(line('routed', null, null)).toContain("The team's Lead put it at this step.");
    expect(line('retried', null, null)).toContain("It came back after an escalation to the team's Lead.");
  });

  it('writes "(no description)" for a blank one, and keeps the reply only when it names its step', () => {
    const text = stepPrompt(
      develop({
        task: { key: 'T-1', title: 'x', description: '  ' },
        handoff: { arrival: { kind: 'new', from: null, reason: null }, reply: 'orphan', artifacts: [] },
      }),
      'full',
    );
    expect(text).toContain('## The task\n\n(no description)');
    expect(text).not.toContain('orphan');
  });

  it('stays within a chat prompt: the description gives way, a long reply is cut, the artifacts are the latest', () => {
    const artifacts = Array.from({ length: PROMPT_ARTIFACTS_MAX + 5 }, (_, i) =>
      note('1-develop', 1, `f${i}.md`, i),
    );
    const text = stepPrompt(
      develop({
        task: { key: 'T-9', title: 'Big', description: 'd'.repeat(50_000) },
        handoff: {
          arrival: { kind: 'handed_on', from: 'Develop', reason: null },
          reply: 'r'.repeat(PROMPT_REPLY_MAX + 100),
          artifacts,
        },
      }),
      'full',
    );
    expect(text.length).toBeLessThanOrEqual(STEP_PROMPT_MAX);
    expect(text).toContain(PROMPT_CUT);
    expect(text).toContain('## Your outputs');
    expect(text).toContain('- … and 5 earlier\n- 1-develop/round-1/f5.md');
    expect(text).not.toContain('f4.md');
    expect(text).toContain(`> ${'r'.repeat(100)}`);
    expect(text.match(/r{4000,}/)).toBeNull();
  });
});

describe('stepPrompt, delta (Keep: the conversation continues)', () => {
  it('a send-back back to Develop: only the hand-off since its last round, the outputs and the ask', () => {
    const text = stepPrompt(
      develop({
        round: 2,
        folder: 'tasks/T-12/artifacts/1-develop/round-2',
        handoff: {
          arrival: { kind: 'sent_back', from: 'Code review', reason: 'Empty passwords still pass.' },
          reply: 'SEND BACK\nThe check is missing.',
          artifacts: [note('2-code-review', 1)],
        },
      }),
      'delta',
    );
    expect(
      text.startsWith('Task T-12 is back at your step "Develop" (Work): round 2.\n\n## The hand-off\n\n'),
    ).toBe(true);
    expect(text).toContain('"Code review" sent it back to you for round 2.');
    expect(text).toContain(
      'New artifacts since your last round:\n- 2-code-review/round-1/hand-off note (note, 1.2 KB)',
    );
    expect(text).toContain('`tasks/T-12/artifacts/1-develop/round-2/`');
    expect(text).not.toContain('## The task');
    expect(text).not.toContain('## The flow');
  });

  it('round 1 again (a Start after a block): continue where it left off', () => {
    const text = stepPrompt(develop(), 'delta');
    expect(
      text.startsWith('Continue task T-12 at your step "Develop" (Work), round 1, where you left off.'),
    ).toBe(true);
    expect(text).toContain('`tasks/T-12/artifacts/1-develop/round-1/`');
    expect(text).not.toContain('## The hand-off');
  });
});

describe('the helpers', () => {
  it('clipText keeps a short text and cuts a long one with its marker', () => {
    expect(clipText('short', 10)).toBe('short');
    const cut = clipText('x'.repeat(200), 100);
    expect(cut.length).toBeLessThanOrEqual(100);
    expect(cut.endsWith(PROMPT_CUT)).toBe(true);
  });

  it('sizeWords says bytes, KB and MB', () => {
    expect(sizeWords(340)).toBe('340 B');
    expect(sizeWords(1229)).toBe('1.2 KB');
    expect(sizeWords(2 * 1024 * 1024)).toBe('2.0 MB');
  });
});
