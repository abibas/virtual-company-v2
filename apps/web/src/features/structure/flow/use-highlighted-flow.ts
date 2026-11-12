import { useMemo, useRef } from 'react';
import { type FlowSummary, useFlow } from '../../../api/flows.ts';
import { useLocation } from '../../../app/router.tsx';
import { FLOW_PARAM } from '../../flows/links.ts';
import { type FlowFocus, flowAt, flowFocus } from './flow-focus.ts';

/**
 * The flow the address highlights on the org chart (`?flow=<lead>`), read with its steps; while another one loads, the
 * last one stays, so the chart does not flash back to everyone between two flows.
 */
export function useHighlightedFlow(
  companyId: string,
  flows: readonly FlowSummary[] | undefined,
  enabled: boolean,
): FlowFocus | undefined {
  const chosen = flowAt(flows, useLocation().search.get(FLOW_PARAM));
  const flow = useFlow(companyId, enabled ? chosen?.id : undefined);
  const focus = useMemo(() => (flow.data ? flowFocus(flow.data) : undefined), [flow.data]);
  const last = useRef<FlowFocus>(undefined);
  if (!enabled || !chosen) last.current = undefined;
  else if (focus) last.current = focus;
  return last.current;
}
