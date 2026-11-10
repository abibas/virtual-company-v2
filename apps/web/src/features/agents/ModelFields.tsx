import type { Harness } from '@mwc/shared/enums';
import { AGENT_MAX_CONCURRENT_RUNS, AGENT_MODEL_MAX } from '@mwc/shared/org';
import type { ReactNode } from 'react';
import { useAccessProfiles } from '../../api/subscriptions.ts';
import { ChoiceField, SelectField, TextField } from '../../components/forms/Field.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { EFFORT_OPTIONS, HARNESS_OPTIONS, MODELS } from '../../components/org/agent-labels.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import type { AgentDraft } from './agent-draft.ts';
import { ProfileChoice, type ProfileProps, profileForHarness } from './ProfileFields.tsx';

const CUSTOM = 'custom';
const MODEL_OPTIONS = [...MODELS, { value: CUSTOM, label: 'Another model (type its id)' }];

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
        options={MODEL_OPTIONS}
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
          placeholder="claude-opus-5-5"
        />
      )}
    </div>
  );
}

/**
 * How the agent works: its model, whose subscription it runs on (an access profile of the provider its harness runs
 * on), its effort, its harness, its runs at once, and where it runs (`where`, the form's "Where it runs"). Changing the
 * harness changes a profile of the other provider for the hirer's default of the new one (the draft's
 * `profileDefaults`, when hiring), or none.
 */
export function ModelPanel({ where, ...props }: ProfileProps & { readonly where?: ReactNode }) {
  const { draft, readOnly, agent } = props;
  const { values, set } = draft;
  const profiles = useAccessProfiles();
  const changeHarness = (harness: Harness) => {
    set('harness', harness);
    const mine = profiles.data?.profiles ?? [];
    set('profileId', profileForHarness(harness, values.profileId, { mine, agent }, draft.profileDefaults));
  };
  return (
    <Panel
      title="How it works"
      description="The model behind it, whose subscription it runs on, how hard it thinks, what runs it and where."
    >
      <div className="flex flex-col gap-5">
        <ModelChoice draft={draft} readOnly={readOnly} />
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileChoice {...props} profiles={profiles} />
        </div>
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
        <div className="flex flex-wrap gap-x-8 gap-y-5">
          <ChoiceField label="Harness" hint="What runs it on a machine. Codex comes later.">
            <SegmentedControl
              label="Harness"
              options={HARNESS_OPTIONS}
              value={values.harness}
              onChange={changeHarness}
              disabled={readOnly}
            />
          </ChoiceField>
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
        </div>
        {where}
      </div>
    </Panel>
  );
}
