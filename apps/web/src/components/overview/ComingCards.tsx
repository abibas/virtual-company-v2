import { Activity } from 'lucide-react';
import { Card } from '../ui/Card.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';

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
