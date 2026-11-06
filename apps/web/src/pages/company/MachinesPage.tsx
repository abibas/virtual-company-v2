import { roleAtLeast } from '@mwc/shared/roles';
import { Plus, Server } from 'lucide-react';
import { useApi } from '../../api/context.ts';
import { machineCalls, useMachineStats, useMachines } from '../../api/machines.ts';
import { useCompany } from '../../app/company.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';
import { Skeleton } from '../../components/ui/Skeleton.tsx';
import { AddMachineSheet } from '../../features/machines/AddMachineSheet.tsx';
import { useAddMachine } from '../../features/machines/add-machine.ts';
import { MachineCard } from '../../features/machines/MachineCard.tsx';
import { useNow } from '../../features/subscriptions/limits.ts';

/** None yet: the invitation to add one (admins), or who does. */
function NoMachines({ onAdd }: { readonly onAdd: (() => void) | undefined }) {
  return (
    <Card>
      <EmptyState
        icon={Server}
        tone="blue"
        title="No machines yet"
        action={
          onAdd && (
            <Button tone="primary" icon={Plus} onClick={onAdd}>
              Add a machine
            </Button>
          )
        }
      >
        {onAdd
          ? 'Add This Mac, your Airia devbox or a Docker container.'
          : 'An admin adds the machines agents run on.'}
      </EmptyState>
    </Card>
  );
}

/**
 * `/:slug/machines`: the machines agents run on (This Mac, a Docker container, the Airia devbox), a card each with its
 * status, numbers, power and log; admins add, rename and remove them, start and stop the devbox and set the power.
 */
export function MachinesPage() {
  const { membership } = useCompany();
  const { companyId } = membership;
  const admin = roleAtLeast(membership.role, 'admin');
  const calls = machineCalls(useApi(), companyId);
  const machines = useMachines(companyId);
  const stats = useMachineStats(companyId);
  const reload = () => {
    machines.reload();
    stats.reload();
  };
  const adding = useAddMachine(companyId, reload);
  const now = useNow();
  return (
    <>
      <PageHeader
        title="Machines"
        actions={
          admin && (
            <Button tone="primary" icon={Plus} onClick={adding.choose}>
              Add a machine
            </Button>
          )
        }
      >
        <p>
          Where {membership.name}’s agents run, kept awake while they work and started or stopped by its
          rules.
        </p>
      </PageHeader>
      <LoadState
        loaded={machines}
        label="Loading the machines…"
        skeleton={<Skeleton className="h-96 rounded-2xl" />}
      >
        {(data) =>
          data.machines.length === 0 ? (
            <NoMachines onAdd={admin ? adding.choose : undefined} />
          ) : (
            <div className="grid gap-4 md:gap-5">
              {data.machines.map((machine) => (
                <MachineCard
                  key={machine.id}
                  machine={machine}
                  stats={stats.data?.machines.find((item) => item.machineId === machine.id)}
                  now={now}
                  admin={admin}
                  companyId={companyId}
                  calls={calls}
                  onChanged={reload}
                />
              ))}
            </div>
          )
        }
      </LoadState>
      {admin && <AddMachineSheet adding={adding} />}
    </>
  );
}
