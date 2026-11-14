import { type RefObject, useEffect, useMemo, useRef } from 'react';
import type { CanvasHandle } from '../../../components/org/ChartCanvas.tsx';
import type { ChartLayout } from '../../../components/org/layout.ts';
import { type ChartBox, type FlowFocus, focusBox, linkingEdges, unionBox } from './flow-focus.ts';

/** The whole canvas (the tree with the Requesters column) and the requester cards to frame with a flow's members. */
export interface FocusFrame {
  readonly width: number;
  readonly height: number;
  around(focus: FlowFocus): readonly ChartBox[];
}

/**
 * A highlighted flow on the chart: its members and the lines that join them; and the view brought to them (with the
 * requesters who talked to them) once each time another flow is chosen (the whole canvas again when it is cleared),
 * not on every change of the chart.
 */
export function useFlowFocus(
  focus: FlowFocus | undefined,
  layout: ChartLayout,
  canvas: RefObject<CanvasHandle | null>,
  ready: boolean,
  frame: FocusFrame,
) {
  const whole = useRef(frame);
  whole.current = frame;
  const shown = useMemo(() => focus && { flow: focus, edges: linkingEdges(layout, focus) }, [focus, layout]);
  const fitted = useRef<string>(undefined);
  useEffect(() => {
    const handle = canvas.current;
    if (!ready || !handle || fitted.current === focus?.flowId) return;
    const { width, height, around } = whole.current;
    const box = focus ? unionBox(focusBox(layout, focus), around(focus)) : undefined;
    if (box) handle.fitTo(box);
    else if (fitted.current !== undefined) handle.fitTo({ x: 0, y: 0, width, height });
    fitted.current = focus?.flowId;
  }, [focus, layout, canvas, ready]);
  return shown;
}
