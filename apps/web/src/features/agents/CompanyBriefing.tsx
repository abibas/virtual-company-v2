import { agentBriefing } from '@mwc/shared/agent-briefing';
import { type BriefingTool, isToolProvider } from '@mwc/shared/credentials';
import { ChevronRight, Lock } from 'lucide-react';
import type { AccessProfile, ChartNode } from '../../api/types.ts';
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

/** The chosen GitHub and Atlassian profiles (of the person's own, `mine`) as the briefing reads them. */
export function briefingTools(
  ids: readonly (string | null)[],
  mine: readonly AccessProfile[] | undefined,
): BriefingTool[] {
  return ids.flatMap((id) => {
    const profile = mine?.find((own) => own.id === id);
    if (!profile || profile.rights === null || !isToolProvider(profile.provider)) return [];
    const { account = null, site = null } = profile.subscription ?? {};
    return [{ provider: profile.provider, account, site, rights: profile.rights }];
  });
}

/**
 * What a new agent will be told of its place once its manager is chosen (the Hire page): the chart with its card added
 * and its chosen tool profiles, written by the same function as the server's.
 */
export function previewBriefing(
  company: string,
  nodes: readonly ChartNode[],
  node: ChartNode,
  tools: readonly BriefingTool[] = [],
) {
  if (node.reportsTo === null || node.reportsTo === '') return { shown: false, text: undefined };
  return {
    shown: true,
    text: agentBriefing({ company, nodes: [...nodes, node], principalId: node.principalId, tools }).text,
  };
}
