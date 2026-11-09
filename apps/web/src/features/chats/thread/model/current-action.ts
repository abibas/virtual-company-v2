import { Bot, Brain, type LucideIcon, PenLine, Sparkles } from 'lucide-react';
import type { CurrentActivity, Part, SubagentState, ToolCall, TurnModel } from './parts.ts';
import { addUp, familyOf, type ToolWords, toolIcon, toolWords } from './tool-kinds.ts';

/**
 * The running turn's status in words (S5.2): what it does now ("Running `pnpm test`", "Thinking…"), the actions it
 * took so far, and how a finished turn adds up ("ran 4 commands, called 6 tools, started 2 agents"). Pure.
 */

export interface ActionLine {
  readonly icon: LucideIcon;
  readonly words: ToolWords;
  /** The subagent doing it ("Explore"), when it is not the main agent. */
  readonly by: string | undefined;
}

/** What the agent does now, from the turn's latest event. */
export function currentAction({ activity, subagent }: CurrentActivity): ActionLine {
  const by = subagent?.event.agentType;
  if (activity.kind === 'tool') {
    const { call, agentType } = activity;
    return { icon: toolIcon(call.name), words: toolWords(call.name, call.summary, false, agentType), by };
  }
  if (activity.kind === 'writing')
    return { icon: PenLine, words: { verb: subagent ? 'Writing its answer…' : 'Writing the reply…' }, by };
  if (activity.kind === 'thinking') return { icon: Brain, words: { verb: 'Thinking…' }, by };
  if (activity.kind === 'step') return { icon: Bot, words: { verb: activity.text || 'Working…' }, by };
  return { icon: Sparkles, words: { verb: 'Starting…' }, by };
}

/** One entry of the action history: a tool call, or a subagent it started. */
export type HistoryItem =
  | { readonly kind: 'call'; readonly key: string; readonly call: ToolCall }
  | { readonly kind: 'subagent'; readonly key: string; readonly state: SubagentState };

/** The main agent's actions so far, in order. */
export function historyOf(model: TurnModel): readonly HistoryItem[] {
  return model.parts.flatMap((part: Part): HistoryItem[] => {
    if (part.kind === 'tools') return part.calls.map((call) => ({ kind: 'call', key: call.id, call }));
    const state = part.kind === 'subagent' ? model.subagents.get(part.id) : undefined;
    return state ? [{ kind: 'subagent', key: part.key, state }] : [];
  });
}

/** How a finished turn's actions add up, lower case: "ran 4 commands, called 6 tools, started 2 agents"; '' for none. */
export function activitySummary(model: TurnModel): string {
  const names = model.calls.map((call) => call.name);
  const agents = model.parts.filter((part) => part.kind === 'subagent').length;
  const all = [...names, ...Array.from({ length: agents }, () => 'Agent')];
  if (all.length === 0) return '';
  const text = addUp(all.filter((name) => familyOf(name) !== 'todo'));
  return text.charAt(0).toLowerCase() + text.slice(1);
}
