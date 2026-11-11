import { Activity } from 'lucide-react';
import { Card } from '../../components/ui/Card.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';

/** The runs card: empty until runs exist (S5.3). */
export function RunsCard() {
  return (
    <Card as="section" aria-label="Runs" padding="sm" className="flex items-center justify-center">
      <EmptyState icon={Activity} tone="blue" title="No runs yet" />
    </Card>
  );
}
