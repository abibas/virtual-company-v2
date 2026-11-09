import { Clock, Power, PowerOff } from 'lucide-react';
import { useState } from 'react';
import type { PowerControl } from '../../api/machines.ts';
import type { MachinePower, PowerBox } from '../../api/types.ts';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Notice } from '../../components/ui/Notice.tsx';
import { BOX_STATUS, costText } from './machine-text.ts';
import { boxRulesText, powerRefusal } from './power-text.ts';

/** Runs a power change: busy while it waits, its refusal in plain words. */
function useAction(controller: MachinePower['controller']) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const run = async (name: string, change: () => Promise<void>) => {
    setBusy(name);
    setError(undefined);
    try {
      await change();
    } catch (failure) {
      setError(powerRefusal(failure, controller));
    } finally {
      setBusy(undefined);
    }
  };
  return { busy, error, run: (name: string, change: () => Promise<void>) => void run(name, change) };
}

/** The question before a Start: what the box costs while it runs. */
function ConfirmStart({
  cost,
  onCancel,
  onStart,
}: {
  readonly cost: string;
  readonly onCancel: () => void;
  readonly onStart: () => void;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape anywhere in the question cancels it.
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg bg-input-soft px-3 py-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <p className="text-sm font-medium text-ink">The box costs {cost} while it runs. Start it?</p>
      <Button size="sm" tone="quiet" onClick={onCancel}>
        Cancel
      </Button>
      <Button size="sm" tone="primary" icon={Power} onClick={onStart} autoFocus>
        Start
      </Button>
    </div>
  );
}

/** Start, confirmed in place since the box costs money while it runs; Stop at once. */
function StartStop({
  box,
  control,
  busy,
  run,
}: {
  readonly box: PowerBox;
  readonly control: PowerControl;
  readonly busy: string | undefined;
  readonly run: (name: string, change: () => Promise<void>) => void;
}) {
  const [asking, setAsking] = useState(false);
  const up = box.status === 'running' || box.status === 'starting';
  if (up) {
    return (
      <Button
        size="sm"
        icon={PowerOff}
        busy={busy === 'stop'}
        disabled={busy !== undefined}
        onClick={() => run('stop', control.stop)}
      >
        Stop
      </Button>
    );
  }
  if (asking) {
    return (
      <ConfirmStart
        cost={box.hourlyCost === null ? 'its hourly rate' : costText(box.hourlyCost)}
        onCancel={() => setAsking(false)}
        onStart={() => {
          setAsking(false);
          run('start', control.start);
        }}
      />
    );
  }
  return (
    <Button
      size="sm"
      tone="primary"
      icon={Power}
      busy={busy === 'start'}
      disabled={busy !== undefined || box.status === 'stopping'}
      onClick={() => setAsking(true)}
    >
      Start{box.hourlyCost === null ? '' : ` · ${costText(box.hourlyCost)}`}
    </Button>
  );
}

/** Who starts and stops the box (this server with the airia CLI, or a Mac's runner), and whether it is connected. */
function ControllerLine({ controller }: { readonly controller: MachinePower['controller'] }) {
  if (controller?.kind === 'server')
    return <p className="text-xs text-dim">Started and stopped by this server with your airia CLI</p>;
  if (controller === null)
    return (
      <p className="text-xs text-dim">
        No controller chosen: the connected Mac that can power the box is used.
      </p>
    );
  return (
    <p className="text-xs text-dim">
      Started and stopped by <span className="font-semibold text-ink-2">{controller.name}</span>
      {controller.online ? ' · connected' : <span className="font-medium text-failed"> · not connected</span>}
    </p>
  );
}

/** The box's own rules in one sentence, and the fix when its time zone is not the keep-on hours' one. */
function BoxRules({
  power,
  control,
  busy,
  run,
}: {
  readonly power: MachinePower;
  readonly control: PowerControl;
  readonly busy: string | undefined;
  readonly run: (name: string, change: () => Promise<void>) => void;
}) {
  const rules = power.box?.rules;
  if (!rules) return null;
  const zone = power.policy.keepOn.timezone;
  return (
    <div className="flex flex-col items-start gap-2">
      <p className="flex items-start gap-2 text-xs text-dim">
        <Clock size={14} aria-hidden="true" className="mt-px shrink-0" />
        {boxRulesText(rules)}
      </p>
      {power.canControl && rules.timezone !== zone && (
        <Button
          size="sm"
          tone="soft"
          busy={busy === 'timezone'}
          disabled={busy !== undefined}
          onClick={() => run('timezone', () => control.setTimezone(zone))}
        >
          Set the box's time zone to {zone}
        </Button>
      )}
    </div>
  );
}

/** A devbox's power: the box's status, Start or Stop with its cost, its controller, its own rules, any refusal. */
export function DevboxPower({
  power,
  control,
}: {
  readonly power: MachinePower;
  readonly control: PowerControl;
}) {
  const { busy, error, run } = useAction(power.controller);
  const box = power.box;
  if (!box) return null;
  const [words, tone] = BOX_STATUS[box.status];
  return (
    <section aria-label="The box" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={tone} dot>
          Box {words.toLowerCase()}
        </Badge>
        {box.hourlyCost !== null && (
          <span className="text-xs text-dim tabular">{costText(box.hourlyCost)}</span>
        )}
        <span className="flex-1" />
        {power.canControl && <StartStop box={box} control={control} busy={busy} run={run} />}
      </div>
      <ControllerLine controller={power.controller} />
      {box.error && <Notice tone="warning">{box.error.message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <BoxRules power={power} control={control} busy={busy} run={run} />
    </section>
  );
}
