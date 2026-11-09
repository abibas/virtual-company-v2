import { ArrowRight, Plus, Server } from 'lucide-react';
import { useMachineStats } from '../../api/machines.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { Button, ButtonLink } from '../../components/ui/Button.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { useNow } from '../subscriptions/limits.ts';
import { AddMachineSheet } from './AddMachineSheet.tsx';
import { useAddMachine } from './add-machine.ts';
import { MachineStatsRow } from './MachineStatsRow.tsx';

const SKELETON = (
  <div className="flex flex-col gap-3">
    <Skeleton className="h-40 rounded-2xl" />
    <Skeleton className="h-40 rounded-2xl max-md:hidden" />
  </div>
);

/**
 * "Machines" on the home page: one row per machine with its live numbers, refreshed every minute while the tab is
 * visible; a link to the Machines page, and for admins the add sheet in place.
 */
export function MachinesBoard({
  companyId,
  machinesHref,
  admin,
}: {
  readonly companyId: string;
  readonly machinesHref: string;
  readonly admin: boolean;
}) {
  const stats = useMachineStats(companyId);
  const adding = useAddMachine(companyId, stats.reload);
  const now = useNow();
  return (
    <Panel
      title="Machines"
      description="Where your agents run, and how they are doing."
      actions={
        <ButtonLink href={machinesHref} size="sm" tone="quiet" trailingIcon={ArrowRight}>
          Open Machines
        </ButtonLink>
      }
    >
      <LoadState loaded={stats} label="Loading the machines…" skeleton={SKELETON}>
        {(data) =>
          data.machines.length === 0 ? (
            <EmptyState
              icon={Server}
              tone="blue"
              size="sm"
              title="No machines yet"
              action={
                admin && (
                  <Button tone="primary" icon={Plus} onClick={adding.choose}>
                    Add a machine
                  </Button>
                )
              }
            >
              {admin
                ? 'Add This Mac, your Airia devbox or a Docker container to run agents on.'
                : 'An admin adds the machines agents run on.'}
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-3">
              {data.machines.map((machine) => (
                <MachineStatsRow key={machine.machineId} stats={machine} now={now} companyId={companyId} />
              ))}
            </div>
          )
        }
      </LoadState>
      {admin && <AddMachineSheet adding={adding} />}
    </Panel>
  );
}
