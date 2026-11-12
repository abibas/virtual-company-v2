import { Workflow } from 'lucide-react';
import type { FlowSummary } from '../../../api/flows.ts';
import { navigate, useLocation } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { Select } from '../../../components/forms/Input.tsx';
import { FLOW_PARAM, leadAddress } from '../../flows/links.ts';
import { flowAt } from './flow-focus.ts';

/**
 * The org chart's flow picker, in the structure page's header row: All, or one flow to highlight. The choice is the
 * address's `?flow=<lead>`, so a link shares it and Back undoes it.
 */
export function FlowPicker({ flows }: { readonly flows: readonly FlowSummary[] }) {
  const { pathname, search } = useLocation();
  const current = flowAt(flows, search.get(FLOW_PARAM));
  const choose = (value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(FLOW_PARAM, value);
    else next.delete(FLOW_PARAM);
    const query = next.toString();
    navigate(query ? `${pathname}?${query}` : pathname);
  };
  return (
    <span className="relative inline-flex w-48 max-w-full" title="Highlight a flow">
      <Workflow
        size={14}
        aria-hidden="true"
        className={cx(
          'pointer-events-none absolute top-1/2 left-2.5 z-10 -translate-y-1/2',
          current ? 'text-blue' : 'text-dim',
        )}
      />
      <Select
        size="sm"
        aria-label="Highlight a flow"
        value={current ? leadAddress(current.lead) : ''}
        onChange={(event) => choose(event.target.value)}
        style={{ paddingLeft: '1.875rem' }}
        options={[
          { value: '', label: 'All' },
          ...flows.map((flow) => ({ value: leadAddress(flow.lead), label: flow.name })),
        ]}
      />
    </span>
  );
}
