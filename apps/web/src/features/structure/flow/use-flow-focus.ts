import { type RefObject, useEffect, useMemo, useRef } from 'react';
import type { CanvasHandle } from '../../../components/org/ChartCanvas.tsx';
import type { ChartLayout } from '../../../components/org/layout.ts';
import { type FlowFocus, focusBox, linkingEdges } from './flow-focus.ts';

/**
 * A highlighted flow on the chart: its members and the lines that join them; and the view brought to them once each
 * time another flow is chosen (the whole chart again when it is cleared), not on every change of the chart.
 */
export function useFlowFocus(
  focus: FlowFocus | undefined,
  layout: ChartLayout,
  canvas: RefObject<CanvasHandle | null>,
  ready: boolean,
) {
  const shown = useMemo(() => focus && { flow: focus, edges: linkingEdges(layout, focus) }, [focus, layout]);
  const fitted = useRef<string>(undefined);
  useEffect(() => {
    const handle = canvas.current;
    if (!ready || !handle || fitted.current === focus?.flowId) return;
    const box = focus ? focusBox(layout, focus) : undefined;
    if (box) handle.fitTo(box);
    else if (fitted.current !== undefined)
      handle.fitTo({ x: 0, y: 0, width: layout.width, height: layout.height });
    fitted.current = focus?.flowId;
  }, [focus, layout, canvas, ready]);
  return shown;
}
