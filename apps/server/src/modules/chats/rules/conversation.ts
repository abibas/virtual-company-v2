import type { ChatTurnKind } from '@mwc/shared/enums';
import { contextWindowOf, type InitEvent, type TurnEvent } from '@mwc/shared/harness';
import type { ChatContextView } from '../schemas/context.ts';

/**
 * What a chat's conversation runs on and how full it is since its last Clear (docs/harness.md, "Compact and Clear" and
 * "Codex's context reading"), from its turns' `init`, `context` and `compact` events. Pure.
 */

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
 * One `context` event as the meter reads it: the size the harness counts (Codex's own reading, `usedTokens`), else the
 * last request's input, cache reads and cache writes; the model it names, else the last `init`'s; an `estimate` from a
 * turn's total stays marked (an older Codex turn), and Codex's baseline goes along for its percentage.
 */
function contextView(
  event: Extract<TurnEvent, { type: 'context' }>,
  initModel: string | null,
  at: string,
  profileWindow: number | null,
): ChatContextView {
  const usedTokens =
    event.usedTokens ?? event.inputTokens + event.cacheReadTokens + event.cacheCreationTokens;
  const model = event.model ?? initModel;
  return {
    usedTokens,
    window: event.window ?? contextWindowOf(model) ?? profileWindow,
    model,
    at,
    ...(event.estimate ? { estimate: true } : {}),
    ...(event.baselineTokens === undefined ? {} : { baselineTokens: event.baselineTokens }),
  };
}

/**
 * The chat's conversation since its last Clear (a `clear` turn forgets everything before it): its last `init`, and its
 * size, from the last `context` (`contextView`) or a later `compact` that says its size after; the window is the
 * `context`'s, else the model table's for its model, else `profileWindow`, the window of what the chat's access profile
 * runs (`profileWindowOf`).
 */
export function conversationState(
  turns: readonly TurnWithEvents[],
  profileWindow: number | null = null,
): ConversationState {
  const state: { init: InitEvent | null; context: ChatContextView | null } = { init: null, context: null };
  for (const turn of turns) {
    if (turn.kind === 'clear') {
      state.init = null;
      state.context = null;
    }
    for (const { event, at } of turn.events) {
      const model = state.init?.model ?? null;
      if (event.type === 'init') state.init = event;
      else if (event.type === 'context') state.context = contextView(event, model, at, profileWindow);
      else if (event.type === 'compact' && event.postTokens !== null) {
        const known = state.context?.model ?? model;
        const window = state.context?.window ?? contextWindowOf(known) ?? profileWindow;
        state.context = { usedTokens: event.postTokens, window, model: known, at };
      }
    }
  }
  return state;
}
