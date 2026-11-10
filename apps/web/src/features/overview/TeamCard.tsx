import { ArrowRight, Network, Plus } from 'lucide-react';
import type { Agent } from '../../api/types.ts';
import { AgentIconArt } from '../../components/feed/AgentIcon.tsx';
import { AvatarStack } from '../../components/ui/Avatar.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { ButtonLink } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';

type TeamAgent = Pick<Agent, 'id' | 'name' | 'face' | 'status' | 'icon'>;

interface TeamCardProps {
  /** The active and paused agents; undefined while they load. */
  readonly agents: readonly TeamAgent[] | undefined;
  /** The Agents page. */
  readonly href: string;
  /** The hire form, for admins and owners; none for everyone else. */
  readonly hireHref?: string | undefined;
}

/** How many agents work and how many rest, on the card's corner. */
function Tally({ agents }: { readonly agents: readonly TeamAgent[] }) {
  const paused = agents.filter((agent) => agent.status !== 'active').length;
  const active = agents.length - paused;
  return (
    <Badge tone="inverse">
      {active} active{paused > 0 ? `, ${paused} paused` : ''}
    </Badge>
  );
}

/** No agents yet: the invitation to hire the first one (admins), or what will be here. */
function NoTeam({ href, hireHref }: Pick<TeamCardProps, 'href' | 'hireHref'>) {
  return (
    <>
      <p className="mt-2 max-w-sm text-sm text-white/80">
        {hireHref
          ? 'Give an agent a name, a role and a face, and place it on the chart under you or beside your people.'
          : 'No agents yet. Admins and owners hire them, and they show here with their faces.'}
      </p>
      <div className="mt-auto pt-6">
        {hireHref ? (
          <ButtonLink href={hireHref} tone="inverse" icon={Plus}>
            Hire your first agent
          </ButtonLink>
        ) : (
          <ButtonLink href={href} tone="inverse-soft" icon={Network}>
            See the org chart
          </ButtonLink>
        )}
      </div>
    </>
  );
}

/** The teal card of the Overview: the team's size, its faces, and the way to the Agents page. */
export function TeamCard({ agents, href, hireHref }: TeamCardProps) {
  const faces = (agents ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    fallback: <AgentIconArt agent={agent} size="md" />,
  }));
  return (
    <Card variant="teal" padding="lg" as="section" aria-labelledby="team-card" className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <h3 id="team-card" className="text-lg font-bold tracking-[-0.01em] text-white">
          Your AI team
        </h3>
        {agents && agents.length > 0 && <Tally agents={agents} />}
      </div>
      {agents === undefined && <Skeleton inverse className="mt-4 h-10 w-40" />}
      {agents?.length === 0 && <NoTeam href={href} hireHref={hireHref} />}
      {agents && agents.length > 0 && (
        <>
          <p className="mt-3 text-4xl font-extrabold tracking-[-0.03em] text-white tabular">
            {agents.length}
            <span className="ml-2 text-lg font-bold tracking-normal text-white/80">
              {agents.length === 1 ? 'agent' : 'agents'}
            </span>
          </p>
          <p className="mt-1 max-w-sm text-sm text-white/80">
            On the chart beside your people. You will hand them tasks by their faces from the dock.
          </p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-6">
            <AvatarStack people={faces} size="md" max={6} ring="ring-white/40" />
            <ButtonLink href={href} tone="inverse" trailingIcon={ArrowRight}>
              Open the team
            </ButtonLink>
          </div>
        </>
      )}
    </Card>
  );
}
