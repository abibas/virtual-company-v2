import { HARNESS_PROVIDER } from '@mwc/shared/credentials';
import type { Harness } from '@mwc/shared/enums';
import { AGENT_MAX_CONCURRENT_RUNS } from '@mwc/shared/org';
import type { ReactNode } from 'react';
import type { AccessProfile, AgentDetail } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { ChoiceField } from '../../components/forms/Field.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { HARNESS_OPTIONS, hasPartFor, missingPart, profileLine } from '../../components/org/agent-labels.ts';
import { Panel } from '../../components/ui/Panel.tsx';
import type { AgentDraft } from './agent-draft.ts';
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

/**
 * The chosen profile's parts in one quiet line under it (`profileLine`: "Claude · Opus 5.5 · High · GitHub: push, PRs ·
 * AiriaLLC/* · Atlassian: Jira read (AP) · Confluence write"), or "No Claude part" when it lacks the part the harness
 * runs on: one of the person's own, or the agent's (someone else's, as the agent shows it); nothing for none or while it
 * is not known yet.
 */
function ProfileNote({
  draft,
  mine,
  agent,
}: {
  readonly draft: AgentDraft;
  readonly mine: readonly AccessProfile[] | undefined;
  readonly agent: AgentDetail | undefined;
}) {
  const { profileId, harness } = draft.values;
  const own = mine?.find((profile) => profile.id === profileId);
  const shown = own ?? (agent?.profile && agent.profile.id === profileId ? agent.profile : undefined);
  if (profileId === null || shown === undefined) return null;
  const fits = hasPartFor(shown, harness);
  const line = fits ? profileLine(shown) : missingPart(harness);
  return (
    <p className={`-mt-3 truncate text-xs ${fits ? 'text-dim' : 'font-medium text-failed'}`} title={line}>
      {line}
    </p>
  );
}

/**
 * A harness change: the new harness, and on the Hire page the hirer's default for it when the profile chosen is the old
 * harness's default (or none).
 */
function changeHarness(draft: AgentDraft, harness: Harness) {
  const { values, profileDefaults } = draft;
  draft.set('harness', harness);
  if (profileDefaults === undefined) return;
  const before = profileDefaults[HARNESS_PROVIDER[values.harness]];
  if (values.profileId === null || values.profileId === before) {
    draft.set('profileId', profileDefaults[HARNESS_PROVIDER[harness]]);
  }
}

/**
 * How the agent works, in the order it is decided: what runs it (Claude Code or Codex), how many runs at once, the
 * profile it runs on (its part for the harness decides the model and effort; its tool parts its GitHub and Atlassian
 * access; said in a line under it), and where it runs (`where`, the form's "Where it runs"); `profileNote` under the
 * profile says when that harness's CLI is missing on the chosen machine. There is no model or effort choice here: the
 * profile holds them.
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
          <ChoiceField label="Harness">
            <SegmentedControl
              label="Harness"
              size="sm"
              options={HARNESS_OPTIONS}
              value={values.harness}
              onChange={(harness) => changeHarness(draft, harness)}
              disabled={readOnly}
            />
          </ChoiceField>
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
        <ProfileChoice {...props} profiles={profiles} />
        {profileNote}
        <ProfileNote draft={draft} mine={profiles.data?.profiles} agent={agent} />
        {where}
      </div>
    </Panel>
  );
}
