import { ExternalLink, Power, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/errors.ts';
import type { MachineWake } from '../../api/machine-wake.ts';
import type { MachineChoice } from '../../api/types.ts';
import { Link } from '../../app/router.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { CommandBox } from '../machines/add/CommandBox.tsx';
import { powerRefusal } from '../machines/power/power-text.ts';
import { elapsedText, machineCardHref, runnerGoneLine, type WakeView, wakeView } from './wake-text.ts';

/**
 * Waking an offline machine without leaving the agent form: in the folder browser a line, Start (or the command, or
 * Check again), Open Machines in a new tab and "or type the path"; beside the machine select a small Start. Both follow
 * the form's one wake (`useMachineWake`), so a start from either shows in both.
 */

/** "0:42", counting up each second from `since`. */
function Elapsed({ since }: { readonly since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return <span className="tabular">{elapsedText(now - since)}</span>;
}

/** Why the wake stopped: the start's refusal, or the 5 minutes passed. */
export function wakeFailureText(wake: MachineWake): string | undefined {
  if (wake.phase === 'late') return 'Still not connected after 5 minutes.';
  if (wake.phase !== 'failed') return undefined;
  return powerRefusal(wake.failure, wake.power?.controller ?? null);
}

/** The machine's card on the Machines page, in a new tab so the form stays as it is. */
function MachinesLink({ href, label = 'Open Machines' }: { readonly href: string; readonly label?: string }) {
  return (
    <Link
      to={href}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1 text-sm font-semibold text-blue hover:underline"
    >
      {label}
      <ExternalLink size={13} aria-hidden="true" />
    </Link>
  );
}

/** Start, Starting… with the time, or Retry. */
function StartButton({ view, wake, size }: { view: WakeView; wake: MachineWake; size: 'sm' | 'md' }) {
  if (view.action.kind !== 'start') return null;
  if (wake.phase === 'starting') {
    return (
      <Button size={size} tone="primary" busy disabled>
        Starting… {wake.startedAt !== undefined && <Elapsed since={wake.startedAt} />}
      </Button>
    );
  }
  const again = wake.phase === 'failed' || wake.phase === 'late';
  return (
    <Button size={size} tone="primary" icon={Power} title={view.action.title} onClick={wake.start}>
      {again ? 'Retry' : size === 'sm' ? view.action.short : view.action.label}
    </Button>
  );
}

export interface WakePanelProps {
  readonly machine: MachineChoice;
  readonly wake: MachineWake;
  readonly machinesHref: string;
  /** The machine shows online but its runner did not answer: only Check again. */
  readonly runnerGone: boolean;
  /** Reads the machine again (and the folders). */
  readonly onCheck: () => void;
  /** Closes the browser and goes to the home folder's field. */
  readonly onTypePath: () => void;
}

/** The folder browser's state while the machine is offline: one line, the wake, the Machines link, typing instead. */
export function WakePanel({ machine, wake, machinesHref, runnerGone, onCheck, onTypePath }: WakePanelProps) {
  const view: WakeView = runnerGone
    ? { line: runnerGoneLine(machine.name), action: { kind: 'none', hint: undefined } }
    : wakeView(machine, wake.power);
  const starting = wake.phase === 'starting';
  const failure = runnerGone ? undefined : wakeFailureText(wake);
  const { action } = view;
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-surface-2 p-4">
      <p className="text-sm font-semibold text-ink">
        {starting ? `${machine.name} is starting.` : view.line}
      </p>
      {starting && (
        <p className="-mt-2 text-xs text-dim">Usually 1–2 minutes. The folders load once it is up.</p>
      )}
      {failure && <Notice tone="error">{failure}</Notice>}
      {wake.phase === 'failed' && wake.failure instanceof ApiError && wake.failure.command && (
        <CommandBox command={wake.failure.command} />
      )}
      {action.kind === 'command' && <CommandBox command={action.command} />}
      {action.kind === 'none' && action.hint && <p className="-mt-1 text-xs text-dim">{action.hint}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StartButton view={view} wake={wake} size="md" />
        {(action.kind !== 'start' || runnerGone) && !starting && (
          <Button icon={RefreshCw} onClick={onCheck}>
            Check again
          </Button>
        )}
        <MachinesLink href={machineCardHref(machinesHref, machine.id)} />
        <button
          type="button"
          onClick={onTypePath}
          className="text-sm text-dim hover:text-ink hover:underline"
        >
          or type the path
        </button>
      </div>
    </div>
  );
}

/** Beside the Offline badge: a small Start (Starting… with the time, Retry), else the Machines link in a new tab. */
export function WakeInline({
  machine,
  wake,
  machinesHref,
}: {
  readonly machine: MachineChoice;
  readonly wake: MachineWake;
  readonly machinesHref: string;
}) {
  const view = wakeView(machine, wake.power);
  if (view.action.kind === 'start') return <StartButton view={view} wake={wake} size="sm" />;
  if (wake.phase === 'starting') {
    return (
      <span className="shrink-0 text-xs text-dim">
        Starting… {wake.startedAt !== undefined && <Elapsed since={wake.startedAt} />}
      </span>
    );
  }
  return <MachinesLink href={machineCardHref(machinesHref, machine.id)} label="Machines" />;
}
