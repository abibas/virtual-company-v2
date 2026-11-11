import type { Board, FlowCalls } from '../../../api/flows.ts';
import type { ChartNode } from '../../../api/types.ts';
import { MoveToast } from '../../structure/MoveToast.tsx';
import type { FlowLinks } from '../links.ts';
import { BoardColumn } from './BoardColumn.tsx';
import { TaskCard } from './TaskCard.tsx';
import { useBoardMoves } from './use-board-moves.ts';

/**
 * A team's board: Queued, each step in order, Done (the latest) and Escalated, side by side (scrolling sideways when
 * they do not fit). A card opens its task; the Lead's people and admins (`leads`) drag a card onto a step's column to
 * route it there, the columns it may not go to dimmed; Done and Cancel are the task's own buttons. A refusal puts the
 * card back with the server's words at the bottom.
 */
export function BoardView({
  board,
  nodes,
  me,
  leads,
  links,
  calls,
  onMoved,
}: {
  readonly board: Board;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  /** The signed-in person's principal ("Needs you"). */
  readonly me: string | undefined;
  readonly leads: boolean;
  readonly links: FlowLinks;
  readonly calls: FlowCalls;
  readonly onMoved: () => void;
}) {
  const moves = useBoardMoves({ board, calls, enabled: leads, onMoved });
  return (
    <div>
      <div className="scroll-quiet -mx-1 flex items-start gap-3 overflow-x-auto px-1 pb-3">
        {moves.columns.map((column, index) => (
          <BoardColumn
            key={column.step?.id ?? column.kind}
            column={column}
            nodes={nodes}
            drop={moves.look(index)}
            over={moves.over === index}
            onDragOver={moves.dragOver(index)}
            onDrop={moves.drop(index)}
          >
            {column.cards.map((card) => (
              <TaskCard
                key={card.id}
                card={card}
                href={links.task(card.key)}
                nodes={nodes}
                me={me}
                draggable={moves.draggable && column.kind !== 'done'}
                moving={moves.movingId === card.id}
                onDragStart={moves.start(card, index)}
                onDragEnd={moves.end}
              />
            ))}
          </BoardColumn>
        ))}
      </div>
      {/* Fixed to the window's bottom: a tall board would put its own bottom out of sight. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-0 max-md:bottom-20">
        <MoveToast notice={moves.notice} onDismiss={moves.dismiss} />
      </div>
    </div>
  );
}
