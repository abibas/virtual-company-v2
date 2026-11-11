import { AGENT_MAX_CONCURRENT_RUNS } from '@mwc/shared/org';
import type { ReactNode } from 'react';
import type { AccessProfile } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { ChoiceField } from '../../components/forms/Field.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { effortLabel, type RunsWith, runsModelLabel } from '../../components/org/agent-labels.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import { runsOf } from './harness-from-profile.ts';
import { ProfileChoice, type ProfileProps } from './ProfileFields.tsx';

/** The person's own access profiles, as the page loads them once (`useAccessProfiles`). */
export type OwnProfiles = Loaded<{ readonly profiles: readonly AccessProfile[] }>;

/** 1 to 8, as the choices of a segmented control. */
const RUN_OPTIONS: readonly SegmentOption<string>[] = Array.from(
  { length: AGENT_MAX_CONCURRENT_RUNS.max - AGENT_MAX_CONCURRENT_RUNS.min + 1 },
  (_, index) => {
    const runs = String(AGENT_MAX_CONCURRENT_RUNS.min + index);
    return { value: runs, label: runs };
  },
);

/** "Runs Opus 5.5 at high effort": what the chosen profile runs, in a quiet line under it (nothing while unknown). */
function RunsNote({ runs }: { readonly runs: RunsWith | null | undefined }) {
  if (!runs) return null;
  const model = runs.model === null ? `${runsModelLabel(runs)} model` : runsModelLabel(runs);
  const effort =
    runs.effort === null ? 'its default effort' : `${effortLabel(runs.effort).toLowerCase()} effort`;
  return (
    <p className="-mt-3 text-xs text-dim">
      Runs {model} at {effort}.
    </p>
  );
}

/**
 * How the agent works, in the order it is decided: how many runs at once, whose subscription it runs on (an access
 * profile, which also decides what runs it, Claude Code for a Claude profile and Codex for an OpenAI one, and its model
 * and effort, said in a line under it), and where it runs (`where`, the form's "Where it runs"); `profileNote` under the
 * profile says when that harness's CLI is missing on the chosen machine. There is no harness, model or effort choice
 * here: the profile holds them.
 */
export function ModelPanel({
  where,
  profileNote,
  profiles,
  ...props
}: ProfileProps & {
  readonly where?: ReactNode;
  readonly profileNote?: ReactNode;
  readonly profiles: OwnProfiles;
}) {
  const { draft, readOnly, agent } = props;
  const { values, set } = draft;
  return (
    <Panel title="How it works">
      <div className="flex flex-col gap-5">
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <ProfileChoice {...props} profiles={profiles} />
          <ChoiceField label="Runs at once">
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
        {profileNote}
        <RunsNote runs={runsOf(values.profileId, profiles.data?.profiles, agent)} />
        {where}
      </div>
    </Panel>
  );
}
