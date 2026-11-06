import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { MachineKind, PowerPolicy } from '../../api/types.ts';
import { Input } from '../../components/forms/Input.tsx';
import { Switch } from '../../components/forms/Switch.tsx';
import { Badge } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
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
  /** Which machines it is for. */
  readonly for: 'devbox' | 'laptop';
  /** Shown read-only until the stage that uses it. */
  readonly later?: string;
}

/** The switches with the hours, then the ones after the hold. */
const WITH_HOURS: readonly FlagRow[] = [
  { flag: 'autoStartAtKeepOn', label: 'Start the box when the hours begin', for: 'devbox' },
  { flag: 'stopAtKeepOnEnd', label: 'Stop the box when the hours end', for: 'devbox' },
];
const AFTER_HOLD: readonly FlagRow[] = [
  { flag: 'keepMacAwake', label: 'Keep This Mac awake while agents work', for: 'laptop' },
  {
    flag: 'autoStartOnMessage',
    label: 'Start when you message an agent on it',
    for: 'devbox',
    later: 'from S5',
  },
  { flag: 'autoStartOnWork', label: 'Start when an agent on it gets work', for: 'devbox', later: 'from S5' },
];

interface Editing {
  readonly policy: PowerPolicy;
  readonly onChange: (change: Partial<PowerPolicy>) => void;
  readonly disabled: boolean;
}

/** The switches of `rows` that fit this machine, a later one read-only with its note. */
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
  const fits = (row: FlagRow) => (row.for === 'devbox' ? devbox : kind === 'laptop');
  return rows.filter(fits).map((row) => (
    <span key={row.flag} className="flex flex-wrap items-center gap-2">
      <Switch
        label={row.label}
        checked={policy[row.flag]}
        disabled={disabled || row.later !== undefined}
        onChange={(on) => onChange({ [row.flag]: on })}
      />
      {row.later && <Badge size="sm">{row.later}</Badge>}
    </span>
  ));
}

/** "Keep it on for N minutes after a chat" (0 to 720). */
function HoldMinutes({ policy, onChange, disabled }: Editing) {
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-2">
      Keep it on for
      <Input
        aria-label="Minutes to keep it on after a chat"
        type="number"
        size="sm"
        min={0}
        max={720}
        value={policy.holdAfterTurnMin}
        disabled={disabled}
        onChange={(e) =>
          onChange({ holdAfterTurnMin: Math.min(720, Math.max(0, Math.round(Number(e.target.value) || 0))) })
        }
        className="w-20"
      />
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

/** Power settings: admins change and save them (PUT), others read them. */
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
