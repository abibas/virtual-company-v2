import type { AiProvider, Effort } from '@mwc/shared/enums';
import {
  catalogueModel,
  effortsOf,
  MODEL_CATALOGUE,
  MODEL_ID_MAX,
  MODEL_ID_PATTERN,
} from '@mwc/shared/models';
import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { ChoiceField, SelectField, TextField } from '../../components/forms/Field.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { defaultModelLabel, EFFORT_HINTS, effortOptions } from '../../components/org/agent-labels.ts';

/** What a profile runs: a model and an effort, each null for the provider's default. */
export interface Runs {
  readonly model: string | null;
  readonly effort: Effort | null;
}

const DEFAULT_MODEL = '';
const ANOTHER = 'another';
const DEFAULT_EFFORT = 'default';

/** The model's choices: the provider's default, its models by name, and another id typed in. */
const modelOptions = (provider: AiProvider) => [
  { value: DEFAULT_MODEL, label: defaultModelLabel(provider) },
  ...MODEL_CATALOGUE[provider].map((model) => ({ value: model.id, label: model.label })),
  { value: ANOTHER, label: 'Another model (type its id)' },
];

/** The change a new model makes: the model, and the effort back to the default when the new model does not take it. */
export function withModel(provider: AiProvider, runs: Runs, model: string | null): Partial<Runs> {
  const keeps = runs.effort === null || effortsOf(provider, model).includes(runs.effort);
  return keeps ? { model } : { model, effort: null };
}

/** The harness each provider's profiles run, as the hints name it. */
const HARNESS_NAMES: Readonly<Record<AiProvider, string>> = { claude: 'Claude Code', openai: 'Codex' };

/** The effort's hint: what the chosen level does, or who decides by default. */
function effortHint(provider: AiProvider, effort: Effort | null): string {
  if (effort !== null) return EFFORT_HINTS[effort];
  return `${HARNESS_NAMES[provider]} picks its own. More effort thinks longer and costs more.`;
}

interface RunsFieldsProps {
  readonly provider: AiProvider;
  readonly runs: Runs;
  /** A change of the model or the effort (both when a new model does not take the effort); a refusal shows here. */
  readonly onChange: (change: Partial<Runs>) => unknown;
  /** Every keystroke of a typed model is a change (a form saved later), not only on leaving the field. */
  readonly live?: boolean;
}

/** A typed model id, once it looks like one; null for an empty field (the provider's default). */
const typedModel = (text: string): string | null | undefined => {
  const id = text.trim();
  if (id === '') return null;
  return id.length <= MODEL_ID_MAX && MODEL_ID_PATTERN.test(id) ? id : undefined;
};

/** A change sent out, with its busy state and the refusal it met, in plain words. */
function useRunsChange(onChange: RunsFieldsProps['onChange']) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const change = async (next: Partial<Runs>) => {
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
  return { busy, error, setError, change };
}

/** The id of another model, sent when the field is left or Enter is pressed (`commit`), or at each key when `live`. */
function ModelIdField({
  provider,
  typed,
  live,
  onType,
  commit,
}: {
  readonly provider: AiProvider;
  readonly typed: string;
  readonly live: boolean;
  readonly onType: (text: string) => void;
  readonly commit: () => void;
}) {
  return (
    <TextField
      label="Model id"
      value={typed}
      required={!live}
      maxLength={MODEL_ID_MAX}
      spellCheck={false}
      placeholder={provider === 'openai' ? 'gpt-6.1-sol' : 'claude-opus-5-5'}
      onChange={(event) => onType(event.target.value)}
      onBlur={() => {
        if (!live) commit();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || live) return;
        event.preventDefault();
        commit();
      }}
    />
  );
}

/** The effort: the default, or one of the levels the model (else the provider) takes, with what it does. */
function EffortChoice({
  provider,
  runs,
  busy,
  onPick,
}: {
  readonly provider: AiProvider;
  readonly runs: Runs;
  readonly busy: boolean;
  readonly onPick: (effort: Effort | null) => void;
}) {
  const options: readonly SegmentOption<Effort | typeof DEFAULT_EFFORT>[] = [
    { value: DEFAULT_EFFORT, label: 'Default' },
    ...effortOptions(provider, runs.model),
  ];
  return (
    <ChoiceField label="Effort" hint={effortHint(provider, runs.effort)} className="sm:col-span-2">
      <SegmentedControl
        label="Effort"
        size="sm"
        options={options}
        value={runs.effort ?? DEFAULT_EFFORT}
        onChange={(effort) => onPick(effort === DEFAULT_EFFORT ? null : effort)}
        disabled={busy}
        className="max-w-full overflow-x-auto"
      />
    </ChoiceField>
  );
}

/**
 * A profile's Model (the provider's models, "<Provider>'s default", or another id typed in) and Effort (the levels the
 * model takes, or the default, with a short hint). A change goes out at once (a typed id when the field is left or
 * Enter is pressed, unless `live`); a refusal of it shows under the model.
 */
export function RunsFields({ provider, runs, onChange, live = false }: RunsFieldsProps) {
  const known = runs.model === null || catalogueModel(runs.model, provider) !== undefined;
  const [typing, setTyping] = useState(!known);
  const [typed, setTyped] = useState(known ? '' : (runs.model ?? ''));
  const { busy, error, setError, change } = useRunsChange(onChange);
  const commit = () => {
    const model = typedModel(typed);
    if (model === undefined) setError('A model id is one word of letters, digits and ._:/@[]-');
    else if (model !== runs.model) void change(withModel(provider, runs, model));
  };
  const pick = (value: string) => {
    setTyping(value === ANOTHER);
    if (value === ANOTHER) return;
    setTyped('');
    void change(withModel(provider, runs, value === DEFAULT_MODEL ? null : value));
  };
  const type = (text: string) => {
    setTyped(text);
    if (live) void onChange({ model: text.trim() || null });
  };
  return (
    <>
      <SelectField
        label="Model"
        value={typing ? ANOTHER : (runs.model ?? DEFAULT_MODEL)}
        options={modelOptions(provider)}
        disabled={busy}
        error={error}
        onChange={(event) => pick(event.target.value)}
        hint={`What ${HARNESS_NAMES[provider]} runs for its agents`}
      />
      {typing && <ModelIdField provider={provider} typed={typed} live={live} onType={type} commit={commit} />}
      <EffortChoice
        provider={provider}
        runs={runs}
        busy={busy}
        onPick={(effort) => void change({ effort })}
      />
    </>
  );
}
