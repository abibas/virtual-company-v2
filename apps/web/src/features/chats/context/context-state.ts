import { isAiProvider } from '@mwc/shared/credentials';
import { contextPercent, contextWindowOf } from '@mwc/shared/harness';
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
 * last main-agent `context` (the size the harness counts, as Codex's own reading, else its last request's) or a later
 * `compact`'s size after, else the detail's own `context` (read by the server from the whole current conversation, so a
 * long chat's left-out turns count there). The totals count the loaded turns. Pure.
 */

type Of<T extends TurnEvent['type']> = Extract<TurnEvent, { type: T }>;
type Init = NonNullable<ChatDetail['init']>;
type Usage = Partial<Omit<Of<'usage'>, 'type'>>;

/** What the conversation held at its start (its first measure), or right after the last compaction. */
export interface ContextBase {
  readonly tokens: number;
  readonly after: 'start' | 'compaction';
}

/**
 * One turn's tokens and cost from its `usage`; the cache writes from its main-agent `context` events; whether it ran on
 * a plan (a login or setup token: the server marks its usage `includedInPlan` at its end), whose cost is the plan's.
 */
export interface TurnTokens {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
  readonly costUsd: number | undefined;
  readonly includedInPlan: boolean;
}

export interface SessionTotals {
  readonly turns: number;
  readonly tokens: number;
  /** Input not read from the cache plus output, over the turns: what Codex's status line calls "used". */
  readonly uncached: number;
  /** What the turns not on a plan cost; undefined when none said (only plan turns, or no cost given at all). */
  readonly costUsd: number | undefined;
  /** Some turn ran on a plan. */
  readonly onPlan: boolean;
  /** When the conversation began: its first turn since the chat's start or last Clear. */
  readonly since: string | undefined;
  readonly afterClear: boolean;
}

export interface ConversationView {
  /** The conversation's size in tokens; undefined before anything measured it. */
  readonly used: number | undefined;
  /** The model's window; null when unknown. */
  readonly window: number | null;
  /** 0–100, rounded, as the harness shows it (`contextPercent`); undefined without a size or a window. */
  readonly percent: number | undefined;
  /** Tokens the harness leaves out of its percentage (Codex's 12k); 0 for none. */
  readonly baseline: number;
  /** The size is estimated from a turn's total (an older Codex turn), not the harness's own reading. */
  readonly estimate: boolean;
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
  event.usedTokens ?? event.inputTokens + event.cacheReadTokens + event.cacheCreationTokens;

/** A turn's tokens: its `usage` event, else the usage the server kept on the turn; undefined without either. */
function turnTokens(turn: ChatTurnWithEvents): TurnTokens | undefined {
  let usage: Usage | undefined;
  let cacheWrite = 0;
  for (const { event } of turn.events) {
    if (event.type === 'usage') usage = event;
    else if (event.type === 'context') cacheWrite += event.cacheCreationTokens;
  }
  const kept = (turn.usage as (Usage & { includedInPlan?: unknown }) | null) ?? undefined;
  usage ??= kept;
  if (usage === undefined) return undefined;
  return {
    input: num(usage.inputTokens),
    cacheRead: num(usage.cachedInputTokens),
    cacheWrite,
    output: num(usage.outputTokens),
    costUsd: typeof usage.costUsd === 'number' ? usage.costUsd : undefined,
    includedInPlan: kept?.includedInPlan === true,
  };
}

interface Walk {
  init: Init | undefined;
  used: number | undefined;
  window: number | null;
  /** The model the last reading named (Codex's own), when it named one. */
  model: string | undefined;
  baseline: number;
  base: ContextBase | undefined;
  estimate: boolean;
  hasSession: boolean;
}

/** Folds one event of the conversation since the last Clear into what the meter shows. */
function step(walk: Walk, event: TurnEvent) {
  const model = walk.model ?? walk.init?.model ?? null;
  if (event.type === 'init') walk.init = event;
  else if (event.type === 'session') walk.hasSession = true;
  else if (event.type === 'context') {
    walk.used = sizeOf(event);
    walk.estimate = event.estimate === true;
    walk.model = event.model ?? walk.model;
    walk.baseline = event.baselineTokens ?? 0;
    walk.window = event.window ?? contextWindowOf(event.model ?? model);
    walk.base ??= { tokens: walk.used, after: 'start' };
  } else if (event.type === 'compact' && event.postTokens !== null) {
    walk.used = event.postTokens;
    walk.estimate = false;
    walk.baseline = 0;
    walk.window = walk.window ?? contextWindowOf(model);
    walk.base = { tokens: event.postTokens, after: 'compaction' };
  }
}

function totals(work: readonly ChatTurnWithEvents[], cleared: boolean) {
  const tokens = work.map(turnTokens);
  const counted = tokens.filter((t): t is TurnTokens => t !== undefined);
  const paid = counted.filter((t) => !t.includedInPlan && t.costUsd !== undefined);
  const session: SessionTotals = {
    turns: work.length,
    tokens: counted.reduce((sum, t) => sum + t.input + t.output, 0),
    uncached: counted.reduce((sum, t) => sum + Math.max(0, t.input - t.cacheRead) + t.output, 0),
    costUsd: paid.length === 0 ? undefined : paid.reduce((sum, t) => sum + (t.costUsd ?? 0), 0),
    onPlan: counted.some((t) => t.includedInPlan),
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
  const walk: Walk = {
    init: seed,
    used: undefined,
    window: null,
    model: undefined,
    baseline: 0,
    base: undefined,
    estimate: false,
    hasSession: false,
  };
  for (const turn of since) for (const { event } of turn.events) step(walk, event);
  // Nothing measured in the turns and no Clear among them: the detail's own reading stands.
  const init = walk.init ?? (cleared ? undefined : (detail?.init ?? undefined));
  const fallback = walk.used === undefined && !cleared ? detail?.context : undefined;
  const used = walk.used ?? fallback?.usedTokens;
  const model = walk.model ?? init?.model ?? fallback?.model ?? null;
  const window = walk.used !== undefined ? walk.window : (fallback?.window ?? contextWindowOf(model));
  const baseline = walk.used !== undefined ? walk.baseline : (fallback?.baselineTokens ?? 0);
  // The current conversation's Clear may be left out of a long chat's loaded turns: the detail still lists it.
  const afterClear = cleared || (detail?.earlier.conversations.length ?? 0) > 0;
  const { session, lastTurn } = totals(
    since.filter((turn) => turn.kind !== 'clear'),
    afterClear,
  );
  return {
    used,
    window,
    percent: used === undefined ? undefined : contextPercent(used, window, baseline),
    baseline,
    estimate: walk.used !== undefined ? walk.estimate : fallback?.estimate === true,
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

/** What the meter names when Codex picks the model itself (its stream never names it). */
export const CODEX_DEFAULT_MODEL = "Codex's default";

/**
 * The model a chat's turns run as the meter names it before (or, for Codex, instead of) the harness saying so: the
 * profile's model, or for Codex "Codex's default" when the turn leaves it to Codex (no model, the old
 * `codex-default` marker or a Claude id, as the server's `turnModel` does); undefined when that is not known.
 */
export function runsModel(harness: Chat['harness'], runs: ChatRuns | undefined): string | null | undefined {
  if (harness !== 'codex') return runs?.model;
  if (runs === undefined) return undefined;
  const model = runs.model;
  return model === null || model === 'codex-default' || model.startsWith('claude')
    ? CODEX_DEFAULT_MODEL
    : model;
}

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
  const own = mine?.find((profile) => profile.id === chat.profileId);
  // A chat's profile is an AI one: a tool profile never powers a chat.
  return own && isAiProvider(own.provider) ? { model: own.model, provider: own.provider } : undefined;
}
