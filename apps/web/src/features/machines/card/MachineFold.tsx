import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ComponentProps } from 'react';
import { usePowerControl } from '../../../api/machines.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { DevboxQuickPower } from '../power/DevboxPower.tsx';
import { MachineCard } from './MachineCard.tsx';
import { MachineLogo } from './MachineLogo.tsx';
import { MachineMetrics } from './MachineMetrics.tsx';
import { MachineIdentity } from './MachineStatsRow.tsx';

type MachineCardProps = ComponentProps<typeof MachineCard>;

/**
 * A machine on the Machines page, folded to who it is and its numbers until it is opened; open, the whole card
 * (power, settings, actions) with Collapse in its top corner.
 */
export function MachineFold({
  open,
  onToggle,
  ...card
}: MachineCardProps & { readonly open: boolean; readonly onToggle: () => void }) {
  if (open) {
    return (
      <div className="relative">
        <MachineCard {...card} />
        <Button
          size="sm"
          tone="quiet"
          icon={ChevronUp}
          aria-expanded
          onClick={onToggle}
          className="absolute top-5 right-5 md:top-6 md:right-6"
        >
          Collapse
        </Button>
      </div>
    );
  }
  const { machine, stats, now, companyId } = card;
  // The stats refresh every minute, so their status is the fresher one; the name and logo are the machine's.
  const facts = stats ? { ...stats, name: machine.name } : { ...machine, upSince: null };
  const mark = {
    companyId,
    machineId: machine.id,
    name: machine.name,
    kind: machine.kind,
    online: facts.status === 'online',
    logoVersion: machine.logo?.version,
  };
  return (
    <Card as="article" aria-label={machine.name} className="flex flex-col gap-4">
      <MachineIdentity
        stats={facts}
        now={now}
        mark={<MachineLogo mark={mark} />}
        aside={
          <span className="flex items-center gap-2">
            {machine.provider === 'airia_devbox' && (
              <FoldedPower companyId={companyId} machineId={machine.id} />
            )}
            <Button size="sm" tone="secondary" icon={ChevronDown} aria-expanded={false} onClick={onToggle}>
              Details
            </Button>
          </span>
        }
      />
      {stats && <MachineMetrics stats={stats} />}
    </Card>
  );
}

/** A folded devbox's Start or Stop, so it needs no opening. */
function FoldedPower({ companyId, machineId }: { readonly companyId: string; readonly machineId: string }) {
  const control = usePowerControl(companyId, machineId);
  return <DevboxQuickPower control={control} />;
}
