import { leadWakeMessage } from '@mwc/shared/flows';
import type { ChatTurnWithEvents, TurnEvent } from '../../api/types.ts';
import { ago } from './flows/flow-sample.ts';

/**
 * A Lead's team chat in the gallery's rail (S6c): Most Wanted's wake-up about a blocked task, then a message from
 * another person (Olena, on the left) and one from the reader (Ihor, on the right), each with Vega's reply.
 */

const CHAT = 'c-team-vega';

const turn = (
  seq: number,
  prompt: string,
  by: { readonly principalId: string; readonly system?: boolean },
  reply: string,
  minutes: number,
): ChatTurnWithEvents => {
  const events: TurnEvent[] = [
    { type: 'init', model: 'claude-opus-5-5', effort: 'xhigh', cwd: '/Users/ihor/agents/vega' },
    { type: 'text', text: reply },
    { type: 'result', ok: true, text: reply, durationMs: 41_000 },
  ];
  return {
    id: `${CHAT}-t${seq}`,
    chatId: CHAT,
    seq,
    kind: 'message',
    prompt,
    status: 'done',
    delivery: null,
    system: by.system ?? false,
    machineWaitAt: null,
    machineWait: null,
    profileId: null,
    credentialId: null,
    startedAt: ago(minutes),
    endedAt: ago(minutes - 1),
    resultText: reply,
    error: null,
    usage: { inputTokens: 12_480, outputTokens: 610, includedInPlan: true },
    createdBy: by.principalId,
    createdAt: ago(minutes),
    events: events.map((event, index) => ({ seq: index + 1, event, at: ago(minutes - index * 0.2) })),
  };
};

const WAKE = leadWakeMessage({
  flow: 'DEVBOX delivery',
  person: 'Ihor Herasko',
  events: [
    {
      kind: 'blocked',
      task: { key: 'T-12', title: 'Fix the login on Safari' },
      step: 'Code review',
      reason: 'The Safari test needs a signed-in session cookie that the review machine does not have.',
    },
  ],
});

export const TEAM_CHAT_TURNS: readonly ChatTurnWithEvents[] = [
  turn(
    1,
    WAKE,
    { principalId: 'p-vega', system: true },
    'Asked Mason to add a fixture session for the review machine; T-12 goes back to Code review once it lands.',
    48,
  ),
  turn(
    2,
    'Hold T-14 until the new sign-in screens are approved.',
    { principalId: 'p-2' },
    'Held T-14 at Develop with that note; it waits for the design sign-off.',
    30,
  ),
  turn(
    3,
    'Ship T-12 as soon as QA passes.',
    { principalId: 'p-1' },
    'Will do: T-12 goes to the PR step right after QA approves.',
    12,
  ),
];
