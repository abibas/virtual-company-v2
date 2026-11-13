import type { PermissionMode, ProfileProvider } from '@mwc/shared/enums';
import { MODES } from '@mwc/shared/modes';
import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { ChoiceField } from '../../components/forms/Field.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';

/** A part's modes as segments: Claude Code's five or Codex's three, by their labels. */
const modeOptions = (provider: ProfileProvider): readonly SegmentOption<PermissionMode>[] =>
  MODES[provider].map((mode) => ({ value: mode.id, label: mode.label }));

/**
 * An AI part's **Mode** (2026-11-13, docs/subscriptions.md "Mode"): whether its turns ask before a tool, saved as it
 * changes; a refusal shows under it.
 */
export function ModeField({
  provider,
  mode,
  onChange,
}: {
  readonly provider: ProfileProvider;
  readonly mode: PermissionMode;
  readonly onChange: (mode: PermissionMode) => unknown;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pick = async (next: PermissionMode) => {
    setBusy(true);
    setError(undefined);
    try {
      await onChange(next);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ChoiceField label="Mode" className="sm:col-span-2">
      <SegmentedControl
        label="Mode"
        size="sm"
        options={modeOptions(provider)}
        value={mode}
        onChange={(next) => void pick(next)}
        disabled={busy}
        className="max-w-full overflow-x-auto"
      />
      {error && (
        <p role="alert" className="text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </ChoiceField>
  );
}
