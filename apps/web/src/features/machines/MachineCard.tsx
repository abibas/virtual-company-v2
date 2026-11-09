import { MACHINE_NAME } from '@mwc/shared/machines';
import type { ReactNode } from 'react';
import { type MachineCalls, type PowerControl, usePowerControl } from '../../api/machines.ts';
import type { Machine, MachinePower, MachineStats, PowerEvent } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { formatDateTime } from '../../components/data/format.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { InlineEdit } from '../../components/forms/InlineEdit.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { DevboxPower } from './DevboxPower.tsx';
import { MachineActions } from './MachineActions.tsx';
import { MachineMetrics } from './MachineMetrics.tsx';
import { MachineIdentity } from './MachineStatsRow.tsx';
import { agoText } from './machine-text.ts';
import { PowerSettings } from './PowerSettings.tsx';
import { actorText, holdText, tunnelText } from './power-text.ts';

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

/** Versions, where it runs and its hold, in one quiet line. */
function FactsLine({
  machine,
  power,
  now,
}: {
  readonly machine: Machine;
  readonly power: MachinePower | undefined;
  readonly now: number;
}) {
  const claude = machine.versions.claude
    ? ` · Claude Code ${machine.versions.claude.replace(/ \(Claude Code\)$/, '')}`
    : '';
  const hold = holdText(machine, power, now);
  return (
    <p className="text-xs text-dim">
      Runner {machine.versions.runner}
      {claude} · {machine.os} {machine.arch} · {machine.unixUser}@{machine.hostname}
      {hold && <span className="font-medium text-ink-2"> · {hold}</span>}
    </p>
  );
}

/** A devbox's link to the server through its controller's SSH tunnel, in one short line; nothing without a report. */
function TunnelLine({
  machine,
  power,
}: {
  readonly machine: Machine;
  readonly power: MachinePower | undefined;
}) {
  const tunnel = tunnelText(machine, power);
  if (tunnel === undefined) return null;
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
      <Badge tone={tunnel.tone} size="sm" dot>
        {tunnel.label}
      </Badge>
      {tunnel.detail && <span className="min-w-0 break-words">{tunnel.detail}</span>}
    </p>
  );
}

/** Who and how it is: its name (renamed in place by admins), status, facts and tunnel. */
function Header({
  machine,
  stats,
  power,
  now,
  admin,
  onRename,
}: {
  readonly machine: Machine;
  readonly stats: MachineStats | undefined;
  readonly power: MachinePower | undefined;
  readonly now: number;
  readonly admin: boolean;
  readonly onRename: (name: string) => Promise<void>;
}) {
  // The stats refresh every minute, so their status is the fresher one; the name is the machine's (a rename).
  const facts = stats ? { ...stats, name: machine.name } : { ...machine, upSince: null };
  return (
    <div className="flex flex-col gap-2">
      <MachineIdentity
        stats={facts}
        now={now}
        name={
          <InlineEdit
            value={machine.name}
            label={`Rename ${machine.name}`}
            maxLength={MACHINE_NAME.max}
            disabled={!admin}
            onSave={onRename}
          />
        }
      />
      <FactsLine machine={machine} power={power} now={now} />
      <TunnelLine machine={machine} power={power} />
    </div>
  );
}

/** The power parts: the devbox's controls, the log, and the power settings. */
function PowerParts({
  machine,
  control,
  now,
}: {
  readonly machine: Machine;
  readonly control: PowerControl;
  readonly now: number;
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
        <Part title="Log">
          <PowerLog events={control.events} now={now} />
        </Part>
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

/** A machine on the Machines page: who and how it is, its numbers, its power, its log, and its actions (Connect, Remove for admins). */
export function MachineCard({
  machine,
  stats,
  now,
  admin,
  companyId,
  calls,
  onChanged,
}: {
  readonly machine: Machine;
  readonly stats: MachineStats | undefined;
  readonly now: number;
  readonly admin: boolean;
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
  return (
    <Card as="article" aria-label={machine.name} className="flex flex-col gap-5">
      <Header
        machine={machine}
        stats={stats}
        power={control.power.data}
        now={now}
        admin={admin}
        onRename={rename}
      />
      {stats && <MachineMetrics stats={stats} />}
      <PowerParts machine={machine} control={control} now={now} />
      <MachineActions machine={machine} admin={admin} onRemove={remove} />
    </Card>
  );
}
