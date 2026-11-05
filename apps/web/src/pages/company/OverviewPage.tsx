import { roleAtLeast } from '@mwc/shared/roles';
import { KeyRound, Mail, Plus, Users } from 'lucide-react';
import { useCompanyLogo } from '../../api/company-logo.ts';
import { useApi } from '../../api/context.ts';
import { call } from '../../api/errors.ts';
import { type Loaded, useLoad } from '../../api/use-load.ts';
import { useCompany } from '../../app/company.ts';
import { companyAgentLinks } from '../../components/agents/links.ts';
import { StatTile } from '../../components/data/StatTile.tsx';
import { RunsCard } from '../../components/overview/ComingCards.tsx';
import { CompanyFacts } from '../../components/overview/CompanyFacts.tsx';
import { CompanyHero } from '../../components/overview/CompanyHero.tsx';
import { TeamCard } from '../../components/overview/TeamCard.tsx';
import { ButtonLink } from '../../components/ui/Button.tsx';

const ROLE_SUMMARY = {
  owner: 'You own this company: you manage its people, its agents and its settings, and can delete it.',
  admin: 'You are an admin: you invite people, hire agents, set roles and change the company’s settings.',
  member: 'You are a member: you work in the company and see its people and agents.',
  viewer: 'You are a viewer: you can look around, and change nothing but your own API keys.',
} as const;

/** The counts of the tiles: members, pending invitations (admins and owners), and the person's own keys. */
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
  const keys = useLoad(`overview:keys:${companyId}`, () =>
    call(api.api.companies[':companyId']['api-keys'].$get({ param: { companyId }, query: {} })),
  );
  return { members, invitations, keys };
}

/** A count from a loaded list: the number, a dash when it failed, the skeleton while loading. */
function countOf<T>(loaded: Loaded<T>, pick: (data: T) => number) {
  return {
    value: loaded.data !== undefined ? pick(loaded.data) : '—',
    loading: loaded.data === undefined && loaded.error === undefined,
    hint: loaded.error !== undefined ? 'Could not load' : undefined,
  };
}

/** The three tiles, each a link to its page. */
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
  const keys = countOf(data.keys, (d) => d.apiKeys.filter((k) => k.status === 'active').length);
  return (
    <div className="grid gap-4 sm:grid-cols-3">
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
      <StatTile
        label="Your API keys"
        icon={KeyRound}
        tone="teal"
        href={`${base}/api-keys`}
        {...keys}
        hint={keys.hint ?? 'Active keys for the CLI and your own Claude Code'}
      />
    </div>
  );
}

/** `/c/:slug`: the company at a glance: the hero, the numbers, what comes next, and the facts the CLI needs. */
export function OverviewPage() {
  const { membership, me, agents } = useCompany();
  const admin = roleAtLeast(membership.role, 'admin');
  const base = `/c/${membership.slug}`;
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
          <>
            <ButtonLink href={`${base}/members`} tone="inverse" icon={admin ? Plus : Users}>
              {admin ? 'Invite a teammate' : 'See the members'}
            </ButtonLink>
            <ButtonLink href={`${base}/api-keys`} tone="inverse-soft" icon={KeyRound}>
              Create an API key
            </ButtonLink>
          </>
        }
      />
      <Tiles base={base} admin={admin} data={data} />
      <div className="grid gap-4 lg:grid-cols-2">
        <TeamCard agents={agents.data?.agents} href={links.chart} hireHref={admin ? links.hire : undefined} />
        <RunsCard />
      </div>
      <CompanyFacts email={me.user.email} slug={membership.slug} companyId={membership.companyId} />
    </div>
  );
}
