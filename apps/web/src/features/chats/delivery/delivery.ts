import { queueOrder } from '@mwc/shared/chats';
import type { Harness } from '@mwc/shared/enums';
import type { ChatDelivery, ChatTurnWithEvents } from '../../../api/types.ts';

/**
 * How a message reaches an agent that is working (S5.2 step 6, docs/harness.md "Delivery while a turn runs"): the
 * choices the composer offers, the one this browser last used, what a waiting message says about itself, and what a
 * turn that started from the queue says under its prompt. Pure but for the remembered choice.
 */

export interface DeliveryChoice {
  readonly value: ChatDelivery;
  readonly label: string;
  /** What happens, for the tooltip and screen readers. */
  readonly hint: string;
}

const CHOICES: Readonly<Record<ChatDelivery, DeliveryChoice>> = {
  now: { value: 'now', label: 'Now', hint: 'Into the running turn: the agent reads it at its next step' },
  after: {
    value: 'after',
    label: 'After this turn',
    hint: 'Waits for the turn to end, then runs as the next one',
  },
  interrupt: { value: 'interrupt', label: 'Interrupt', hint: 'Stops the turn, then runs this message' },
};

/** The running turn, as the choices depend on it. */
export interface RunningTurn {
  readonly kind: ChatTurnWithEvents['kind'];
}

/** Now is Claude Code's only (Codex takes no message mid-turn), and never into a compaction. */
export function deliveryChoices(harness: Harness, running: RunningTurn): DeliveryChoice[] {
  const now = harness === 'claude_code' && running.kind === 'message';
  return [...(now ? [CHOICES.now] : []), CHOICES.after, CHOICES.interrupt];
}

/** Nothing runs but messages wait (a moment between turns): a new one queues behind them. */
export const AFTER_ONLY: readonly DeliveryChoice[] = [CHOICES.after];

/** The choice to use: the one asked for when it is offered, else After this turn. */
export function offered(wanted: ChatDelivery, choices: readonly DeliveryChoice[]): ChatDelivery {
  return choices.some((choice) => choice.value === wanted) ? wanted : 'after';
}

const KEY = 'mwc.chat.delivery';

/** The choice this browser last used; After this turn when none (or the storage is closed). */
export function rememberedDelivery(): ChatDelivery {
  try {
    const saved = window.localStorage.getItem(KEY);
    return saved === 'now' || saved === 'interrupt' ? saved : 'after';
  } catch {
    return 'after';
  }
}

export function rememberDelivery(delivery: ChatDelivery): void {
  try {
    window.localStorage.setItem(KEY, delivery);
  } catch {
    // A closed storage (a private window) forgets the choice: After this turn next time.
  }
}

/** What a waiting message says about itself. */
export const WAITING_NOTE: Readonly<Record<ChatDelivery, string>> = {
  now: 'Sending into the running turn…',
  after: 'Queued — starts after the current turn',
  interrupt: 'Interrupting the turn — starts next',
};

/** What a turn that started from the queue says under its prompt; nothing for one sent for after the turn. */
export const STARTED_NOTE: Readonly<Record<ChatDelivery, string | undefined>> = {
  now: 'The turn ended before taking it, so it ran next',
  after: undefined,
  interrupt: 'Interrupted the turn',
};

/** What a message sent into the running turn says under it. */
export const SENT_NOW_NOTE = 'Sent into the running turn';

/** A turn that waits for the agent's stopped machine to start: it shows in the thread, with the machine's progress. */
export const waitsForMachine = (turn: ChatTurnWithEvents): boolean =>
  turn.status === 'queued' && turn.machineWaitAt !== null;

/** The chat's waiting messages in the order they start, and the others for the thread (those waiting for the machine too). */
export function splitQueue(turns: readonly ChatTurnWithEvents[]) {
  const waiting = turns.filter((turn) => turn.status === 'queued' && !waitsForMachine(turn));
  return {
    thread: waiting.length === 0 ? turns : turns.filter((turn) => !waiting.includes(turn)),
    queue: [...waiting].sort(queueOrder),
  };
}
