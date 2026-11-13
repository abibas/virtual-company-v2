import { AGENT_MAX_CONCURRENT_RUNS } from '@mwc/shared/org';
import type { ReactNode } from 'react';
import type { AccessProfile, AgentDetail } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { ChoiceField } from '../../components/forms/Field.tsx';
import { SegmentedControl, type SegmentOption } from '../../components/forms/Segmented.tsx';
import { profileLine } from '../../components/org/agent-labels.ts';
import { Panel } from '../../components/ui/Panel.tsx';
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
 * The chosen profile's parts in one quiet line under it ("Claude · ihor@airia.ai · GitHub: push, PRs · AiriaLLC/* ·
 * Atlassian: Jira read · Confluence write", `profileLine`): one of the person's own, or the agent's (someone else's, as
 * the agent shows it); nothing for none or while it is not known yet.
 */
function ProfileNote({
  profileId,
  mine,
  agent,
}: {
  readonly profileId: string | null;
  readonly mine: readonly AccessProfile[] | undefined;
  readonly agent: AgentDetail | undefined;
}) {
  const own = mine?.find((profile) => profile.id === profileId);
  const theirs = agent?.profile && agent.profile.id === profileId ? agent.profile : undefined;
  const line = own ? profileLine(own, own) : theirs ? profileLine(theirs, agent?.runsWith ?? null) : null;
  if (profileId === null || line === null) return null;
  return (
    <p className="-mt-3 truncate text-xs text-dim" title={line}>
      {line}
    </p>
  );
}

/**
 * How the agent works, in the order it is decided: how many runs at once, whose subscription it runs on (an access
 * profile, which also decides what runs it, Claude Code for a Claude profile and Codex for an OpenAI one, its model and
 * effort, and its GitHub and Atlassian access, said in a line under it), and where it runs (`where`, the form's "Where it runs"); `profileNote` under the
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
        <ProfileNote profileId={values.profileId} mine={profiles.data?.profiles} agent={agent} />
        {where}
      </div>
    </Panel>
  );
}
