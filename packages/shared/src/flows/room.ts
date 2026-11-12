import { CHAT_PROMPT } from '../chats.ts';
import type { RoomMessageKind, StepEndAction } from './enums.ts';
import { clipLine } from './wake.ts';

/**
 * A flow's team room (docs/processes.md "The team room"): one feed of the team's messages, each by a person, an agent
 * or Most Wanted. Its limits, the cap on the answers people's messages ask for, the silence marker, how a step-end line
 * reads, who an "@Name" names, and the prompt an agent's room turn gets. Pure.
 */

/** What a person may write in one message. */
export const ROOM_MESSAGE_MAX = 4_000;
/** What a stored message holds at most (a whole wake-up notice fits). */
export const ROOM_BODY_MAX = CHAT_PROMPT.max;
/** What the room keeps of an agent's reply. */
export const ROOM_REPLY_MAX = 8_000;
/** What a step-end line keeps of the agent's own words. */
export const ROOM_LINE_MAX = 280;
/** A page of the feed: the latest 100 unless asked, at most 200. */
export const ROOM_PAGE = { default: 100, max: 200 } as const;
/** The messages a room turn's prompt quotes from before the new one; each clipped to a line. */
export const ROOM_PROMPT_LINES = { count: 30, chars: 400 } as const;

/** The answers a room's messages may ask for in an hour (each agent asked is one): 30 unless the flow says. */
export const ROOM = { maxPerHour: { min: 1, max: 200, default: 30 } } as const;

/** What an agent answers when it has nothing useful for the team: the room posts nothing. */
export const NOTHING_TO_ADD = 'NOTHING_TO_ADD';

/** True for a reply the room keeps silent: empty, or the marker alone (any case, quoted or with a full stop). */
export function isSilentReply(text: string | null | undefined): boolean {
  const bare = (text ?? '').trim().replace(/^[`"'“*_]+|[`"'”*_.!]+$/g, '');
  return bare === '' || bare.toUpperCase() === NOTHING_TO_ADD;
}

/** An agent's reply as the room keeps it: trimmed, cut to `ROOM_REPLY_MAX` with an ellipsis. */
export function roomReply(text: string): string {
  const reply = text.trim();
  return reply.length <= ROOM_REPLY_MAX ? reply : `${reply.slice(0, ROOM_REPLY_MAX - 1).trimEnd()}…`;
}

/** What a step-end line keeps besides its words: the action, the step it ended, where the task went, the round. */
export interface StepEndDetails {
  readonly action: StepEndAction;
  readonly from: string;
  /** The next step, the step sent back to, or null: Done (or nowhere: blocked, no hand-off, escalated). */
  readonly to: string | null;
  readonly round: number;
}

/** A step-end line's head without the task: "Develop → Code review", "QA sent back → Develop", "Develop · blocked". */
export function stepEndMove(details: Pick<StepEndDetails, 'action' | 'from' | 'to'>): string {
  const { from, to } = details;
  const next = to ?? 'Done';
  switch (details.action) {
    case 'hand_on':
      return `${from} → ${next}`;
    case 'pass':
      return `${from} passed → ${next}`;
    case 'approve':
      return `${from} approved → ${next}`;
    case 'send_back':
      return `${from} sent back → ${next}`;
    case 'escalated':
      return `${from} escalated → Lead`;
    case 'blocked':
      return `${from} · blocked`;
    default:
      return `${from} · no hand-off`;
  }
}

/** A step-end line as text: "T-2 · Develop → Code review: three scripts and their logs". */
export function stepEndText(key: string, details: StepEndDetails, words: string): string {
  const head = `${key} · ${stepEndMove(details)}`;
  return words.trim() === '' ? head : `${head}: ${words}`;
}

/** The agent's own words for a step-end line: one line, cut to `ROOM_LINE_MAX`. */
export const stepEndWords = (text: string | null | undefined): string => clipLine(text ?? '', ROOM_LINE_MAX);

/** An agent of the room as an "@" names it: by its name or its slug. */
export interface RoomAgentName {
  readonly principalId: string;
  readonly name: string;
  readonly slug?: string | null | undefined;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `text` holds "@<label>" as a whole word (any case). */
const names = (text: string, label: string) =>
  label.trim() !== '' && new RegExp(`(^|[^\\w@])@${escaped(label.trim())}(?![\\w-])`, 'iu').test(text);

/**
 * The agents a message names with "@Name" or "@slug" (any case), in the room's order; empty when it names none, so the
 * message goes to every agent.
 */
export function mentionedAgents(text: string, agents: readonly RoomAgentName[]): string[] {
  return agents
    .filter((agent) => names(text, agent.name) || (agent.slug ? names(text, agent.slug) : false))
    .map((agent) => agent.principalId);
}

/** A message of the room as a room turn's prompt quotes it. */
export interface RoomPromptLine {
  readonly author: string;
  readonly kind: RoomMessageKind;
  readonly text: string;
}

/** What a room turn's prompt says: the room, who the agent is, the team, what came since its last turn, the message. */
export interface RoomPromptInput {
  readonly flow: string;
  readonly you: string;
  /** The Lead's name; null when the agent is the Lead. */
  readonly lead: string | null;
  readonly agents: readonly string[];
  readonly people: readonly string[];
  /** The room's messages since the agent's last turn there, oldest first, before the new one. */
  readonly earlier: readonly RoomPromptLine[];
  readonly message: { readonly author: string; readonly text: string };
}

/** The instruction every room turn ends with. */
export const ROOM_ASK =
  `Reply only if you have something useful for the team. Otherwise answer exactly ${NOTHING_TO_ADD}. ` +
  'Keep it short: a line or two. Your reply is posted in the room under your name.';

const KIND_MARK: Readonly<Record<RoomMessageKind, string>> = {
  message: '',
  step_end: ' (step end)',
  reply: '',
  notice: '',
};

/** One earlier message as a line of the prompt. */
const promptLine = (line: RoomPromptLine) =>
  `- ${line.author}${KIND_MARK[line.kind]}: ${clipLine(line.text, ROOM_PROMPT_LINES.chars)}`;

/**
 * A room turn's prompt: the room and the team, the latest messages since the agent's last turn there (at most
 * `ROOM_PROMPT_LINES.count`, the oldest dropped first), the new message, and `ROOM_ASK`; within a chat prompt.
 */
export function roomPrompt(input: RoomPromptInput): string {
  const role = input.lead === null ? `${input.you}, the team's Lead` : input.you;
  const people = input.people.length === 0 ? '' : `; people: ${input.people.join(', ')}`;
  const head = `Most Wanted · ${input.flow} team room. You are ${role}.\nAgents: ${input.agents.join(', ')}${people}.`;
  const message = `${input.message.author} wrote:\n${input.message.text.trim()}`;
  const room = CHAT_PROMPT.max - head.length - message.length - ROOM_ASK.length - 80;
  const lines: string[] = [];
  let used = 0;
  for (const line of input.earlier.slice(-ROOM_PROMPT_LINES.count).reverse()) {
    const text = promptLine(line);
    if (used + text.length + 1 > room) break;
    lines.unshift(text);
    used += text.length + 1;
  }
  const since = lines.length === 0 ? [] : [`Since your last turn here:\n${lines.join('\n')}`];
  return [head, ...since, message, ROOM_ASK].join('\n\n');
}
