import { type DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { Board, BoardCard, BoardColumn, FlowCalls } from '../../../api/flows.ts';
import type { MoveNotice } from '../../structure/use-chart-moves.ts';
import type { DropLook } from './BoardColumn.tsx';

/** A card on its way to a step: shown there at once, until the board is read again (or put back on a refusal). */
interface Moving {
  readonly card: BoardCard;
  readonly to: number;
  readonly saved: boolean;
}

/**
 * Whether `card` may be dropped on the column at `index`: only a step's column (Queued, Done and Escalated are reached
 * with the task's buttons), and not the step an active task is at already. The server stays the judge (`route`).
 */
function mayLand(board: Board, card: BoardCard, from: number, index: number): boolean {
  const column = board.columns[index];
  if (!column?.step) return false;
  const source = board.columns[from];
  return !(source?.kind === 'step' && column.step.id === card.stepId);
}

/** The board with a card being moved shown in its new column, first. */
function withMove(board: Board, moving: Moving | undefined): readonly BoardColumn[] {
  if (!moving) return board.columns;
  return board.columns.map((column, index) => {
    const cards = column.cards.filter((card) => card.id !== moving.card.id);
    const moved = index === moving.to ? [moving.card, ...cards] : cards;
    return { ...column, cards: moved, total: column.total + moved.length - column.cards.length };
  });
}

/** The last move's sentence at the bottom of the window ("Moved T-12 to QA.", or the server's refusal). */
function useNotice() {
  const [notice, setNotice] = useState<MoveNotice>();
  const count = useRef(0);
  const say = useCallback((note: Omit<MoveNotice, 'id'>) => setNotice({ ...note, id: ++count.current }), []);
  const dismiss = useCallback(() => setNotice(undefined), []);
  return { notice, say, dismiss };
}

/**
 * A card's move to the step of the column at `index`: shown there at once, sent as `route` with the step the card was
 * seen at, kept there until the board is read again; a refusal puts it back. Returns the move being shown.
 */
function useRoute(
  board: Board,
  calls: FlowCalls,
  say: (note: Omit<MoveNotice, 'id'>) => void,
  onMoved: () => void,
) {
  const [moving, setMoving] = useState<Moving>();
  // The board read again after a saved move holds the card where it went.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new board is what ends the move.
  useEffect(() => setMoving((was) => (was?.saved ? undefined : was)), [board]);
  const route = (card: BoardCard, index: number) => {
    const column = board.columns[index];
    if (!column?.step) return;
    setMoving({ card, to: index, saved: false });
    calls.act(card.key, { action: 'route', toStepId: column.step.id, fromStepId: card.stepId }).then(
      () => {
        setMoving({ card, to: index, saved: true });
        say({ tone: 'success', text: `Moved ${card.key} to ${column.title}.` });
        onMoved();
      },
      (failure: unknown) => {
        setMoving(undefined);
        say({ tone: 'error', text: friendlyMessage(failure) });
      },
    );
  };
  return { moving, route };
}

/**
 * Dragging the board's cards to another step (the Lead's people and admins: `route`): the card being dragged, where it
 * may land, the move shown at once and sent with the step the card was seen at, then the board read again; a refusal
 * puts the card back and shows the server's words.
 */
export function useBoardMoves({
  board,
  calls,
  enabled,
  onMoved,
}: {
  readonly board: Board;
  readonly calls: FlowCalls;
  readonly enabled: boolean;
  readonly onMoved: () => void;
}) {
  const [dragging, setDragging] = useState<{ card: BoardCard; from: number }>();
  const [over, setOver] = useState<number>();
  const { notice, say, dismiss } = useNotice();
  const { moving, route } = useRoute(board, calls, say, onMoved);
  const lands = (index: number) =>
    dragging !== undefined && mayLand(board, dragging.card, dragging.from, index);
  const end = () => {
    setDragging(undefined);
    setOver(undefined);
  };
  return {
    columns: withMove(board, moving),
    movingId: moving?.card.id,
    draggable: enabled && moving === undefined,
    over,
    look: (index: number): DropLook => (dragging ? (lands(index) ? 'open' : 'closed') : undefined),
    notice,
    dismiss,
    start: (card: BoardCard, from: number) => (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', card.key);
      setDragging({ card, from });
    },
    end,
    dragOver: (index: number) => (event: DragEvent<HTMLElement>) => {
      if (!lands(index)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (over !== index) setOver(index);
    },
    drop: (index: number) => (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      if (dragging && lands(index)) route(dragging.card, index);
      end();
    },
  };
}
