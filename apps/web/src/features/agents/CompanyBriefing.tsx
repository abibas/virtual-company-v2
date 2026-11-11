import { agentBriefing } from '@mwc/shared/agent-briefing';
import { ChevronRight, Lock } from 'lucide-react';
import type { ChartNode } from '../../api/types.ts';
import { Badge } from '../../components/ui/Badge.tsx';

/**
 * What the agent's turns are told of its place in the company, above its own instructions: generated from the chart,
 * read-only, outside the instructions' limit and revision; open by default, folded with its summary.
 */
export function CompanyBriefing({ text }: { readonly text: string | undefined }) {
  return (
    <details open className="group mb-4 rounded-xl border border-line bg-surface-2 px-3 py-2">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-ink-2">
        <ChevronRight size={15} aria-hidden="true" className="shrink-0 transition group-open:rotate-90" />
        From the company
        <Badge tone="teal" size="sm" icon={Lock}>
          Generated · updates with the chart
        </Badge>
      </summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words pb-1 font-mono text-xs leading-relaxed text-ink-2">
        {text ?? 'Loading…'}
      </pre>
    </details>
  );
}

/**
 * What a new agent will be told of its place once its manager is chosen (the Hire page): the chart with its card added,
 * written by the same function as the server's.
 */
export function previewBriefing(company: string, nodes: readonly ChartNode[], node: ChartNode) {
  if (node.reportsTo === null || node.reportsTo === '') return { shown: false, text: undefined };
  return {
    shown: true,
    text: agentBriefing({ company, nodes: [...nodes, node], principalId: node.principalId }).text,
  };
}
