import { TriangleAlert } from 'lucide-react';
import { useMachineChoices } from '../../api/org.ts';
import { useCompany } from '../../app/company.ts';
import { companyPath } from '../../app/nav.ts';
import { Link } from '../../app/router.tsx';
import { machineCardHref } from '../machines/tools/tools-text.ts';

/**
 * Above the composer, for admins: one quiet line when the chat's profile gives the server's tools (Jira and Confluence)
 * but its machine's runner is too old to provide them (the detail's `runnerUpdateFor`), linking to the machine's card,
 * where Update is. The header's harness chip already says "runner out of date"; this says what it costs here.
 */
export function RunnerUpdateNotice({
  companyId,
  machineId,
  tools,
}: {
  readonly companyId: string;
  readonly machineId: string;
  /** What waits for the update, in a few words ("Jira and Confluence"). */
  readonly tools: string;
}) {
  const { slug } = useCompany().membership;
  const machines = useMachineChoices(companyId);
  const name = machines.data?.find((one) => one.id === machineId)?.name ?? 'This machine';
  return (
    <p className="flex items-center gap-2 bg-input-soft px-4 py-1.5 text-xs text-ink md:px-5">
      <TriangleAlert size={14} aria-hidden="true" className="shrink-0 text-input" />
      <span className="min-w-0 truncate">
        {name} runner needs an update for {tools} tools.{' '}
        <Link
          to={machineCardHref(companyPath(slug, 'machines'), machineId)}
          className="font-semibold text-blue hover:underline"
        >
          Open its machine
        </Link>
      </span>
    </p>
  );
}
