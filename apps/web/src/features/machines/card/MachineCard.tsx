import type { ReactNode } from 'react';
import { type MachineCalls, type PowerControl, usePowerControl } from '../../../api/machines.ts';
import type { LatestRunner, Machine, MachineStats, PowerEvent } from '../../../api/types.ts';
import type { Loaded } from '../../../api/use-load.ts';
import { formatDateTime } from '../../../components/data/format.ts';
import { LoadState } from '../../../components/data/LoadState.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { DevboxPower } from '../power/DevboxPower.tsx';
import { PowerSettings } from '../power/PowerSettings.tsx';
import { actorText } from '../power/power-text.ts';
import { busyJob, cardJob, liveReason } from '../runner/machine-job.ts';
import { useRunnerUpdate } from '../runner/RunnerUpdate.tsx';
import { MachineTools } from '../tools/MachineTools.tsx';
import { machineCardId } from '../tools/tools-text.ts';
import { useToolInstall } from '../tools/use-tools.ts';
import { MachineActions } from './MachineActions.tsx';
import { MachineHeader } from './MachineHeader.tsx';
import { MachineMetrics } from './MachineMetrics.tsx';
import { agoText } from './machine-text.ts';

/** A part of the card under its small heading. */
function Part({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h4 className="text-xs font-bold text-ink-2">{title}</h4>
      {children}
    </section>
  );
}

/** The power log: the last 10 events, who and when. */
function PowerLog({
  events,
  now,
}: {
  readonly events: Loaded<{ readonly events: readonly PowerEvent[] }>;
  readonly now: number;
}) {
  return (
    <LoadState loaded={events} label="Loading the log…">
      {({ events: list }) =>
        list.length === 0 ? (
          <p className="text-xs text-dim">Nothing yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {list.map((event) => (
              <li key={event.id} className="text-xs">
                <p className="text-ink-2">{event.reason}</p>
                <p className="text-dim" title={formatDateTime(event.at)}>
                  {actorText(event)} · {agoText(event.at, now)}
                </p>
              </li>
            ))}
          </ol>
        )
      }
    </LoadState>
  );
}

/**
 * The card's two columns: the devbox's power controls and the machine's software (runner and CLIs) on the left, the power
 * settings on the right (the log is behind the actions' Log button).
 */
function PowerParts({
  machine,
  control,
  software,
}: {
  readonly machine: Machine;
  readonly control: PowerControl;
  readonly software: ReactNode;
}) {
  const power = control.power.data;
  const devbox = machine.provider === 'airia_devbox';
  return (
    <div className="grid gap-6 border-t border-line pt-5 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-6">
        {devbox && power && (
          <Part title="Power">
            <DevboxPower power={power} control={control} />
          </Part>
        )}
        {software}
      </div>
      <Part title="Power settings">
        <LoadState loaded={control.power} label="Loading the power settings…">
          {(data) => (
            <PowerSettings
              key={JSON.stringify(data.policy)}
              policy={data.policy}
              kind={machine.kind}
              devbox={devbox}
              canControl={data.canControl}
              onSave={control.setPolicy}
            />
          )}
        </LoadState>
      </Part>
    </div>
  );
}

/**
 * A machine on the Machines page: who and how it is (`MachineHeader`), its numbers, its power, its tools (the CLIs its
 * runner found; Check again and Install for admins), its log, and its actions (Connect, Terminal for owners, Update
 * runner and Remove for admins). One job at a time per machine: an install or a runner update (the server's
 * `runner.job`, or one this card started) shows in Software, and the other buttons wait for it; Update runner also
 * waits for the machine's chat turns and terminals.
 */
export function MachineCard({
  machine,
  latestRunner,
  stats,
  now,
  admin,
  owner,
  companyId,
  calls,
  onChanged,
}: {
  readonly machine: Machine;
  /** The runner the server hands out (null while it is not built), which an out-of-date runner's badge names. */
  readonly latestRunner: LatestRunner;
  readonly stats: MachineStats | undefined;
  readonly now: number;
  readonly admin: boolean;
  readonly owner: boolean;
  readonly companyId: string;
  readonly calls: MachineCalls;
  readonly onChanged: () => void;
}) {
  const control = usePowerControl(companyId, machine.id);
  const rename = async (name: string) => {
    await calls.update(machine.id, { name });
    onChanged();
  };
  const remove = async () => {
    await calls.remove(machine.id);
    onChanged();
  };
  const online = (stats?.status ?? machine.status) === 'online';
  const install = useToolInstall(calls, machine.id, onChanged);
  const update = useRunnerUpdate(() => calls.updateRunner(machine.id), onChanged);
  const job = busyJob(machine.runner.job, cardJob(machine, install.state, update.state));
  const updateBlocked = job?.reason ?? liveReason(machine.runner.live);
  return (
    <Card
      as="article"
      id={machineCardId(machine.id)}
      aria-label={machine.name}
      className="flex scroll-mt-6 flex-col gap-5"
    >
      <MachineHeader
        machine={machine}
        latestRunner={latestRunner}
        stats={stats}
        power={control.power.data}
        now={now}
        admin={admin}
        online={online}
        companyId={companyId}
        onRename={rename}
        onChanged={onChanged}
      />
      {stats && <MachineMetrics stats={stats} />}
      <PowerParts
        machine={machine}
        control={control}
        software={
          <MachineTools
            machine={machine}
            latestRunner={latestRunner}
            admin={admin}
            online={online}
            calls={calls}
            install={install}
            job={job}
            onChanged={onChanged}
          />
        }
      />
      <MachineActions
        machine={machine}
        companyId={companyId}
        admin={admin}
        owner={owner}
        online={online}
        update={update}
        blocked={updateBlocked}
        log={<PowerLog events={control.events} now={now} />}
        onRemove={remove}
      />
    </Card>
  );
}
