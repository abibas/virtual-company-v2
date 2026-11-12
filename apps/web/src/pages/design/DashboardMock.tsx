import { Mail, Plus, Users } from 'lucide-react';
import { useCompanyLogo } from '../../api/images/company-logo.ts';
import { useLocation } from '../../app/router.tsx';
import { StatTile } from '../../components/data/StatTile.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { RunsCard } from '../../features/overview/ComingCards.tsx';
import { CompanyHero } from '../../features/overview/CompanyHero.tsx';
import { TeamCard } from '../../features/overview/TeamCard.tsx';
import { MockShell, SAMPLE_LOGO_VERSION } from './MockShell.tsx';
import { sampleAgentList } from './org-sample.ts';
import { SAMPLE_COMPANY } from './records.ts';

const HERE = '/design/dashboard';

/** The sample team: the agents of the sample chart that are not archived. */
const TEAM = sampleAgentList('all').agents.filter((agent) => agent.status !== 'archived');

/** What the real Overview shows, with made-up numbers, in the shell with sample data (`?logo=1` for the logo). */
export function DashboardMock() {
  const { search } = useLocation();
  const withLogo = search.get('logo') === '1';
  const logoSrc = useCompanyLogo(SAMPLE_COMPANY.id, withLogo ? SAMPLE_LOGO_VERSION : null);
  return (
    <MockShell active="dashboard">
      <div className="grid gap-4 md:gap-5">
        <CompanyHero
          name={SAMPLE_COMPANY.name}
          status="active"
          logoSrc={logoSrc}
          summary="You own this company: you manage its people, its agents and its settings, and can delete it."
          actions={
            <Button tone="inverse" icon={Plus}>
              Invite a teammate
            </Button>
          }
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <StatTile
            label="Members"
            value={12}
            icon={Users}
            delta={{ value: '+2 this week', direction: 'up' }}
            href={HERE}
          />
          <StatTile
            label="Pending invitations"
            value={3}
            icon={Mail}
            tone="input"
            hint="Expire 14 days after they are sent"
            href={HERE}
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <TeamCard agents={TEAM} href="/design/org" hireHref="/design/org?agent=new" />
          <RunsCard />
        </div>
      </div>
    </MockShell>
  );
}
