import { History, SquareTerminal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { Machine } from '../../../api/types.ts';
import { ConfirmInline } from '../../../components/forms/ConfirmInline.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { CommandBox } from '../add/CommandBox.tsx';
import { type RunnerUpdate, RunnerUpdateNotice, UpdateRunnerButton } from '../runner/RunnerUpdate.tsx';
import { runnerOutOfDate } from '../runner/runner-text.ts';
import { TerminalButton } from '../terminal/TerminalButton.tsx';
import { type ConnectCommand, connectCommand } from './connect-command.ts';

type Panel = 'connect' | 'log' | null;

/** The shell command for this machine, its Copy button and where to run it. */
function ConnectPanel({ command, hint }: { readonly command: string; readonly hint: string }) {
  return (
    <section aria-label="Connect" className="flex flex-col gap-3">
      <CommandBox command={command} />
      <p className="text-xs text-dim">{hint}</p>
    </section>
  );
}

/** The tools on the left of the row: Connect, Terminal (owners), Update runner (admins, when due) and Log. */
function Tools({
  machine,
  companyId,
  owner,
  online,
  connect,
  panel,
  toggle,
  update,
  blocked,
}: {
  readonly machine: Machine;
  readonly companyId: string;
  readonly owner: boolean;
  readonly online: boolean;
  readonly connect: ConnectCommand | null;
  readonly panel: Panel;
  readonly toggle: (which: 'connect' | 'log') => void;
  /** Undefined when the runner needs no update or the caller may not update it. */
  readonly update: RunnerUpdate | undefined;
  readonly blocked: string | undefined;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {connect && (
        <Button
          size="sm"
          tone={panel === 'connect' ? 'soft' : 'secondary'}
          icon={SquareTerminal}
          aria-expanded={panel === 'connect'}
          onClick={() => toggle('connect')}
        >
          Connect
        </Button>
      )}
      {owner && <TerminalButton companyId={companyId} machine={machine} online={online} />}
      {update && <UpdateRunnerButton update={update} blocked={blocked} />}
      <Button
        size="sm"
        tone={panel === 'log' ? 'soft' : 'secondary'}
        icon={History}
        aria-expanded={panel === 'log'}
        onClick={() => toggle('log')}
      >
        Log
      </Button>
    </div>
  );
}

/**
 * The card's action row: tools on the left (Connect, Terminal for owners while the machine is online, Update runner
 * for admins while its runner is out of date (a container's Update container is in Software instead), waiting while
 * another job or live work runs on the machine, and the
 * power Log), Remove for admins on the right, and the open tool's panel under the row (the terminal in its own sheet,
 * the update's outcome).
 */
export function MachineActions({
  machine,
  companyId,
  admin,
  owner,
  online,
  update,
  blocked,
  log,
  onRemove,
}: {
  readonly machine: Machine;
  readonly companyId: string;
  readonly admin: boolean;
  readonly owner: boolean;
  readonly online: boolean;
  /** The runner's update (the card's, which loads it again once the runner is back). */
  readonly update: RunnerUpdate;
  /** Why Update runner waits: another job, or chat turns or terminals running on the machine. */
  readonly blocked: string | undefined;
  /** The power log, shown under the row while Log is open. */
  readonly log: ReactNode;
  readonly onRemove: () => Promise<void>;
}) {
  const connect = connectCommand(machine);
  const [panel, setPanel] = useState<Panel>(null);
  const toggle = (which: 'connect' | 'log') => setPanel((was) => (was === which ? null : which));
  // A container's runner is updated by rebuilding the container: Update container is in its Software part.
  const container = machine.kind === 'container';
  const due = admin && !container && (runnerOutOfDate(machine, online) || update.state.kind !== 'idle');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Tools
          {...{ machine, companyId, owner, online, connect, panel, toggle }}
          update={due ? update : undefined}
          blocked={blocked}
        />
        {admin && (
          <ConfirmInline
            label="Remove"
            question={`Remove ${machine.name}? Its runner is refused from then on; its history stays. Enroll it again to bring it back.`}
            confirmLabel="Remove"
            onConfirm={onRemove}
          />
        )}
      </div>
      {!container && <RunnerUpdateNotice update={update} failure={machine.runner.updateFailure} />}
      {connect && panel === 'connect' && <ConnectPanel command={connect.command} hint={connect.hint} />}
      {panel === 'log' && (
        <section aria-label="Log" className="flex flex-col gap-3">
          {log}
        </section>
      )}
    </div>
  );
}
