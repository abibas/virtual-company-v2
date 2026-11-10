import { roleAtLeast } from '@mwc/shared/roles';
import { ArrowLeft } from 'lucide-react';
import { useAgentAt, useOrgChart } from '../../api/org.ts';
import type { OrgChart } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { useCompany } from '../../app/company.ts';
import { navigate } from '../../app/router.tsx';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import { ButtonLink } from '../../components/ui/Button.tsx';
import { AgentProfile } from '../../features/agents/AgentProfile.tsx';
import { HireAgent } from '../../features/agents/HireAgent.tsx';
import { type AgentLinks, companyAgentLinks, isHireAddress } from '../../features/agents/links.ts';

/** `/agents/new` for someone who may not hire. */
function HiringIsForAdmins({ links }: { readonly links: AgentLinks }) {
  return (
    <>
      <PageHeader title="Hire an agent">
        <p>Admins and owners hire agents. Ask one of them, or look at the team on the chart.</p>
      </PageHeader>
      <ButtonLink href={links.list} icon={ArrowLeft}>
        Back to agents
      </ButtonLink>
    </>
  );
}

/** One agent's page, found by its address; every change reads it, the chart and the team again. */
function AgentAt({
  address,
  chart,
  links,
}: {
  readonly address: string;
  readonly chart: Loaded<OrgChart>;
  readonly links: AgentLinks;
}) {
  const { membership, me, agents: team } = useCompany();
  const agent = useAgentAt(membership.companyId, address);
  return (
    <AgentProfile
      companyId={membership.companyId}
      agent={agent}
      chart={chart}
      admin={roleAtLeast(membership.role, 'admin')}
      meUserId={me.user.id}
      links={links}
      onChanged={() => {
        agent.reload();
        chart.reload();
        team.reload();
      }}
    />
  );
}

/**
 * `/:slug/agents/new` (hire an agent, admins and owners) and `/:slug/agents/:agent` (an agent by its slug, or its
 * id: its page, editable by admins and owners, read-only for everyone else).
 */
export function AgentPage({ address }: { readonly address: string }) {
  const { membership, me, agents: team } = useCompany();
  const links = companyAgentLinks(membership.slug);
  const chart = useOrgChart(membership.companyId);
  if (!isHireAddress(address)) return <AgentAt address={address} chart={chart} links={links} />;
  if (!roleAtLeast(membership.role, 'admin')) return <HiringIsForAdmins links={links} />;
  return (
    <HireAgent
      companyId={membership.companyId}
      chart={chart}
      meUserId={me.user.id}
      links={links}
      defaults={{ claude: membership.defaultClaudeProfileId, openai: membership.defaultOpenaiProfileId }}
      onHired={(agent) => {
        team.reload();
        navigate(links.agent(agent));
      }}
    />
  );
}
