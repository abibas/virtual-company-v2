import type { ChatTurnStatus } from '@mwc/shared/enums';
import type { TaskDetail } from '../../../api/flows.ts';
import type { Chat, ChatTurnWithEvents, TurnEvent } from '../../../api/types.ts';
import { ago, ref } from './flow-sample.ts';

/**
 * The gallery's task conversations (S5.3b), as `GET /tasks/:key` lists them and `GET /chats/:id` gives their turns:
 * T-12's Develop (Keep, rounds 1–3), Code review (Keep, rounds 1–3) and QA (Fresh, rounds 1 and 2), all ended; T-18's Develop
 * running now; T-17's Code review ended without a hand-off.
 */

type Conversation = TaskDetail['conversations'][number];

const HOME = '/Users/ihor/agents';

interface Spec {
  readonly chatId: string;
  readonly step: readonly [id: string, name: string];
  readonly round: number;
  readonly agent: string;
  readonly status: ChatTurnStatus;
  /** Its last activity, minutes ago; its start a day before the task's first move. */
  readonly minutes: number;
}

const SPECS: Readonly<Record<string, readonly Spec[]>> = {
  'T-12': [
    {
      chatId: 'c-12-dev',
      step: ['s-dev', 'Develop'],
      round: 1,
      agent: 'p-mason',
      status: 'done',
      minutes: 182,
    },
    {
      chatId: 'c-12-rev',
      step: ['s-review', 'Code review'],
      round: 1,
      agent: 'p-juno',
      status: 'done',
      minutes: 92,
    },
    { chatId: 'c-12-qa', step: ['s-qa', 'QA'], round: 1, agent: 'p-pip', status: 'done', minutes: 6 * 60 },
    { chatId: 'c-12-qa-2', step: ['s-qa', 'QA'], round: 2, agent: 'p-pip', status: 'done', minutes: 10 },
  ],
  'T-18': [
    {
      chatId: 'c-18-dev',
      step: ['s-dev', 'Develop'],
      round: 1,
      agent: 'p-mason',
      status: 'running',
      minutes: 1,
    },
  ],
  'T-17': [
    {
      chatId: 'c-17-rev',
      step: ['s-review', 'Code review'],
      round: 1,
      agent: 'p-juno',
      status: 'done',
      minutes: 70,
    },
  ],
};

/** A sample task's conversations, oldest first. */
export const sampleConversations = (key: string): Conversation[] =>
  (SPECS[key] ?? []).map((spec) => ({
    chatId: spec.chatId,
    machine: 'Airia devbox',
    step: { id: spec.step[0], name: spec.step[1] },
    round: spec.round,
    agent: ref(spec.agent),
    title: `${key} · ${spec.step[1]} · a sample`,
    started: true,
    lastTurn: {
      status: spec.status,
      at: ago(spec.minutes),
      waitsForMachine: false,
      machineWait: null,
      reconnecting: false,
    },
    createdAt: ago(60 * 26),
  }));

/** The chat of a sample conversation, for "Open in Claude Code". */
export function sampleChat(conversation: Conversation): Chat {
  return {
    id: conversation.chatId,
    agentId: `a-${conversation.agent?.slug ?? 'mason'}`,
    harness: 'claude_code',
    machineId: 'mc-1',
    profileId: null,
    profileSetBy: null,
    sessionId: `${conversation.chatId}-session`,
    title: conversation.title,
    branchedFromChatId: null,
    branchedFromTurnId: null,
    forkPending: false,
    task: { taskId: 't-12', stepId: conversation.step.id, round: conversation.round },
    flowId: null,
    overrides: { mode: null, model: null, effort: null },
    createdBy: 'p-1',
    createdAt: conversation.createdAt,
    updatedAt: conversation.lastTurn?.at ?? conversation.createdAt,
    archivedAt: null,
  };
}

/** The folder a sample conversation began in. */
export const sampleCwd = (conversation: Conversation) => `${HOME}/${conversation.agent?.slug ?? 'mason'}`;

const turn = (
  chatId: string,
  seq: number,
  prompt: string,
  events: readonly TurnEvent[],
  minutes: number,
  status: ChatTurnStatus = 'done',
): ChatTurnWithEvents => {
  const reply = events.findLast((e) => e.type === 'result');
  return {
    id: `${chatId}-t${seq}`,
    chatId,
    seq,
    kind: 'message',
    prompt,
    status,
    delivery: null,
    system: false,
    from: null,
    machineWaitAt: null,
    machineWait: null,
    profileId: null,
    credentialId: null,
    mode: 'manual',
    model: 'claude-opus-5-5',
    effort: 'high',
    startedAt: ago(minutes),
    endedAt: status === 'running' ? null : ago(minutes - 4),
    resultText: reply?.type === 'result' ? (reply.text ?? null) : null,
    error: null,
    usage: status === 'running' ? null : { inputTokens: 48_210, outputTokens: 2_904, includedInPlan: true },
    createdBy: 'p-1',
    createdAt: ago(minutes),
    events: events.map((event, index) => ({ seq: index + 1, event, at: ago(minutes - index * 0.2) })),
  };
};

const init = (slug: string): TurnEvent => ({
  type: 'init',
  model: 'claude-opus-5-5',
  effort: 'high',
  cwd: `${HOME}/${slug}`,
});
const tool = (id: string, name: string, summary: string, result: string): TurnEvent[] => [
  { type: 'tool', id, name, summary },
  { type: 'tool_result', id, ok: true, summary: result },
];
const reply = (text: string): TurnEvent[] => [
  { type: 'text', text },
  { type: 'result', ok: true, text, durationMs: 214_000 },
];

const FIRST = (step: string, n: number) =>
  `# T-12 · Fix the login on Safari\n\nYou are working on task T-12 at step ${n}, "${step}", of the flow DEVBOX delivery.`;

const DEV_REPLY_2 = `Added the Safari path test.

- \`auth.test.ts\`: signs in through the redirect with \`SameSite=Lax\` and checks the session survives
- \`pnpm test auth\`: 14 passed

Hand-off: branch \`fix/safari-login\`, notes in \`notes.md\`, a screenshot in \`shots/\`.`;

const TURNS: Readonly<Record<string, readonly ChatTurnWithEvents[]>> = {
  'c-12-dev': [
    turn(
      'c-12-dev',
      1,
      FIRST('Develop', 1),
      [
        init('mason'),
        {
          type: 'thinking',
          text: 'The cookie is dropped after the cross-site redirect: check where it is set.',
        },
        ...tool('d1', 'Grep', 'SameSite in apps/server/src', '3 matches'),
        ...tool('d2', 'Edit', 'apps/server/src/platform/http/session.ts', '+2 −1'),
        ...reply('Set `SameSite=Lax` on the session cookie and kept `redirect_url` through the round trip.'),
      ],
      60 * 25,
    ),
    turn(
      'c-12-dev',
      2,
      'Task T-12 is back at your step "Develop" (Work): round 2.\n\n"Code review" sent it back to you for round 2.',
      [
        init('mason'),
        {
          type: 'todo',
          items: [
            { text: 'Add the Safari redirect test', status: 'completed' },
            { text: 'Run the auth tests', status: 'completed' },
            { text: 'Write the hand-off notes', status: 'completed' },
          ],
        },
        {
          type: 'subagent',
          id: 'd3',
          agentType: 'Explore',
          description: 'Find the existing sign-in tests',
          status: 'done',
          summary: 'apps/server/test/platform/http/auth.test.ts covers Chrome only.',
        },
        ...tool('d4', 'Write', 'apps/server/test/platform/http/auth.test.ts', '+38'),
        ...tool('d5', 'Bash', 'pnpm test auth', '14 passed'),
        ...reply(DEV_REPLY_2),
      ],
      185,
    ),
  ],
  'c-12-rev': [
    turn(
      'c-12-rev',
      1,
      FIRST('Code review', 2),
      [init('juno'), ...reply('SEND BACK\nNo test for the Safari path.')],
      60 * 18,
    ),
    turn(
      'c-12-rev',
      2,
      'Task T-12 is back at your step "Code review" (Check): round 2.',
      [
        init('juno'),
        ...tool('r1', 'Bash', 'git diff main...fix/safari-login', '3 files'),
        ...reply('PASS\nThe test covers it.'),
      ],
      95,
    ),
  ],
  'c-12-qa': [
    turn(
      'c-12-qa',
      1,
      FIRST('QA', 3),
      [
        init('pip'),
        ...tool('q1', 'Bash', 'playwright test safari-login', '1 passed'),
        ...reply('PASS\nSigned in on Safari 19.'),
      ],
      14,
    ),
  ],
  'c-18-dev': [
    turn(
      'c-18-dev',
      1,
      '# T-18 · Fix the login redirect loop\n\nYou are working on task T-18 at step 1, "Develop".',
      [
        init('mason'),
        {
          type: 'thinking',
          text: 'The loop starts when the session check redirects before the cookie is read.',
        },
        ...tool('l1', 'Read', 'apps/web/src/app/session.tsx', '212 lines'),
        { type: 'tool', id: 'l2', name: 'Bash', summary: 'pnpm test session' },
      ],
      2,
      'running',
    ),
  ],
  'c-17-rev': [
    turn(
      'c-17-rev',
      1,
      '# T-17 · Cache the org chart for a minute\n\nYou are working on task T-17 at step 2, "Code review".',
      [init('juno'), ...reply('PASS\nThe cache key includes the company; one nit left in a comment.')],
      74,
    ),
  ],
};

/** A sample conversation's turns. */
export const sampleTurns = (chatId: string): readonly ChatTurnWithEvents[] => TURNS[chatId] ?? [];
