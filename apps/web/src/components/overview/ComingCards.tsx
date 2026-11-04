import { Activity, Sparkles } from 'lucide-react';
import { AgentFace } from '../feed/AgentFace.tsx';
import { AvatarStack } from '../ui/Avatar.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Card } from '../ui/Card.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';

const FACES = [0, 1, 2, 3].map((variant) => ({
  name: `Agent ${variant + 1}`,
  fallback: <AgentFace variant={variant} />,
}));

/** The teal card: the agents that arrive in S2, with the drawn faces they will wear until they have their own. */
export function AgentsCard() {
  return (
    <Card variant="teal" padding="lg" as="section" aria-labelledby="agents-card" className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <h3 id="agents-card" className="text-lg font-bold tracking-[-0.01em] text-white">
          Your AI team
        </h3>
        <Badge tone="inverse" icon={Sparkles}>
          Coming in S2
        </Badge>
      </div>
      <p className="mt-2 max-w-sm text-sm text-white/80">
        Agents get a name, a role and a face, and report to you or to another agent. You give them tasks from
        the dock on the right, by their faces.
      </p>
      <div className="mt-auto flex items-center gap-3 pt-6">
        <AvatarStack people={FACES} size="md" ring="ring-white/40" />
        <p className="text-sm font-semibold text-white/90">Their places are set.</p>
      </div>
    </Card>
  );
}

/** The runs card: empty until S4, said as what will be here. */
export function RunsCard() {
  return (
    <Card as="section" aria-label="Runs" padding="sm" className="flex items-center justify-center">
      <EmptyState icon={Activity} tone="blue" title="No runs yet">
        When an agent works on a task, its run shows here with what it did. Runs arrive in S4.
      </EmptyState>
    </Card>
  );
}
