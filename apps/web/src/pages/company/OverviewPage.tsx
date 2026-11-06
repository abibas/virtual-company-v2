import { roleAtLeast } from '@mwc/shared/roles';
import { Mail, Plus, Users } from 'lucide-react';
import { useCompanyLogo } from '../../api/company-logo.ts';
import { useApi } from '../../api/context.ts';
import { call } from '../../api/errors.ts';
import { type Loaded, useLoad } from '../../api/use-load.ts';
import { useCompany } from '../../app/company.ts';
import { companyPath } from '../../app/nav.ts';
import { StatTile } from '../../components/data/StatTile.tsx';
import { ButtonLink } from '../../components/ui/Button.tsx';
import { companyAgentLinks } from '../../features/agents/links.ts';
import { MachinesBoard } from '../../features/machines/MachinesBoard.tsx';
import { RunsCard } from '../../features/overview/ComingCards.tsx';
import { CompanyHero } from '../../features/overview/CompanyHero.tsx';
import { TeamCard } from '../../features/overview/TeamCard.tsx';
import { SubscriptionLimitsWidget } from '../../features/subscriptions/LimitsWidget.tsx';

const ROLE_SUMMARY = {
  owner: 'You own this company: you manage its people, its agents and its settings, and can delete it.',
  admin: 'You are an admin: you invite people, hire agents, set roles and change the company’s settings.',
  member: 'You are a member: you work in the company and see its people and agents.',
  viewer: 'You are a viewer: you can look around, and change nothing but your own API keys.',
} as const;

/** The counts of the tiles: members, and pending invitations (admins and owners). */
function useOverviewData(companyId: string, admin: boolean) {
  const api = useApi();
  const members = useLoad(`overview:members:${companyId}`, () =>
    call(api.api.companies[':companyId'].members.$get({ param: { companyId } })),
  );
  const invitations = useLoad(`overview:invitations:${companyId}:${admin}`, () =>
    admin
      ? call(
          api.api.companies[':companyId'].invitations.$get({
            param: { companyId },
            query: { status: 'pending' },
          }),
        )
      : Promise.resolve({ invitations: [] }),
  );
  return { members, invitations };
}

/** A count from a loaded list: the number, a dash when it failed, the skeleton while loading. */
function countOf<T>(loaded: Loaded<T>, pick: (data: T) => number) {
  return {
    value: loaded.data !== undefined ? pick(loaded.data) : '—',
    loading: loaded.data === undefined && loaded.error === undefined,
    hint: loaded.error !== undefined ? 'Could not load' : undefined,
  };
}

/** The two tiles, side by side from small screens up. */
function Tiles({
  base,
  admin,
  data,
}: {
  readonly base: string;
  readonly admin: boolean;
  readonly data: ReturnType<typeof useOverviewData>;
}) {
  const members = countOf(data.members, (d) => d.members.filter((m) => m.status === 'active').length);
  const invitations = countOf(data.invitations, (d) => d.invitations.length);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <StatTile
        label="Members"
        icon={Users}
        href={`${base}/members`}
        {...members}
        hint={members.hint ?? 'Active in the company'}
      />
      {admin ? (
        <StatTile
          label="Pending invitations"
          icon={Mail}
          tone="input"
          href={`${base}/members`}
          {...invitations}
          hint={invitations.hint ?? 'Expire 14 days after they are sent'}
        />
      ) : (
        <StatTile
          label="Your role"
          icon={Users}
          tone="review"
          value={admin ? 'Admin' : 'Member'}
          hint="What you may do here"
        />
      )}
    </div>
  );
}

/**
 * `/:slug`: the company at a glance: the hero, the numbers, the person's own subscription limits (across companies),
 * the company's machines and what comes next.
 */
export function OverviewPage() {
  const { membership, agents } = useCompany();
  const admin = roleAtLeast(membership.role, 'admin');
  const base = companyPath(membership.slug);
  const links = companyAgentLinks(membership.slug);
  const data = useOverviewData(membership.companyId, admin);
  const logoSrc = useCompanyLogo(membership.companyId, membership.logo?.version);
  return (
    <div className="grid gap-4 md:gap-5">
      <CompanyHero
        name={membership.name}
        status={membership.companyStatus}
        logoSrc={logoSrc}
        summary={ROLE_SUMMARY[membership.role]}
        actions={
          <ButtonLink href={`${base}/members`} tone="inverse" icon={admin ? Plus : Users}>
            {admin ? 'Invite a teammate' : 'See the members'}
          </ButtonLink>
        }
      />
      <Tiles base={base} admin={admin} data={data} />
      <SubscriptionLimitsWidget />
      <MachinesBoard companyId={membership.companyId} machinesHref={`${base}/machines`} admin={admin} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TeamCard agents={agents.data?.agents} href={links.chart} hireHref={admin ? links.hire : undefined} />
        <RunsCard />
      </div>
    </div>
  );
}
