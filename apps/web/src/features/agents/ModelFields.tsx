import { AGENT_MAX_CONCURRENT_RUNS, AGENT_MODEL_MAX } from '@mwc/shared/org';
import { type ReactNode, useId } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import { useAccessProfiles } from '../../api/subscriptions.ts';
import type { AgentDetail, AgentProfile } from '../../api/types.ts';
import { Link } from '../../app/router.tsx';
import { ACCESS_PROFILES_PATH } from '../../components/auth/AccountMenu.tsx';
import { ChoiceField, Field, SelectField, TextField } from '../../components/forms/Field.tsx';
import { Input } from '../../components/forms/Input.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { EFFORT_OPTIONS, HARNESS_OPTIONS, MODELS, profileLabel } from '../../components/org/agent-labels.ts';
import { Button } from '../../components/ui/Button.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import type { AgentDraft } from './agent-draft.ts';

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

/** The hint under the profile select: what a profile is, and where the person's own are. */
function ProfileHint({ count, error }: { readonly count: number | undefined; readonly error: unknown }) {
  if (error !== undefined) return friendlyMessage(error);
  const link = (
    <Link to={ACCESS_PROFILES_PATH} className="font-semibold text-blue hover:underline">
      {count === 0 ? 'Make one' : 'Your access profiles'}
    </Link>
  );
  return count === 0 ? (
    <>You have no access profiles yet. {link} to give it your subscription.</>
  ) : (
    <>Which of your subscriptions its runs use. {link}</>
  );
}

/** One of the signed-in person's own profiles, or None. */
function MyProfileSelect({ draft }: { readonly draft: AgentDraft }) {
  const profiles = useAccessProfiles();
  const list = profiles.data?.profiles ?? [];
  const value = draft.values.profileId ?? '';
  const options = [{ value: '', label: 'None' }, ...list.map((p) => ({ value: p.id, label: p.name }))];
  if (value && !list.some((p) => p.id === value)) {
    options.push({
      value,
      label: profiles.data ? 'A profile that no longer exists' : 'Loading your profiles…',
    });
  }
  return (
    <SelectField
      label="Access profile"
      value={value}
      options={options}
      disabled={profiles.loading && profiles.data === undefined}
      onChange={(event) => draft.set('profileId', event.target.value || null)}
      hint={<ProfileHint count={profiles.data?.profiles.length} error={profiles.error} />}
    />
  );
}

/** Someone else's profile: shown with its owner, not changeable here; an admin takes it off with Remove. */
function TheirProfile({
  profile,
  onRemove,
}: {
  readonly profile: AgentProfile;
  readonly onRemove: () => void;
}) {
  const id = useId();
  return (
    <Field label="Access profile" id={id} hint="Only its owner gives it to agents. You can take it off.">
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={profileLabel(profile)}
          readOnly
          aria-describedby={`${id}-hint`}
          className="flex-1"
        />
        <Button tone="quiet" onClick={onRemove}>
          Remove
        </Button>
      </div>
    </Field>
  );
}

interface ProfileProps {
  readonly draft: AgentDraft;
  readonly readOnly: boolean;
  /** The agent being edited; none for a new one. */
  readonly agent?: AgentDetail | undefined;
  readonly meUserId: string;
}

/**
 * Whose subscriptions the agent runs on: an admin picks one of their own access profiles (or None); an agent with
 * someone else's shows it with its owner and a Remove; everyone else reads it.
 */
function ProfileChoice({ draft, readOnly, agent, meUserId }: ProfileProps) {
  const current = agent?.profile;
  if (readOnly) return <TextField label="Access profile" value={profileLabel(current ?? null)} readOnly />;
  if (current && current.ownerUserId !== meUserId && draft.values.profileId === current.id) {
    return <TheirProfile profile={current} onRemove={() => draft.set('profileId', null)} />;
  }
  return <MyProfileSelect draft={draft} />;
}

/**
 * How the agent works: its model, whose subscriptions it runs on, its effort, its harness, its runs at once, and
 * where it runs (`where`, the form's "Where it runs").
 */
export function ModelPanel({ where, ...props }: ProfileProps & { readonly where?: ReactNode }) {
  const { draft, readOnly } = props;
  const { values, set } = draft;
  return (
    <Panel
      title="How it works"
      description="The model behind it, whose subscription it runs on, how hard it thinks, what runs it and where."
    >
      <div className="flex flex-col gap-5">
        <ModelChoice draft={draft} readOnly={readOnly} />
        <div className="grid gap-4 sm:grid-cols-2">
          <ProfileChoice {...props} />
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
              onChange={(harness) => set('harness', harness)}
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
