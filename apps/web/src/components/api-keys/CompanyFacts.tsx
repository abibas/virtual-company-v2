import type { Me } from '../../api/types.ts';
import { CopyButton } from '../forms/CopyButton.tsx';
import { Avatar, personName } from '../ui/Avatar.tsx';
import { Panel } from '../ui/Panel.tsx';

/** The company's facts: who is signed in (their photo, name and email), its address and its id (for `mwc login`). */
export function CompanyFacts({
  user,
  slug,
  companyId,
}: {
  readonly user: Pick<Me['user'], 'email' | 'displayName' | 'imageUrl'>;
  readonly slug: string;
  readonly companyId: string;
}) {
  const name = personName(user.displayName, user.email);
  return (
    <Panel title="This company" description="What the CLI and your own Claude Code need to reach it.">
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-dim">Signed in as</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <Avatar name={name} src={user.imageUrl} size="xs" tone="gradient" />
          <span className="min-w-0 break-all font-medium text-ink">
            {name}
            {name !== user.email && <span className="ml-1.5 font-normal text-dim">{user.email}</span>}
          </span>
        </dd>
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
