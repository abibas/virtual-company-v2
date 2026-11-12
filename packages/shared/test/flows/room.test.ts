import { describe, expect, it } from 'vitest';
import { CHAT_PROMPT } from '../../src/chats.ts';
import { RoomMessageKind, StepEndAction } from '../../src/enums.ts';
import {
  isSilentReply,
  mentionedAgents,
  NOTHING_TO_ADD,
  ROOM,
  ROOM_ASK,
  ROOM_LINE_MAX,
  ROOM_PROMPT_LINES,
  ROOM_REPLY_MAX,
  roomPrompt,
  roomReply,
  stepEndMove,
  stepEndText,
  stepEndWords,
} from '../../src/flows.ts';

const agents = [
  { principalId: 'p-lead', name: 'DEVBOX Coordinator', slug: 'devbox-coordinator' },
  { principalId: 'p-dev', name: 'Developer', slug: 'developer' },
  { principalId: 'p-rev', name: 'Code Reviewer', slug: 'code-reviewer' },
  { principalId: 'p-qa', name: 'QA', slug: 'qa' },
];

describe('the team room’s contract', () => {
  it('lists the kinds and actions the database CHECKs allow, and the cap’s default', () => {
    expect(RoomMessageKind.options).toEqual(['message', 'step_end', 'reply', 'notice']);
    expect(StepEndAction.options).toEqual([
      'hand_on',
      'pass',
      'approve',
      'send_back',
      'escalated',
      'blocked',
      'turn_ended',
    ]);
    expect(ROOM.maxPerHour.default).toBe(30);
  });

  it('keeps silent an empty reply and the marker alone, in any case or quoted', () => {
    for (const silent of [
      null,
      undefined,
      '',
      '  \n',
      NOTHING_TO_ADD,
      ' nothing_to_add. ',
      '`NOTHING_TO_ADD`',
      '"NOTHING_TO_ADD"',
    ])
      expect(isSilentReply(silent)).toBe(true);
    for (const said of ['NOTHING_TO_ADD, but the tests fail', 'Nothing to add here', 'Ship it'])
      expect(isSilentReply(said)).toBe(false);
  });

  it('cuts a long reply with an ellipsis and trims a short one', () => {
    expect(roomReply('  Ship it.  ')).toBe('Ship it.');
    const long = roomReply('x'.repeat(ROOM_REPLY_MAX + 50));
    expect(long).toHaveLength(ROOM_REPLY_MAX);
    expect(long.endsWith('…')).toBe(true);
  });

  it('says each step end’s move', () => {
    const at = (action: StepEndAction, to: string | null) => stepEndMove({ action, from: 'QA', to });
    expect(at('hand_on', 'Approve')).toBe('QA → Approve');
    expect(at('hand_on', null)).toBe('QA → Done');
    expect(at('pass', 'Approve')).toBe('QA passed → Approve');
    expect(at('approve', null)).toBe('QA approved → Done');
    expect(at('send_back', 'Develop')).toBe('QA sent back → Develop');
    expect(at('escalated', null)).toBe('QA escalated → Lead');
    expect(at('blocked', null)).toBe('QA · blocked');
    expect(at('turn_ended', null)).toBe('QA · no hand-off');
  });

  it('writes a step-end line from the agent’s words, one line and clipped', () => {
    const details = { action: 'hand_on', from: 'Develop', to: 'Code review', round: 1 } as const;
    expect(stepEndText('T-2', details, 'three scripts and their logs')).toBe(
      'T-2 · Develop → Code review: three scripts and their logs',
    );
    expect(stepEndText('T-2', details, '')).toBe('T-2 · Develop → Code review');
    expect(stepEndWords('three\n\nscripts')).toBe('three scripts');
    expect(stepEndWords(null)).toBe('');
    expect(stepEndWords('y'.repeat(400))).toHaveLength(ROOM_LINE_MAX);
  });

  it('finds the agents an "@" names by name or slug, any case, whole words only', () => {
    expect(mentionedAgents('Ship it today?', agents)).toEqual([]);
    expect(mentionedAgents('@developer and @Code Reviewer, look at T-2', agents)).toEqual(['p-dev', 'p-rev']);
    expect(mentionedAgents('@code-reviewer please', agents)).toEqual(['p-rev']);
    expect(mentionedAgents('(@qa) and @DEVBOX coordinator', agents)).toEqual(['p-lead', 'p-qa']);
    expect(mentionedAgents('@QAbot and mail@qa.com and @Developers', agents)).toEqual([]);
  });

  it('writes a room turn’s prompt: the room, the team, what came since, the message and the ask', () => {
    const prompt = roomPrompt({
      flow: 'DEVBOX delivery',
      you: 'Code Reviewer',
      lead: 'DEVBOX Coordinator',
      agents: ['DEVBOX Coordinator', 'Developer', 'Code Reviewer'],
      people: ['Ihor Herasko'],
      earlier: [
        { author: 'Developer', kind: 'step_end', text: 'T-2 · Develop → Code review: three scripts' },
        { author: 'Most Wanted', kind: 'notice', text: 'DEVBOX delivery: check-in,\n3 open tasks.' },
      ],
      message: { author: 'Ihor Herasko', text: ' Should we ship T-2 today? ' },
    });
    expect(prompt).toBe(
      [
        'Most Wanted · DEVBOX delivery team room. You are Code Reviewer.',
        'Agents: DEVBOX Coordinator, Developer, Code Reviewer; people: Ihor Herasko.',
        '',
        'Since your last turn here:',
        '- Developer (step end): T-2 · Develop → Code review: three scripts',
        '- Most Wanted: DEVBOX delivery: check-in, 3 open tasks.',
        '',
        'Ihor Herasko wrote:',
        'Should we ship T-2 today?',
        '',
        ROOM_ASK,
      ].join('\n'),
    );
  });

  it('names the Lead as such, leaves out what came since when nothing did, and stays within a prompt', () => {
    const lead = roomPrompt({
      flow: 'F',
      you: 'Vega',
      lead: null,
      agents: ['Vega'],
      people: [],
      earlier: [],
      message: { author: 'Olena', text: 'Hi' },
    });
    expect(lead).toBe(
      `Most Wanted · F team room. You are Vega, the team's Lead.\nAgents: Vega.\n\nOlena wrote:\nHi\n\n${ROOM_ASK}`,
    );
    const many = roomPrompt({
      flow: 'F',
      you: 'Vega',
      lead: null,
      agents: ['Vega'],
      people: [],
      earlier: Array.from({ length: 80 }, (_, i) => ({
        author: `A${i}`,
        kind: 'reply' as const,
        text: 'z'.repeat(900),
      })),
      message: { author: 'Olena', text: 'w'.repeat(4000) },
    });
    expect(many.length).toBeLessThanOrEqual(CHAT_PROMPT.max);
    expect(many).not.toContain('- A49:');
    expect(many).toContain('- A79:');
    expect(many.split('\n').filter((line) => line.startsWith('- A')).length).toBeLessThanOrEqual(
      ROOM_PROMPT_LINES.count,
    );
  });
});
