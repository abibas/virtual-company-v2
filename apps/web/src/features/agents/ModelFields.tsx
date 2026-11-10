import type { Harness } from '@mwc/shared/enums';
import { AGENT_MAX_CONCURRENT_RUNS, AGENT_MODEL_MAX } from '@mwc/shared/org';
import type { ReactNode } from 'react';
import { useAccessProfiles } from '../../api/subscriptions.ts';
import { ChoiceField, SelectField, TextField } from '../../components/forms/Field.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { EFFORT_OPTIONS } from '../../components/org/agent-labels.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import type { AgentDraft } from './agent-draft.ts';
import { modelsOf } from './harness-from-profile.ts';
import { ProfileChoice, type ProfileProps } from './ProfileFields.tsx';

const CUSTOM = 'custom';
const ANOTHER = { value: CUSTOM, label: 'Another model (type its id)' };
/** The models a harness offers: Claude's for Claude Code, Codex's default for Codex; and any id typed in. */
const modelOptions = (harness: Harness) => [...modelsOf(harness), ANOTHER];

/** 1 to 8, as the choices of a segmented control. */
const RUN_OPTIONS: readonly SegmentOption<string>[] = Array.from(
  { length: AGENT_MAX_CONCURRENT_RUNS.max - AGENT_MAX_CONCURRENT_RUNS.min + 1 },
  (_, index) => {
    const runs = String(AGENT_MAX_CONCURRENT_RUNS.min + index);
    return { value: runs, label: runs };
  },
);

/** The model: one of the known ones, or an id typed in. */
function ModelChoice({ draft, readOnly }: { readonly draft: AgentDraft; readonly readOnly: boolean }) {
  const { values, set } = draft;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label="Model"
        value={values.customModel ? CUSTOM : values.model}
        disabled={readOnly}
        onChange={(event) => {
          const custom = event.target.value === CUSTOM;
          set('customModel', custom);
          set('model', custom ? '' : event.target.value);
        }}
        options={modelOptions(values.harness)}
      />
      {values.customModel && (
        <TextField
          label="Model id"
          value={values.model}
          readOnly={readOnly}
          onChange={(event) => set('model', event.target.value)}
          required
          maxLength={AGENT_MODEL_MAX}
          spellCheck={false}
          placeholder={values.harness === 'codex' ? 'gpt-5-codex' : 'claude-opus-5-5'}
        />
      )}
    </div>
  );
}

/**
 * How the agent works, in the order it is decided: how many runs at once, whose subscription it runs on (an access
 * profile, which also decides what runs it: Claude Code for a Claude profile, Codex for an OpenAI one), its model
 * (that harness's), its effort, and where it runs (`where`, the form's "Where it runs"). There is no harness choice:
 * each provider's own harness is the only one today.
 */
export function ModelPanel({ where, ...props }: ProfileProps & { readonly where?: ReactNode }) {
  const { draft, readOnly } = props;
  const { values, set } = draft;
  const profiles = useAccessProfiles();
  return (
    <Panel
      title="How it works"
      description="How many tasks at once, whose subscription it runs on (which also decides what runs it), its model, how hard it thinks, and where."
    >
      <div className="flex flex-col gap-5">
        <ChoiceField label="Runs at once" hint="How many tasks it may work on at the same time.">
          <SegmentedControl
            label="Runs at once"
            size="sm"
            options={RUN_OPTIONS}
            value={String(values.maxConcurrentRuns)}
            onChange={(runs) => set('maxConcurrentRuns', Number(runs))}
            disabled={readOnly}
          />
        </ChoiceField>
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileChoice {...props} profiles={profiles} />
        </div>
        <ModelChoice draft={draft} readOnly={readOnly} />
        <ChoiceField label="Effort" hint="More effort thinks longer and costs more; high suits most work.">
          <SegmentedControl
            label="Effort"
            options={EFFORT_OPTIONS}
            value={values.effort}
            onChange={(effort) => set('effort', effort)}
            disabled={readOnly}
            className="max-w-full overflow-x-auto"
          />
        </ChoiceField>
        {where}
      </div>
    </Panel>
  );
}
