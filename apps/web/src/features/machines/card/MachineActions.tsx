import { History, SquareTerminal } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import type { MachineCalls } from '../../../api/machines.ts';
import type { Machine } from '../../../api/types.ts';
import { ConfirmInline } from '../../../components/forms/ConfirmInline.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { CommandBox } from '../add/CommandBox.tsx';
import {
  type RunnerUpdate,
  RunnerUpdateNotice,
  UpdateRunnerButton,
  useRunnerUpdate,
} from '../runner/RunnerUpdate.tsx';
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
      {update && <UpdateRunnerButton update={update} />}
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
 * for admins while its runner is out of date, and the power Log), Remove for admins on the right, and the open tool's
 * panel under the row (the terminal in its own sheet, the update's outcome).
 */
export function MachineActions({
  machine,
  companyId,
  admin,
  owner,
  online,
  calls,
  log,
  onRemove,
  onChanged,
}: {
  readonly machine: Machine;
  readonly companyId: string;
  readonly admin: boolean;
  readonly owner: boolean;
  readonly online: boolean;
  readonly calls: MachineCalls;
  /** The power log, shown under the row while Log is open. */
  readonly log: ReactNode;
  readonly onRemove: () => Promise<void>;
  /** Loads the card again (after a runner update, once the runner is back). */
  readonly onChanged: () => void;
}) {
  const connect = connectCommand(machine);
  const [panel, setPanel] = useState<Panel>(null);
  const toggle = (which: 'connect' | 'log') => setPanel((was) => (was === which ? null : which));
  const update = useRunnerUpdate(() => calls.updateRunner(machine.id), onChanged);
  const due = admin && (runnerOutOfDate(machine, online) || update.state.kind !== 'idle');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Tools
          {...{ machine, companyId, owner, online, connect, panel, toggle }}
          update={due ? update : undefined}
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
      <RunnerUpdateNotice update={update} />
      {connect && panel === 'connect' && <ConnectPanel command={connect.command} hint={connect.hint} />}
      {panel === 'log' && (
        <section aria-label="Log" className="flex flex-col gap-3">
          {log}
        </section>
      )}
    </div>
  );
}
