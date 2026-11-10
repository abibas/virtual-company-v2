import type { ChatEvent, ChatTurnWithEvents, TurnEvent } from '../../../../api/types.ts';
import { isAskCall, questionOf } from '../question/question-model.ts';
import { between } from './format.ts';
import type { CurrentActivity, Part, SubagentState, ToolCall, TurnModel } from './parts.ts';
import { familyOf } from './tool-kinds.ts';

/**
 * A turn's thread from its events (docs/harness.md, "Events"; S5.2). Events with a `parentId` belong to that
 * subagent and never show in the main reply: each list of parts is built the same way, by who it belongs to.
 * Consecutive text joins, consecutive tool calls make one group, an Agent call becomes its subagent's block, a
 * `TodoWrite` call shows only as the to-do card, a question tool call only as the question card (S5.2 step 4), a
 * message the person sent into the running turn where the agent took it (S5.2 step 6), and each subagent keeps its
 * latest state. Pure.
 */

type Of<T extends TurnEvent['type']> = Extract<TurnEvent, { type: T }>;
type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type MutablePart = Mutable<Part> & { calls?: Mutable<ToolCall>[] };
type ThinkingPart = Mutable<Extract<Part, { kind: 'thinking' }>>;

interface Build {
  readonly lists: Map<string, MutablePart[]>;
  readonly calls: Map<string, Mutable<ToolCall>>;
  readonly subagentIds: ReadonlySet<string>;
  readonly placed: Set<string>;
  readonly hidden: Set<string>;
  readonly subagents: Map<string, Mutable<SubagentState>>;
  /** The thinking part each list ends with, until something else comes after it. */
  readonly thinking: Map<string, { part: ThinkingPart; at: string }>;
}

const MAIN = '';

function listOf(build: Build, owner: string): MutablePart[] {
  let list = build.lists.get(owner);
  if (list === undefined) {
    list = [];
    build.lists.set(owner, list);
  }
  return list;
}

function placeSubagent(build: Build, list: MutablePart[], id: string, key: string) {
  if (build.placed.has(id)) return;
  build.placed.add(id);
  list.push({ kind: 'subagent', key, id });
}

function addTool(build: Build, list: MutablePart[], event: Of<'tool'>, key: string, at: string) {
  if (build.subagentIds.has(event.id)) return placeSubagent(build, list, event.id, key);
  if (familyOf(event.name) === 'todo' || isAskCall(event.name)) {
    build.hidden.add(event.id);
    return;
  }
  const call: Mutable<ToolCall> = {
    id: event.id,
    name: event.name,
    summary: event.summary,
    at,
    result: undefined,
  };
  build.calls.set(event.id, call);
  const last = list.at(-1);
  if (last?.kind === 'tools' && last.calls) last.calls.push(call);
  else list.push({ kind: 'tools', key, calls: [call] });
}

function addResult(build: Build, list: MutablePart[], event: Of<'tool_result'>, key: string, at: string) {
  if (build.subagentIds.has(event.id) || build.hidden.has(event.id)) return;
  const result = { ok: event.ok, summary: event.summary };
  const call = build.calls.get(event.id);
  if (call) call.result = result;
  else list.push({ kind: 'tools', key, calls: [{ id: event.id, name: 'Tool', summary: '', at, result }] });
}

function addSubagent(build: Build, list: MutablePart[], event: Of<'subagent'>, key: string, at: string) {
  const known = build.subagents.get(event.id);
  const ended = event.status !== 'running';
  build.subagents.set(event.id, {
    event,
    startedAt: known?.startedAt ?? at,
    endedAt: known?.endedAt ?? (ended ? at : undefined),
    steps: known?.steps ?? 0,
  });
  placeSubagent(build, list, event.id, key);
}

/** Two messages as paragraphs: a blank line between them, none added when either is empty. */
function joinParagraphs(before: string, after: string): string {
  if (before.trim() === '') return after;
  if (after.trim() === '') return before;
  return `${before.replace(/\s+$/, '')}\n\n${after.replace(/^\s+/, '')}`;
}

/** One event into the list of whom it belongs to. */
function addEvent(build: Build, { seq, event, at }: ChatEvent) {
  const owner = ('parentId' in event && event.parentId) || MAIN;
  const list = listOf(build, owner);
  const key = String(seq);
  const open = build.thinking.get(owner);
  if (open && event.type !== 'thinking') {
    open.part.ms = between(open.at, at);
    build.thinking.delete(owner);
  }
  const last = list.at(-1);
  if (event.type === 'text') {
    // Each text event is a whole message (Codex's agent messages, Claude Code's text blocks), never a fragment: two in a
    // row are two paragraphs, not one run-on line ("…when they finish.The gpt-6.1-sol agents…").
    if (last?.kind === 'text') last.text = joinParagraphs(last.text, event.text);
    else list.push({ kind: 'text', key, text: event.text });
  } else if (event.type === 'thinking') {
    if (last?.kind === 'thinking' && open) last.text += `\n\n${event.text}`;
    else {
      const part: ThinkingPart = { kind: 'thinking', key, text: event.text, ms: undefined };
      list.push(part);
      build.thinking.set(owner, { part, at });
    }
  } else if (event.type === 'tool') {
    addTool(build, list, event, key, at);
    const parent = build.subagents.get(owner);
    if (parent && !build.hidden.has(event.id)) parent.steps += 1;
  } else if (event.type === 'tool_result') addResult(build, list, event, key, at);
  else if (event.type === 'subagent') addSubagent(build, list, event, key, at);
  else if (event.type === 'notice')
    list.push({ kind: 'notice', key, level: event.level, message: event.message });
  else if (event.type === 'compact') list.push({ kind: 'compact', key, event });
  else if (event.type === 'input') list.push({ kind: 'input', key, text: event.text });
}

/** What the latest event of the turn means (who it came from, and what it does). */
function currentOf(events: readonly ChatEvent[], build: Build): CurrentActivity {
  // Codex's whole messages and a subagent's end leave the main agent waiting while background subagents work.
  const running = [...build.subagents.values()].filter((state) => state.event.status === 'running').length;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const { seq, event } = events[index] as ChatEvent;
    if (!['text', 'thinking', 'tool', 'tool_result', 'subagent'].includes(event.type)) continue;
    const owner = 'parentId' in event ? event.parentId : undefined;
    const subagent = owner ? build.subagents.get(owner) : undefined;
    const waiting = running > 0 && subagent === undefined;
    if (event.type === 'text')
      return { activity: waiting ? { kind: 'waiting', count: running } : { kind: 'writing' }, subagent, seq };
    if (event.type === 'subagent' && event.status === 'running') {
      const own = build.subagents.get(event.id);
      return { activity: { kind: 'step', text: event.lastStep ?? event.description }, subagent: own, seq };
    }
    if (event.type === 'subagent' && waiting)
      return { activity: { kind: 'waiting', count: running }, subagent: undefined, seq };
    if (event.type === 'tool') {
      const call = build.calls.get(event.id);
      const agentType = build.subagents.get(event.id)?.event.agentType;
      const asCall = call ?? {
        id: event.id,
        name: event.name,
        summary: event.summary,
        at: '',
        result: undefined,
      };
      return { activity: { kind: 'tool', call: asCall, agentType }, subagent, seq };
    }
    return { activity: { kind: 'thinking' }, subagent, seq };
  }
  return { activity: { kind: 'starting' }, subagent: undefined, seq: 0 };
}

function newBuild(events: readonly ChatEvent[]): Build {
  const subagentIds = new Set(events.flatMap(({ event }) => (event.type === 'subagent' ? [event.id] : [])));
  const lists = new Map<string, MutablePart[]>();
  return {
    lists,
    calls: new Map(),
    subagentIds,
    placed: new Set(),
    hidden: new Set(),
    subagents: new Map(),
    thinking: new Map(),
  };
}

/** The model of a turn's thread, from its events, its status and its error. */
export function turnModel(turn: ChatTurnWithEvents): TurnModel {
  const build = newBuild(turn.events);
  let todo: TurnModel['todo'];
  let init: Of<'init'> | undefined;
  let compact: Of<'compact'> | undefined;
  let usage: Of<'usage'> | undefined;
  let result: Of<'result'> | undefined;
  for (const item of turn.events) {
    const { event } = item;
    if (event.type === 'todo' && !event.parentId) todo = event.items;
    else if (event.type === 'init') init = event;
    else if (event.type === 'usage') usage = event;
    else if (event.type === 'result') result = event;
    if (event.type === 'compact') compact = event;
    addEvent(build, item);
  }
  const parts = listOf(build, MAIN) as Part[];
  const mainText = parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('\n\n');
  const fallback = result?.text ?? turn.resultText ?? '';
  // A reply the harness gave only in its result (no text events) still shows.
  if (!mainText && fallback) parts.push({ kind: 'text', key: 'result', text: fallback });
  const failed = turn.status === 'failed' || (result !== undefined && !result.ok);
  const children = new Map([...build.lists].filter(([owner]) => owner !== MAIN)) as Map<string, Part[]>;
  return {
    parts,
    children,
    subagents: build.subagents,
    todo,
    init,
    compact,
    usage,
    durationMs: result?.durationMs ?? between(turn.startedAt, turn.endedAt),
    calls: parts.flatMap((part) => (part.kind === 'tools' ? part.calls : [])),
    current: currentOf(turn.events, build),
    question: questionOf(turn.events),
    replyText: mainText || fallback,
    error: failed ? (turn.error ?? result?.error ?? 'The turn failed.') : undefined,
  };
}
