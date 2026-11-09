import { MACHINE_NAME } from '@mwc/shared/machines';
import type { LatestRunner, Machine, MachinePower, MachineStats } from '../../../api/types.ts';
import { InlineEdit } from '../../../components/forms/InlineEdit.tsx';
import { Badge } from '../../../components/ui/Badge.tsx';
import { holdText, tunnelText } from '../power/power-text.ts';
import { outOfDateText, runnerOutOfDate, versionText } from '../runner/runner-text.ts';
import { EditableMachineLogo, MachineLogo } from './MachineLogo.tsx';
import { MachineIdentity } from './MachineStatsRow.tsx';

/**
 * The top of a machine card: its logo and name (changed in place by admins), its status, "Runner out of date" with the
 * latest version when its runner runs another build than the server hands out (or has no terminal), its versions (the
 * runner's with its build time), hold and tunnel.
 */

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
      Runner {versionText(machine.runner.version, machine.runner.builtAt)}
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

/** Who and how it is: its logo and name (changed in place by admins), status, facts and tunnel. */
export function MachineHeader({
  machine,
  latestRunner,
  stats,
  power,
  now,
  admin,
  online,
  companyId,
  onRename,
  onChanged,
}: {
  readonly machine: Machine;
  /** The runner the server hands out, named in the out-of-date badge; null while it is not built. */
  readonly latestRunner: LatestRunner;
  readonly stats: MachineStats | undefined;
  readonly power: MachinePower | undefined;
  readonly now: number;
  readonly admin: boolean;
  readonly online: boolean;
  readonly companyId: string;
  readonly onRename: (name: string) => Promise<void>;
  readonly onChanged: () => void;
}) {
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
    <div className="flex flex-col gap-2">
      <MachineIdentity
        stats={facts}
        now={now}
        mark={admin ? <EditableMachineLogo mark={mark} onChanged={onChanged} /> : <MachineLogo mark={mark} />}
        name={
          <InlineEdit
            value={machine.name}
            label={`Rename ${machine.name}`}
            maxLength={MACHINE_NAME.max}
            disabled={!admin}
            onSave={onRename}
          />
        }
        badges={
          runnerOutOfDate(machine, online) && (
            <Badge tone="input" size="sm" dot>
              {outOfDateText(latestRunner)}
            </Badge>
          )
        }
      />
      <FactsLine machine={machine} power={power} now={now} />
      <TunnelLine machine={machine} power={power} />
    </div>
  );
}
