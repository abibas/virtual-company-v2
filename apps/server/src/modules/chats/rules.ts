import { CHAT_TITLE } from '@mwc/shared/chats';
import type { ChatTurnKind, ChatTurnStatus, Harness } from '@mwc/shared/enums';
import { contextWindowOf, type InitEvent, type TurnEvent } from '@mwc/shared/harness';
import type { ChatContextView } from './schemas.ts';

/**
 * The chats' own rules (S5.1b, docs/harness.md "How a turn runs"): their refusals, a chat's title from its first prompt,
 * the access profile slot each harness runs on, how a turn's end becomes its status, reply and usage, and (S5.2) what
 * the chat's conversation runs on and how full it is since its last Clear. Pure.
 */

export type RefusalStatus = 403 | 404 | 409 | 422 | 503;

/** A refusal the routes answer in the common error shape. */
export interface Refusal<S extends RefusalStatus = RefusalStatus> {
  readonly ok: false;
  readonly status: S;
  readonly code: string;
  readonly message: string;
}

export const refuse = <S extends RefusalStatus>(status: S, code: string, message: string): Refusal<S> => ({
  ok: false,
  status,
  code,
  message,
});

export const AGENT_NOT_FOUND = refuse(404, 'agent_not_found', 'No such agent in this company');
export const CHAT_NOT_FOUND = refuse(404, 'chat_not_found', 'No such chat in this company');
export const TURN_NOT_FOUND = refuse(404, 'turn_not_found', 'No such turn in this chat');
export const CHAT_ARCHIVED = refuse(409, 'chat_archived', 'This chat is archived; start a new chat');
export const TURN_RUNNING = refuse(
  409,
  'turn_running',
  'A turn of this chat is running; wait for it or stop it',
);
export const TURN_NOT_RUNNING = refuse(409, 'turn_not_running', 'This turn is not running');
export const NOTHING_TO_COMPACT = refuse(
  409,
  'nothing_to_compact',
  'This chat has no conversation yet: send a prompt first',
);
export const NOTHING_TO_CLEAR = refuse(409, 'nothing_to_clear', 'This chat has no conversation to clear');
export const COMPACT_UNSUPPORTED = refuse(
  409,
  'compact_unsupported',
  'Codex compacts its conversation by itself and runs no /compact in a turn: use Clear to start over',
);
export const PLACEMENT_MISSING = refuse(
  409,
  'placement_missing',
  'The agent has no placement: choose where it runs first',
);
export const CONTAINER_RUNS_LATER = refuse(
  409,
  'container_runs_later',
  'The agent runs in a container, which chats do not support yet: place it on its machine (host)',
);
export const MACHINE_CHANGED = refuse(
  409,
  'machine_changed',
  "The agent's placement moved to another machine since this chat began: start a new chat",
);
export const HARNESS_CHANGED = refuse(
  409,
  'harness_changed',
  "The agent's harness changed since this chat began: start a new chat",
);
export const MACHINE_OFFLINE = refuse(409, 'machine_offline', "The agent's machine has no connected runner");
export const RUNNER_OUTDATED = refuse(
  409,
  'runner_outdated',
  "The machine's runner is older than chats: update the runner",
);
export const TERMINAL_UNAVAILABLE = refuse(
  409,
  'terminal_unavailable',
  "The machine's runner has no terminal",
);
export const PROFILE_MISSING = refuse(
  422,
  'profile_missing',
  'Neither the chat nor the agent has an access profile: give the agent one, or choose one for this chat',
);
export const PROFILE_OWNER_GONE = refuse(
  422,
  'profile_missing',
  "The chat's access profile belongs to someone who is no longer an admin here: choose another one",
);

/** The harness's CLI is not on the machine's runner. */
export const harnessMissing = (harness: Harness): Refusal<409> =>
  refuse(
    409,
    'harness_missing',
    `The machine has no ${HARNESS_NAMES[harness]}: install it there, then try again`,
  );

/** The harnesses' names, as messages show them. */
export const HARNESS_NAMES: Readonly<Record<Harness, string>> = {
  claude_code: 'Claude Code',
  codex: 'Codex',
};

/** The access profile slot a harness runs on. */
export type ProfileSlot = 'claude' | 'openai';
export const HARNESS_SLOT: Readonly<Record<Harness, ProfileSlot>> = {
  claude_code: 'claude',
  codex: 'openai',
};

const SLOT_NAMES: Readonly<Record<ProfileSlot, string>> = { claude: 'Claude', openai: 'OpenAI' };

/** The profile has nothing in the slot the chat's harness needs. */
export const profileSlotEmpty = (slot: ProfileSlot): Refusal<422> =>
  refuse(
    422,
    'profile_slot_empty',
    `The access profile has no ${SLOT_NAMES[slot]} subscription (its ${slot} slot is empty): its owner adds one`,
  );

/** A chat's title: the first prompt on one line, cut to 80 characters with an ellipsis. */
export function titleOf(prompt: string): string {
  const line = prompt.replace(/\s+/g, ' ').trim();
  if (line.length <= CHAT_TITLE.max) return line || 'Chat';
  return `${line.slice(0, CHAT_TITLE.max - 1).trimEnd()}…`;
}

/** What a turn's events said by its end: its last result and usage. */
export interface TurnOutcome {
  readonly result?: Extract<TurnEvent, { type: 'result' }>;
  readonly usage?: Extract<TurnEvent, { type: 'usage' }>;
}

/** Keeps what an event adds to a turn's outcome. */
export function withEvent(outcome: TurnOutcome, event: TurnEvent): TurnOutcome {
  if (event.type === 'result') return { ...outcome, result: event };
  if (event.type === 'usage') return { ...outcome, usage: event };
  return outcome;
}

/** How a turn ended, as the runner said: its result's `ok`, and why the runner ended it, when it did. */
export interface TurnEnd {
  readonly ok: boolean;
  readonly error?: string;
}

/** The turn's row once it ended: its status (`stopped` when a person stopped it), reply, error and usage. */
export function endedTurn(end: TurnEnd, outcome: TurnOutcome, stopRequested: boolean) {
  const stopped = stopRequested || end.error === 'stopped';
  const status: ChatTurnStatus = end.ok && !stopped ? 'done' : stopped ? 'stopped' : 'failed';
  const error = status === 'done' ? null : (end.error ?? outcome.result?.error ?? 'The turn failed');
  const { type: _type, ...usage } = outcome.usage ?? { type: 'usage' };
  return {
    status,
    resultText: outcome.result?.text ?? null,
    error,
    usage: outcome.usage === undefined ? null : (usage as Record<string, unknown>),
  };
}

/** A turn that runs or waits for its machine. */
export const isLive = (status: ChatTurnStatus): boolean => status === 'queued' || status === 'running';

/** A turn with its events, in order, as the chat's detail reads them. */
export interface TurnWithEvents {
  readonly kind: ChatTurnKind;
  readonly events: readonly { readonly event: TurnEvent; readonly at: string }[];
}

/** What the chat's conversation runs on and how full it is (docs/harness.md, "Compact and Clear"). */
export interface ConversationState {
  readonly init: InitEvent | null;
  readonly context: ChatContextView | null;
}

/**
 * The chat's conversation since its last Clear (a `clear` turn forgets everything before it): its last `init`, and its
 * size, from the last `context` (input, cache reads and cache writes of the last request) or a later `compact` that
 * says its size after; the window is the `context`'s, else the model table's for the last `init`'s model.
 */
export function conversationState(turns: readonly TurnWithEvents[]): ConversationState {
  const state: { init: InitEvent | null; context: ChatContextView | null } = { init: null, context: null };
  for (const turn of turns) {
    if (turn.kind === 'clear') {
      state.init = null;
      state.context = null;
    }
    for (const { event, at } of turn.events) {
      const model = state.init?.model ?? null;
      if (event.type === 'init') state.init = event;
      else if (event.type === 'context') {
        const usedTokens = event.inputTokens + event.cacheReadTokens + event.cacheCreationTokens;
        state.context = { usedTokens, window: event.window ?? contextWindowOf(model), model, at };
      } else if (event.type === 'compact' && event.postTokens !== null) {
        const window = state.context?.window ?? contextWindowOf(model);
        state.context = { usedTokens: event.postTokens, window, model, at };
      }
    }
  }
  return state;
}
