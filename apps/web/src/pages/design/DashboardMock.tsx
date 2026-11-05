import { KeyRound, Mail, Plus, Users } from 'lucide-react';
import { useCompanyLogo } from '../../api/company-logo.ts';
import { useLocation } from '../../app/router.tsx';
import { StatTile } from '../../components/data/StatTile.tsx';
import { AgentsCard, RunsCard } from '../../components/overview/ComingCards.tsx';
import { CompanyFacts } from '../../components/overview/CompanyFacts.tsx';
import { CompanyHero } from '../../components/overview/CompanyHero.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { MockShell, SAMPLE_LOGO_VERSION } from './MockShell.tsx';
import { SAMPLE_COMPANY, SAMPLE_ME } from './records.ts';

const HERE = '/design/dashboard';

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
          summary="You own this company: you manage its people, its settings, and soon its agents."
          actions={
            <>
              <Button tone="inverse" icon={Plus}>
                Invite a teammate
              </Button>
              <Button tone="inverse-soft" icon={KeyRound}>
                Create an API key
              </Button>
            </>
          }
        />
        <div className="grid gap-4 sm:grid-cols-3">
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
          <StatTile
            label="Your API keys"
            value={1}
            icon={KeyRound}
            tone="teal"
            hint="Active, expires in 82 days"
            href={HERE}
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <AgentsCard />
          <RunsCard />
        </div>
        <CompanyFacts email={SAMPLE_ME.email} slug={SAMPLE_COMPANY.slug} companyId={SAMPLE_COMPANY.id} />
      </div>
    </MockShell>
  );
}
