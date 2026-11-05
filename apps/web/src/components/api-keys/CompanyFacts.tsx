import { CopyButton } from '../forms/CopyButton.tsx';
import { Panel } from '../ui/Panel.tsx';

/** The company's facts: the person's email here, its address and its id (for `mwc login`). */
export function CompanyFacts({
  email,
  slug,
  companyId,
}: {
  readonly email: string;
  readonly slug: string;
  readonly companyId: string;
}) {
  return (
    <Panel title="This company" description="What the CLI and your own Claude Code need to reach it.">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-dim">Signed in as</dt>
        <dd className="break-all font-medium text-ink">{email}</dd>
        <dt className="text-dim">Address</dt>
        <dd className="font-mono text-sm text-ink-2">/{slug}</dd>
        <dt className="text-dim">Company id</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-mono text-xs text-ink-2">{companyId}</span>
          <CopyButton text={companyId} />
        </dd>
      </dl>
    </Panel>
  );
}
