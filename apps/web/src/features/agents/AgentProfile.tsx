import { ArrowLeft, Save } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { type AgentIconCalls, agentIconCalls } from '../../api/agent-icon.ts';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import {
  type OrgCalls,
  orgCalls,
  type PlacementCalls,
  placementCalls,
  useAgentPlacement,
} from '../../api/org.ts';
import { useAccessProfiles } from '../../api/subscriptions.ts';
import type { AgentDetail, OrgChart } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { nodesById } from '../../components/org/chart.ts';
import { Button, ButtonLink } from '../../components/ui/Button.tsx';
import { HarnessToolWarning } from '../machines/tools/ToolWarning.tsx';
import {
  type PlacementDraft,
  type PlacementStep,
  placementStep,
  usePlacementDraft,
} from '../placements/placement-draft.ts';
import { WhereItRuns } from '../placements/WhereItRuns.tsx';
import { AgentForm, FormActions } from './AgentForm.tsx';
import { AgentHeader } from './AgentHeader.tsx';
import { type AgentDraft, changesOf, useAgentDraft } from './agent-draft.ts';
import { iconKey, iconStep, saveIcon } from './icon-draft.ts';
import type { AgentLinks } from './links.ts';

export interface AgentProfileProps {
  readonly companyId: string;
  readonly agent: Loaded<AgentDetail>;
  readonly chart: Loaded<OrgChart>;
  /** Admins and owners change the agent; everyone else sees it read-only. */
  readonly admin: boolean;
  readonly meUserId: string;
  readonly links: AgentLinks;
  /** The agent changed (its fields, its place or its status): read it, the chart and the team again. */
  readonly onChanged: (agent: AgentDetail) => void;
}

/** Saves where the agent runs, when it changed: `PUT` or `DELETE` of its placement. */
async function savePlacement(calls: PlacementCalls, agentId: string, step: PlacementStep) {
  if (step.kind === 'put') await calls.set(agentId, step.change);
  if (step.kind === 'delete') await calls.remove(agentId);
}

interface SaveCalls {
  readonly org: OrgCalls;
  readonly placements: PlacementCalls;
  readonly icons: AgentIconCalls;
}

/**
 * What Save would send: the changed fields (`PATCH`), a new manager (`PUT` of its place), where it runs (its
 * placement) and its icon, in turn.
 */
function useSaveAgent(
  agent: AgentDetail,
  drafts: { readonly draft: AgentDraft; readonly placement: PlacementDraft },
  calls: SaveCalls,
  onChanged: (a: AgentDetail) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const changes = changesOf(drafts.draft, agent);
  const manager = drafts.draft.values.reportsTo;
  const move = agent.status !== 'archived' && manager !== (agent.reportsTo ?? '');
  const step = placementStep(drafts.placement);
  const icon = iconStep(drafts.draft.values.icon, agent);
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const saved = Object.keys(changes).length > 0 ? await calls.org.update(agent.id, changes) : agent;
      if (move) await calls.org.place(agent.principalId, { reportsToPrincipalId: manager });
      await savePlacement(calls.placements, agent.id, step);
      await saveIcon(calls.icons, agent.id, icon);
      onChanged(saved);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  const dirty = Object.keys(changes).length > 0 || move || step.kind !== 'none' || icon.kind !== 'none';
  return { busy, error, dirty, save };
}

/**
 * The agent's form on its page: the agent's draft and where it runs (loaded, then drafted), and Save (`useSaveAgent`),
 * which reads the placement again after it.
 */
function useProfileForm(agent: AgentDetail, companyId: string, onChanged: (a: AgentDetail) => void) {
  const api = useApi();
  const org = useMemo(() => orgCalls(api, companyId), [api, companyId]);
  const placements = useMemo(() => placementCalls(api, companyId), [api, companyId]);
  const icons = useMemo(() => agentIconCalls(api, companyId), [api, companyId]);
  const draft = useAgentDraft(agent, '');
  const saved = useAgentPlacement(companyId, agent.id);
  const placement = usePlacementDraft(saved.data);
  const changed = (a: AgentDetail) => {
    saved.reload();
    onChanged(a);
  };
  const saving = useSaveAgent(agent, { draft, placement }, { org, placements, icons }, changed);
  const discard = () => {
    draft.reset();
    placement.reset();
  };
  return { org, draft, placement, discard, valid: draft.valid && placement.valid, ...saving };
}

type ProfileForm = ReturnType<typeof useProfileForm>;

/** Discard and Save, with where the form stands or the last refusal. */
function ProfileActions({ form }: { readonly form: ProfileForm }) {
  const { dirty, busy } = form;
  return (
    <FormActions status={dirty ? 'Unsaved changes.' : 'Everything is saved.'} error={form.error}>
      <Button tone="quiet" disabled={!dirty || busy} onClick={form.discard}>
        Discard
      </Button>
      <Button type="submit" tone="primary" icon={Save} busy={busy} disabled={!dirty || !form.valid}>
        Save changes
      </Button>
    </FormActions>
  );
}

/** "Where it runs" on the form's placement draft, and the note under the access profile about its harness's CLI there. */
function placementParts(
  form: ProfileForm,
  at: {
    readonly companyId: string;
    readonly machinesHref: string;
    readonly admin: boolean;
    readonly slug: string;
  },
) {
  const { companyId, machinesHref } = at;
  return {
    where: (
      <WhereItRuns
        draft={form.placement}
        companyId={companyId}
        machinesHref={machinesHref}
        readOnly={!at.admin}
        agentSlug={at.slug}
      />
    ),
    profileNote: (
      <HarnessToolWarning
        companyId={companyId}
        machineId={form.placement.values.machineId}
        harness={form.draft.values.harness}
        machinesHref={machinesHref}
      />
    ),
  };
}

/** The loaded agent: its header with the status actions, then its fields, editable for admins. */
function ProfileBody({
  agent,
  companyId,
  chart,
  admin,
  meUserId,
  onChanged,
  machinesHref,
  chatsHref,
}: Omit<AgentProfileProps, 'agent' | 'links'> & {
  readonly agent: AgentDetail;
  readonly machinesHref: string;
  readonly chatsHref: string;
}) {
  const form = useProfileForm(agent, companyId, onChanged);
  const profiles = useAccessProfiles();
  const manager = agent.reportsTo ? nodesById(chart.data?.nodes ?? []).get(agent.reportsTo) : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void form.save();
  };
  const parts = placementParts(form, { companyId, machinesHref, admin, slug: agent.slug });
  return (
    <div className="grid gap-4 md:gap-5">
      <AgentHeader
        agent={agent}
        manager={manager}
        admin={admin}
        chatsHref={chatsHref}
        calls={form.org}
        onChanged={onChanged}
      />
      <form onSubmit={submit} className="grid gap-4 md:gap-5">
        <AgentForm
          draft={form.draft}
          {...parts}
          chart={chart.data}
          agent={agent}
          meUserId={meUserId}
          readOnly={!admin}
          profiles={profiles}
        />
        {admin && <ProfileActions form={form} />}
      </form>
    </div>
  );
}

/** A new manager (a move saved, an archive, a restore) or a new icon starts the form again from the saved agent. */
const formKey = (agent: AgentDetail) => `${agent.id}:${agent.reportsTo ?? ''}:${iconKey(agent)}`;

/** An agent's page: back to the agents, then the agent (or why it cannot be shown). */
export function AgentProfile({ agent, links, ...rest }: AgentProfileProps) {
  return (
    <>
      <ButtonLink href={links.list} tone="quiet" size="sm" icon={ArrowLeft} className="mb-3 -ml-2">
        Agents
      </ButtonLink>
      <LoadState loaded={agent} label="Loading the agent…">
        {(data) => (
          <ProfileBody
            key={formKey(data)}
            agent={data}
            machinesHref={links.machines}
            chatsHref={links.chats(data)}
            {...rest}
          />
        )}
      </LoadState>
    </>
  );
}
