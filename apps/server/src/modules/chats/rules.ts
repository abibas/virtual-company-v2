import { CHAT_TITLE } from '@mwc/shared/chats';
import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
import type { ChatTurnStatus, CredentialKind, Effort, Harness } from '@mwc/shared/enums';
import type { TurnEvent } from '@mwc/shared/harness';
import { PROVIDER_EFFORTS } from '@mwc/shared/models';

/**
 * The chats' own rules (S5.1b, docs/harness.md "How a turn runs"): their refusals, a chat's title from its first prompt,
 * how a turn's end becomes its status, reply and usage, and (S5.2) what
 * the chat's conversation runs on and how full it is since its last Clear (`rules/conversation.ts`). Pure.
 */

export {
  type ConversationState,
  conversationState,
  type TurnWithEvents,
} from './rules/conversation.ts';

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
export const AGENT_ARCHIVED = refuse(
  409,
  'agent_archived',
  'The agent is archived: restore it to chat with it',
);
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

/** The access profile the turn runs on holds no subscription (made empty, or its subscription removed). */
export const profileEmpty = (name: string): Refusal<422> =>
  refuse(
    422,
    'profile_empty',
    `The access profile ${name} has no subscription: its owner chooses one on their Access profiles page`,
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

/** The subscriptions whose turns cost nothing beyond the plan: the logins and Claude's setup token (not API keys). */
export const PLAN_KINDS: ReadonlySet<CredentialKind> = new Set([
  'claude_oauth',
  'claude_setup_token',
  'codex_oauth',
]);

/**
 * The turn's row once it ended: its status (`stopped` when a person stopped it), reply, error and usage; a turn on a
 * plan (`PLAN_KINDS`) keeps `includedInPlan: true` in its usage, so its cost reads "included in your plan".
 */
export function endedTurn(end: TurnEnd, outcome: TurnOutcome, stopRequested: boolean, kind?: CredentialKind) {
  const stopped = stopRequested || end.error === 'stopped';
  const status: ChatTurnStatus = end.ok && !stopped ? 'done' : stopped ? 'stopped' : 'failed';
  const error = status === 'done' ? null : (end.error ?? outcome.result?.error ?? 'The turn failed');
  const { type: _type, ...usage } = outcome.usage ?? { type: 'usage' };
  return {
    status,
    resultText: outcome.result?.text ?? null,
    error,
    usage:
      outcome.usage === undefined
        ? null
        : ({ ...usage, ...(kind && PLAN_KINDS.has(kind) ? { includedInPlan: true } : {}) } as Record<
            string,
            unknown
          >),
  };
}

/** A turn that runs or waits for its machine. */
export const isLive = (status: ChatTurnStatus): boolean => status === 'queued' || status === 'running';

/**
 * The model a turn hands its harness: its access profile's (since 2026-11-10; the chat's own profile, else the agent's),
 * except none (the provider's default), the old form's "Codex's default model" marker (`codex-default`) and a Claude id
 * on a Codex agent, which the harness's own default replaces (null): Codex rejects an id it does not know with a 400.
 * Any other id goes as it is, and the turn's spec check refuses a malformed one by name.
 */
export function turnModel(harness: Harness, model: string | null): string | null {
  if (model === null || model === 'codex-default') return null;
  return harness === 'codex' && model.startsWith('claude') ? null : model;
}

/**
 * The effort a turn hands its harness: its access profile's, when its harness takes that level (Claude Code low to max,
 * Codex low to ultra); else none, the harness's own default.
 */
export function turnEffort(harness: Harness, effort: Effort | null): Effort | undefined {
  return effort !== null && PROVIDER_EFFORTS[HARNESS_PROVIDER[harness]].includes(effort) ? effort : undefined;
}
