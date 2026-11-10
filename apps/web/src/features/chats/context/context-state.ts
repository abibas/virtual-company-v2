import { contextWindowOf } from '@mwc/shared/harness';
import type {
  AccessProfile,
  AgentDetail,
  Chat,
  ChatDetail,
  ChatTurnWithEvents,
  TurnEvent,
} from '../../../api/types.ts';

/**
 * How full the chat's conversation is, for its context meter (docs/harness.md, "Compact and Clear"), read from the live
 * turns the way the server reads its detail (`conversationState`): everything since the last Clear, the size from the
 * last main-agent `context` or a later `compact`'s size after, else the detail's own `context` (read by the server from
 * the whole current conversation, so a long chat's left-out turns count there). The totals count the loaded turns. Pure.
 */

type Of<T extends TurnEvent['type']> = Extract<TurnEvent, { type: T }>;
type Init = NonNullable<ChatDetail['init']>;
type Usage = Partial<Omit<Of<'usage'>, 'type'>>;

/** What the conversation held at its start (its first measure), or right after the last compaction. */
export interface ContextBase {
  readonly tokens: number;
  readonly after: 'start' | 'compaction';
}

/** One turn's tokens and cost from its `usage`; the cache writes from its main-agent `context` events. */
export interface TurnTokens {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly costUsd: number | undefined;
}

export interface SessionTotals {
  readonly turns: number;
  readonly tokens: number;
  readonly costUsd: number;
  /** When the conversation began: its first turn since the chat's start or last Clear. */
  readonly since: string | undefined;
  readonly afterClear: boolean;
}

export interface ConversationView {
  /** The conversation's size in tokens; undefined before anything measured it. */
  readonly used: number | undefined;
  /** The model's window; null when unknown. */
  readonly window: number | null;
  /** 0–100, rounded; undefined without a size or a window. */
  readonly percent: number | undefined;
  readonly model: string | null;
  readonly effort: string | undefined;
  readonly base: ContextBase | undefined;
  readonly lastTurn: TurnTokens | undefined;
  readonly session: SessionTotals;
  /** The slash commands and skills the harness offered at its last start; undefined when it did not say. */
  readonly commands: number | undefined;
  /** The chat has a conversation to compact or clear: a session since its start or its last Clear. */
  readonly hasConversation: boolean;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const sizeOf = (event: Of<'context'>) =>
  event.inputTokens + event.cacheReadTokens + event.cacheCreationTokens;

/** A turn's tokens: its `usage` event, else the usage the server kept on the turn; undefined without either. */
function turnTokens(turn: ChatTurnWithEvents): TurnTokens | undefined {
  let usage: Usage | undefined;
  let cacheWrite = 0;
  for (const { event } of turn.events) {
    if (event.type === 'usage') usage = event;
    else if (event.type === 'context') cacheWrite += event.cacheCreationTokens;
  }
  usage ??= (turn.usage as Usage | null) ?? undefined;
  if (usage === undefined) return undefined;
  return {
    input: num(usage.inputTokens),
    cacheRead: num(usage.cachedInputTokens),
    cacheWrite,
    output: num(usage.outputTokens),
    costUsd: typeof usage.costUsd === 'number' ? usage.costUsd : undefined,
  };
}

interface Walk {
  init: Init | undefined;
  used: number | undefined;
  window: number | null;
  base: ContextBase | undefined;
  hasSession: boolean;
}

/** Folds one event of the conversation since the last Clear into what the meter shows. */
function step(walk: Walk, event: TurnEvent) {
  const model = walk.init?.model ?? null;
  if (event.type === 'init') walk.init = event;
  else if (event.type === 'session') walk.hasSession = true;
  else if (event.type === 'context') {
    walk.used = sizeOf(event);
    walk.window = event.window ?? contextWindowOf(model);
    walk.base ??= { tokens: walk.used, after: 'start' };
  } else if (event.type === 'compact' && event.postTokens !== null) {
    walk.used = event.postTokens;
    walk.window = walk.window ?? contextWindowOf(model);
    walk.base = { tokens: event.postTokens, after: 'compaction' };
  }
}

function totals(work: readonly ChatTurnWithEvents[], cleared: boolean) {
  const tokens = work.map(turnTokens);
  const counted = tokens.filter((t): t is TurnTokens => t !== undefined);
  const session: SessionTotals = {
    turns: work.length,
    tokens: counted.reduce((sum, t) => sum + t.input + t.output, 0),
    costUsd: counted.reduce((sum, t) => sum + (t.costUsd ?? 0), 0),
    since: work[0]?.createdAt,
    afterClear: cleared,
  };
  return { session, lastTurn: counted.at(-1) };
}

/** The conversation as the meter shows it, from the live turns and the loaded detail. */
export function conversationView(
  turns: readonly ChatTurnWithEvents[],
  detail: Pick<ChatDetail, 'init' | 'context' | 'sessionId' | 'earlier'> | undefined,
): ConversationView {
  const lastClear = turns.findLastIndex((turn) => turn.kind === 'clear');
  const cleared = lastClear >= 0;
  const since = turns.slice(lastClear + 1);
  // Without a Clear among the turns, the detail's `init` may come from turns a long chat left out: it names the model.
  const seed = cleared ? undefined : (detail?.init ?? undefined);
  const walk: Walk = { init: seed, used: undefined, window: null, base: undefined, hasSession: false };
  for (const turn of since) for (const { event } of turn.events) step(walk, event);
  // Nothing measured in the turns and no Clear among them: the detail's own reading stands.
  const init = walk.init ?? (cleared ? undefined : (detail?.init ?? undefined));
  const fallback = walk.used === undefined && !cleared ? detail?.context : undefined;
  const used = walk.used ?? fallback?.usedTokens;
  const model = init?.model ?? fallback?.model ?? null;
  const window = walk.used !== undefined ? walk.window : (fallback?.window ?? contextWindowOf(model));
  // The current conversation's Clear may be left out of a long chat's loaded turns: the detail still lists it.
  const afterClear = cleared || (detail?.earlier.conversations.length ?? 0) > 0;
  const { session, lastTurn } = totals(
    since.filter((turn) => turn.kind !== 'clear'),
    afterClear,
  );
  return {
    used,
    window,
    percent: used !== undefined && window ? Math.round((used / window) * 100) : undefined,
    model,
    effort: init?.effort,
    base: walk.base,
    lastTurn,
    session,
    commands: init?.slashCommands?.length,
    hasConversation: walk.hasSession || (!cleared && Boolean(detail?.sessionId)),
  };
}

/** What a chat's turns run, for its meter before the first reading: the model (null: the provider's default). */
export type ChatRuns = Pick<NonNullable<AgentDetail['runsWith']>, 'model' | 'provider'>;

/**
 * What the chat runs: its own access profile's when it has one (known when it is one of the viewer's), else the
 * agent's; undefined when that is not known.
 */
export function chatRuns(
  chat: Pick<Chat, 'profileId'>,
  agent: Pick<AgentDetail, 'runsWith'>,
  mine: readonly AccessProfile[] | undefined,
): ChatRuns | undefined {
  if (chat.profileId === null) return agent.runsWith ?? undefined;
  return mine?.find((profile) => profile.id === chat.profileId);
}
