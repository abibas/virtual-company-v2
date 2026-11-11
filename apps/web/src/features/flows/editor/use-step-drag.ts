import { type DragEvent, useState } from 'react';
import type { RowDrag } from './StepRow.tsx';

/**
 * Reordering the editor's steps by their handles (the browser's own drag and drop): the row being dragged, the row it
 * would land on, and a drop that moves it there. Up and Down on each row do the same without a pointer.
 */
export function useStepDrag(onMove: (from: number, to: number) => void): (index: number) => RowDrag {
  const [from, setFrom] = useState<number>();
  const [over, setOver] = useState<number>();
  const end = () => {
    setFrom(undefined);
    setOver(undefined);
  };
  return (index) => ({
    dragging: from === index,
    over: from !== undefined && over === index && from !== index,
    onHandleStart: (event: DragEvent<HTMLElement>) => {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
      const row = event.currentTarget.closest('li');
      if (row) event.dataTransfer.setDragImage(row, 24, 24);
      setFrom(index);
    },
    onOver: (event: DragEvent<HTMLElement>) => {
      if (from === undefined) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (over !== index) setOver(index);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (from === undefined) return;
      event.preventDefault();
      onMove(from, index);
      end();
    },
    onEnd: end,
  });
}
