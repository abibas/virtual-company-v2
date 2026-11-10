import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { usePowerControl } from '../../../api/machines.ts';
import type { MachineTools } from '../../../api/types.ts';
import { Button } from '../../../components/ui/Button.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { ContainerOutcome, ContainerStartStop, useShownCommand } from '../power/ContainerPower.tsx';
import { useContainerActions } from '../power/container-power.ts';
import { DevboxQuickPower } from '../power/DevboxPower.tsx';
import { machineCardId, toolsLine } from '../tools/tools-text.ts';
import { MachineCard } from './MachineCard.tsx';
import { MachineLogo } from './MachineLogo.tsx';
import { MachineMetrics } from './MachineMetrics.tsx';
import { MachineIdentity } from './MachineStatsRow.tsx';

type MachineCardProps = ComponentProps<typeof MachineCard>;

/**
 * A machine on the Machines page, folded to who it is, its numbers and its harness CLIs ("Claude Code 2.1.319 · Codex
 * —") until it is opened, with a devbox's or a container's Start or Stop next to Details; open, the whole card (power,
 * settings, tools, actions) with Collapse in its top corner.
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
  const { machine } = card;
  if (machine.kind === 'container') return <FoldedContainer card={card} onToggle={onToggle} />;
  const power =
    machine.provider === 'airia_devbox' ? (
      <FoldedPower companyId={card.companyId} machineId={machine.id} />
    ) : undefined;
  return <Folded card={card} onToggle={onToggle} power={power} />;
}

/**
 * The folded card: who it is (its status says Stopped for a container Docker reports stopped), Start or Stop next to
 * Details when it has power, its numbers and CLIs, and what follows a container's Start or Stop.
 */
function Folded({
  card,
  onToggle,
  power,
  stopped = false,
  below,
}: {
  readonly card: MachineCardProps;
  readonly onToggle: () => void;
  readonly power?: ReactNode;
  readonly stopped?: boolean;
  readonly below?: ReactNode;
}) {
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
    <Card
      as="article"
      id={machineCardId(machine.id)}
      aria-label={machine.name}
      className="flex scroll-mt-6 flex-col gap-4"
    >
      <MachineIdentity
        stats={{ ...facts, stopped }}
        now={now}
        mark={<MachineLogo mark={mark} />}
        aside={
          <span className="flex items-center gap-2">
            {power}
            <Button size="sm" tone="secondary" icon={ChevronDown} aria-expanded={false} onClick={onToggle}>
              Details
            </Button>
          </span>
        }
      />
      {stats && <MachineMetrics stats={stats} />}
      {mark.online && <FoldedTools tools={machine.runner.tools} />}
      {below}
    </Card>
  );
}

/** A folded container card: Start or Stop by its Docker state, and the command to run when the server has no Docker. */
function FoldedContainer({
  card,
  onToggle,
}: {
  readonly card: MachineCardProps;
  readonly onToggle: () => void;
}) {
  const control = usePowerControl(card.companyId, card.machine.id);
  const actions = useContainerActions(control);
  const { shown, toggle } = useShownCommand();
  const power = control.power.data;
  const container = power?.container ?? undefined;
  const live = card.machine.runner.live;
  return (
    <Folded
      card={card}
      onToggle={onToggle}
      stopped={container?.status === 'stopped'}
      power={
        container &&
        power?.canControl && (
          <ContainerStartStop container={container} live={live} actions={actions} onCommand={toggle} />
        )
      }
      below={container && <ContainerOutcome container={container} actions={actions} shown={shown} />}
    />
  );
}

/** A folded card's harness CLIs, while its runner says them. */
function FoldedTools({ tools }: { readonly tools: MachineTools | null }) {
  return tools && <p className="text-xs text-dim">{toolsLine(tools)}</p>;
}

/** A folded devbox's Start or Stop, so it needs no opening. */
function FoldedPower({ companyId, machineId }: { readonly companyId: string; readonly machineId: string }) {
  const control = usePowerControl(companyId, machineId);
  return <DevboxQuickPower control={control} />;
}
