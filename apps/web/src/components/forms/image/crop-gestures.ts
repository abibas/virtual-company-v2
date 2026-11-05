import { type KeyboardEvent, type PointerEvent, type RefObject, useEffect, useRef } from 'react';
import type { CropView } from './crop.ts';

/** How far an arrow key moves the image, in frame pixels (Shift: four times as far). */
const STEP = 8;

/** Changes the cropper's view; the cropper keeps it inside its bounds. */
export type Update = (change: (view: CropView) => CropView) => void;

/** The pointers on the stage: one drags, two pinch (and drag by their midpoint). */
export function usePointers(update: Update) {
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const before = pointers.current.get(event.pointerId);
    if (!before) return;
    const span = distance();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = (event.clientX - before.x) / pointers.current.size;
    const dy = (event.clientY - before.y) / pointers.current.size;
    const ratio = span > 0 ? distance() / span : 1;
    update((view) => ({ zoom: view.zoom * ratio, dx: view.dx + dx, dy: view.dy + dy }));
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    pointers.current.delete(event.pointerId);
  };
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

/** Arrow keys move the image (Shift: further), plus and minus zoom it. */
export function onKeys(event: KeyboardEvent<HTMLElement>, update: Update) {
  const step = event.shiftKey ? STEP * 4 : STEP;
  const moves: Record<string, readonly [number, number]> = {
    ArrowLeft: [step, 0],
    ArrowRight: [-step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  };
  const move = moves[event.key];
  const zoom = ['+', '='].includes(event.key) ? 1.1 : ['-', '_'].includes(event.key) ? 1 / 1.1 : undefined;
  if (!move && zoom === undefined) return;
  event.preventDefault();
  update((view) =>
    move
      ? { ...view, dx: view.dx + move[0], dy: view.dy + move[1] }
      : { ...view, zoom: view.zoom * (zoom ?? 1) },
  );
}

/** The wheel zooms without scrolling the page; a listener React would register as passive cannot say so. */
export function useWheelZoom(stage: RefObject<HTMLButtonElement | null>, update: Update) {
  const latest = useRef(update);
  latest.current = update;
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      latest.current((view) => ({ ...view, zoom: view.zoom * Math.exp(-event.deltaY * 0.0015) }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [stage]);
}
