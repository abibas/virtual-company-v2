import { type DragEvent, useEffect, useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { Board, BoardCard, BoardColumn, FlowCalls } from '../../../api/flows.ts';
import type { MoveNotice } from '../../structure/use-chart-moves.ts';
import { PRIORITY } from '../words.ts';

/** Which side of a queued card a dragged card goes to. */
export type QueueEdge = 'before' | 'after';

/** A queued card on its way to its new place: shown there at once, until the board is read again. */
interface Reorder {
  readonly card: BoardCard;
  readonly targetId: string;
  readonly edge: QueueEdge;
  readonly saved: boolean;
}

/** The Queued column with a card being reordered shown at its new place. */
export function withReorder(columns: readonly BoardColumn[], reorder: Reorder | undefined): readonly BoardColumn[] {
  if (!reorder) return columns;
  return columns.map((column) => {
    if (column.kind !== 'queued') return column;
    const others = column.cards.filter((card) => card.id !== reorder.card.id);
    const at = others.findIndex((card) => card.id === reorder.targetId);
    if (at < 0) return column;
    const into = reorder.edge === 'before' ? at : at + 1;
    return { ...column, cards: [...others.slice(0, into), reorder.card, ...others.slice(into)] };
  });
}

/**
 * Reordering Queued by dragging (T-39, those who route): a queued card dragged over another queued card shows a line
 * on the side it would go to (the card's top half: before it; its bottom half: after it); dropped, it is shown there at
 * once and sent as the task's `before` / `after` (it takes that task's priority, so it lands where it was put), then
 * the board is read again. Autotake takes Queued from the top. A refusal puts it back with the server's words.
 */
export function useQueueOrder({
  board,
  calls,
  dragged,
  say,
  onMoved,
}: {
  readonly board: Board;
  readonly calls: FlowCalls;
  /** The card being dragged from Queued; undefined when none, or one from another column. */
  readonly dragged: BoardCard | undefined;
  readonly say: (note: Omit<MoveNotice, 'id'>) => void;
  readonly onMoved: () => void;
}) {
  const [slot, setSlot] = useState<{ readonly cardId: string; readonly edge: QueueEdge }>();
  const [reorder, setReorder] = useState<Reorder>();
  // The board read again after a saved reorder holds the card where it went.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new board is what ends the reorder.
  useEffect(() => setReorder((was) => (was?.saved ? undefined : was)), [board]);
  const place = (card: BoardCard, target: BoardCard, edge: QueueEdge) => {
    setReorder({ card, targetId: target.id, edge, saved: false });
    const where = edge === 'before' ? { before: target.key } : { after: target.key };
    calls.editTask(card.key, where).then(
      (task) => {
        setReorder({ card, targetId: target.id, edge, saved: true });
        const now = task.priority === card.priority ? '' : ` (now ${PRIORITY[task.priority].label})`;
        say({ tone: 'success', text: `Moved ${card.key} ${edge} ${target.key} in Queued${now}.` });
        onMoved();
      },
      (failure: unknown) => {
        setReorder(undefined);
        say({ tone: 'error', text: friendlyMessage(failure) });
      },
    );
  };
  const target = (card: BoardCard) => dragged !== undefined && dragged.id !== card.id;
  return {
    reorder,
    saving: reorder !== undefined && !reorder.saved,
    clear: () => setSlot(undefined),
    edge: (card: BoardCard): QueueEdge | undefined =>
      target(card) && slot?.cardId === card.id ? slot.edge : undefined,
    dragOver: (card: BoardCard) => (event: DragEvent<HTMLElement>) => {
      if (!target(card)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const box = event.currentTarget.getBoundingClientRect();
      const edge: QueueEdge = event.clientY < box.top + box.height / 2 ? 'before' : 'after';
      if (slot?.cardId !== card.id || slot.edge !== edge) setSlot({ cardId: card.id, edge });
    },
    drop: (card: BoardCard) => (event: DragEvent<HTMLElement>) => {
      if (!dragged || !target(card) || slot?.cardId !== card.id) return;
      event.preventDefault();
      place(dragged, card, slot.edge);
    },
  };
}
