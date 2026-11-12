import { useState } from 'react';
import { friendlyMessage } from '../../../api/errors.ts';
import type { MachineKind, PowerPolicy } from '../../../api/types.ts';
import { Input } from '../../../components/forms/Input.tsx';
import { Switch } from '../../../components/forms/Switch.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { KeepOnFields } from './KeepOnFields.tsx';

type Flag =
  | 'autoStartAtKeepOn'
  | 'stopAtKeepOnEnd'
  | 'keepMacAwake'
  | 'autoStartOnMessage'
  | 'autoStartOnWork';

interface FlagRow {
  readonly flag: Flag;
  readonly label: string;
  /** Which machines it is for: a devbox, a laptop, or one this server starts (a devbox, a container). */
  readonly for: 'devbox' | 'laptop' | 'started';
}

/** The switches with the hours, then the ones after the hold. */
const WITH_HOURS: readonly FlagRow[] = [
  { flag: 'autoStartAtKeepOn', label: 'Start the box when the hours begin', for: 'devbox' },
  { flag: 'stopAtKeepOnEnd', label: 'Stop the box when the hours end', for: 'devbox' },
];
const AFTER_HOLD: readonly FlagRow[] = [
  { flag: 'keepMacAwake', label: 'Keep This Mac awake while agents work', for: 'laptop' },
  { flag: 'autoStartOnMessage', label: 'Start when you message an agent on it', for: 'started' },
  { flag: 'autoStartOnWork', label: 'Start when an agent on it gets work', for: 'started' },
];

interface Editing {
  readonly policy: PowerPolicy;
  readonly onChange: (change: Partial<PowerPolicy>) => void;
  readonly disabled: boolean;
}

/** The switches of `rows` that fit this machine. */
function FlagSwitches({
  rows,
  kind,
  devbox,
  policy,
  onChange,
  disabled,
}: Editing & {
  readonly rows: readonly FlagRow[];
  readonly kind: MachineKind;
  readonly devbox: boolean;
}) {
  const fits = (row: FlagRow) =>
    row.for === 'devbox'
      ? devbox
      : row.for === 'started'
        ? devbox || kind === 'container'
        : kind === 'laptop';
  return rows.filter(fits).map((row) => (
    <span key={row.flag} className="flex flex-wrap items-center gap-2">
      <Switch
        label={row.label}
        checked={policy[row.flag]}
        disabled={disabled}
        onChange={(on) => onChange({ [row.flag]: on })}
      />
    </span>
  ));
}

/** "Keep it on for N minutes after a chat" (0 to 720). */
function HoldMinutes({ policy, onChange, disabled }: Editing) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-2">
      Keep it on for
      <span className="w-20 shrink-0">
        <Input
          aria-label="Minutes to keep it on after a chat"
          type="number"
          size="sm"
          min={0}
          max={720}
          value={policy.holdAfterTurnMin}
          disabled={disabled}
          onChange={(e) =>
            onChange({
              holdAfterTurnMin: Math.min(720, Math.max(0, Math.round(Number(e.target.value) || 0))),
            })
          }
        />
      </span>
      minutes after a chat
    </span>
  );
}

/** Saves the draft: busy while it goes, the refusal in plain words. */
function useSave(onSave: (policy: PowerPolicy) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async (policy: PowerPolicy) => {
    setBusy(true);
    setError(undefined);
    try {
      await onSave(policy);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, save: (policy: PowerPolicy) => void save(policy) };
}

/** Power settings: admins change and save them (PUT), others read them; a container's say they do not power it. */
export function PowerSettings({
  policy,
  kind,
  devbox,
  canControl,
  onSave,
}: {
  readonly policy: PowerPolicy;
  readonly kind: MachineKind;
  readonly devbox: boolean;
  readonly canControl: boolean;
  readonly onSave: (policy: PowerPolicy) => Promise<void>;
}) {
  const [draft, setDraft] = useState(policy);
  const { busy, error, save } = useSave(onSave);
  const dirty = JSON.stringify(draft) !== JSON.stringify(policy);
  const edit: Editing = {
    policy: draft,
    disabled: !canControl || busy,
    onChange: (change) => setDraft({ ...draft, ...change }),
  };
  return (
    <section aria-label="Power settings" className="flex flex-col gap-3">
      {kind === 'container' && (
        <p className="text-xs text-dim">
          The keep-on hours do not start or stop a container, and its runner has nothing to keep awake.
        </p>
      )}
      <KeepOnFields
        keepOn={draft.keepOn}
        disabled={edit.disabled}
        onChange={(keepOn) => edit.onChange({ keepOn })}
      />
      <FlagSwitches rows={WITH_HOURS} kind={kind} devbox={devbox} {...edit} />
      <HoldMinutes {...edit} />
      <FlagSwitches rows={AFTER_HOLD} kind={kind} devbox={devbox} {...edit} />
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
      {canControl ? (
        <div className="mt-1 flex gap-2">
          <Button size="sm" tone="primary" busy={busy} disabled={!dirty} onClick={() => save(draft)}>
            Save
          </Button>
          {dirty && (
            <Button size="sm" tone="quiet" disabled={busy} onClick={() => setDraft(policy)}>
              Discard
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-dim">Only admins and owners change these.</p>
      )}
    </section>
  );
}
