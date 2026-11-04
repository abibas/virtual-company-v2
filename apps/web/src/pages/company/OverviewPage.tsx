import { roleAtLeast } from '@mwc/shared/roles';
import { useCompany } from '../../app/company.ts';
import { Link } from '../../app/router.tsx';
import { CopyButton } from '../../components/forms/CopyButton.tsx';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import { roleName, StatusPill } from '../../components/ui/Badge.tsx';
import { Panel } from '../../components/ui/Panel.tsx';

const ROLE_SUMMARY = {
  owner: 'You own this company: you manage its people, its settings and can delete it.',
  admin: 'You are an admin: you invite people, set their roles and change the company’s settings.',
  member: 'You are a member: you work in the company and see who else is in it.',
  viewer: 'You are a viewer: you can look around, and change nothing but your own API keys.',
} as const;

/** The company's facts: status, the person's role and email, its address and id (for `mwc login`). */
function CompanyFacts() {
  const { membership, me } = useCompany();
  return (
    <Panel title="This company">
      <dl className="grid gap-x-6 gap-y-3 text-[13.5px] sm:grid-cols-[auto_1fr]">
        <dt className="text-dim">Status</dt>
        <dd>
          <StatusPill status={membership.companyStatus} />
        </dd>
        <dt className="text-dim">Your role</dt>
        <dd className="text-ink">{roleName(membership.role)}</dd>
        <dt className="text-dim">Signed in as</dt>
        <dd className="break-all text-ink">{me.user.email}</dd>
        <dt className="text-dim">Address</dt>
        <dd className="font-mono text-[13px] text-ink-2">/c/{membership.slug}</dd>
        <dt className="text-dim">Company id</dt>
        <dd className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-mono text-[12.5px] text-ink-2">{membership.companyId}</span>
          <CopyButton text={membership.companyId} />
        </dd>
      </dl>
    </Panel>
  );
}

/** `/c/:slug`: the company at a glance, and where to go next. */
export function OverviewPage() {
  const { membership } = useCompany();
  const admin = roleAtLeast(membership.role, 'admin');
  const base = `/c/${membership.slug}`;
  const next = [
    {
      to: `${base}/members`,
      title: 'Members',
      text: admin
        ? 'Invite people by email and set their roles.'
        : 'See who is in the company, and their roles.',
    },
    {
      to: `${base}/api-keys`,
      title: 'API keys',
      text: 'Make a personal key for the mwc CLI or your own Claude Code.',
    },
    {
      to: `${base}/settings`,
      title: 'Settings',
      text: admin ? 'Rename the company or change its address.' : 'The company’s name and address.',
    },
  ];
  return (
    <>
      <PageHeader title={membership.name}>
        <p>{ROLE_SUMMARY[membership.role]}</p>
      </PageHeader>
      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CompanyFacts />
        <Panel title="Where to go next">
          <ul className="flex flex-col divide-y divide-line">
            {next.map((item) => (
              <li key={item.to} className="py-2.5 first:pt-0 last:pb-0">
                <Link to={item.to} className="font-medium text-amber underline-offset-4 hover:underline">
                  {item.title}
                </Link>
                <p className="mt-0.5 text-[13.5px] text-dim">{item.text}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </>
  );
}
