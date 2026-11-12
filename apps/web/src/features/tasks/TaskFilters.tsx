import { Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FlowSummary } from '../../api/flows.ts';
import type { ChartNode } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { CONTROL, CONTROL_SM, Select, type SelectOption } from '../../components/forms/Input.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { nodeName } from '../../components/org/chart.ts';
import type { TaskFilters as Filters, StateFilter } from './filters.ts';

const STATES: readonly SegmentOption<StateFilter>[] = [
  { value: 'open', label: 'Open' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

/** How long the search waits after the last key before it reads the list. */
const TYPING_MS = 300;

/** Anyone, Me, then the chart's people and its agents. */
function whoOptions(nodes: readonly ChartNode[], me: string | undefined): SelectOption[] {
  const of = (kind: 'person' | 'agent', group: string) =>
    nodes
      .filter((node) => (kind === 'agent') === (node.kind === 'agent') && node.principalId !== me)
      .map((node) => ({ value: node.principalId, label: nodeName(node), group }))
      .sort((a, b) => a.label.localeCompare(b.label));
  return [
    { value: '', label: 'Anyone' },
    ...(me ? [{ value: 'me', label: 'Me' }] : []),
    ...of('person', 'People'),
    ...of('agent', 'Agents'),
  ];
}

/** The search box: what is typed shows at once, and goes into the address once typing stops. */
function SearchField({
  value,
  onSearch,
}: {
  readonly value: string;
  readonly onSearch: (q: string) => void;
}) {
  const [text, setText] = useState(value);
  const typed = useRef(value);
  const search = useRef(onSearch);
  search.current = onSearch;
  useEffect(() => {
    if (value !== typed.current) {
      typed.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    if (text === typed.current) return;
    const timer = setTimeout(() => {
      typed.current = text;
      search.current(text);
    }, TYPING_MS);
    return () => clearTimeout(timer);
  }, [text]);
  return (
    <label className="relative flex min-w-0 flex-1 basis-48">
      <Search
        size={15}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-dim"
      />
      <input
        type="search"
        aria-label="Search by key or title"
        placeholder="Key or title"
        value={text}
        onChange={(event) => setText(event.target.value)}
        className={cx(CONTROL, CONTROL_SM, 'pl-8')}
      />
    </label>
  );
}

/** The Tasks page's one row of filters: the state, the flow, who has it and the search. */
export function TaskFilters({
  filters,
  flows,
  nodes,
  me,
  onChange,
}: {
  readonly filters: Filters;
  readonly flows: readonly FlowSummary[];
  readonly nodes: readonly ChartNode[];
  /** The viewer's principal ("Me"), when they are on the chart. */
  readonly me: string | undefined;
  /** New filters; `typing`: a search, which replaces the address instead of adding a step to Back. */
  readonly onChange: (filters: Filters, typing?: boolean) => void;
}) {
  const flowOptions: SelectOption[] = [
    { value: '', label: 'Every flow' },
    ...flows.map((flow) => ({ value: flow.id, label: flow.name })),
  ];
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <SegmentedControl
        options={STATES}
        value={filters.state}
        onChange={(state) => onChange({ ...filters, state })}
        label="State"
        size="sm"
      />
      <Select
        size="sm"
        aria-label="Flow"
        className="w-auto max-w-48 flex-1 basis-36"
        options={flowOptions}
        value={filters.flow}
        onChange={(event) => onChange({ ...filters, flow: event.target.value })}
      />
      <Select
        size="sm"
        aria-label="Who has it"
        className="w-auto max-w-48 flex-1 basis-36"
        options={whoOptions(nodes, me)}
        value={filters.who}
        onChange={(event) => onChange({ ...filters, who: event.target.value })}
      />
      <SearchField value={filters.q} onSearch={(q) => onChange({ ...filters, q }, true)} />
    </div>
  );
}
