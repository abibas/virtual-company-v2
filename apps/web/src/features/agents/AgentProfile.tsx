import { ArrowLeft, Save } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import { type OrgCalls, orgCalls } from '../../api/org.ts';
import type { AgentDetail, OrgChart } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { nodesById } from '../../components/org/chart.ts';
import { Button, ButtonLink } from '../../components/ui/Button.tsx';
import { AgentForm, FormActions } from './AgentForm.tsx';
import { AgentHeader } from './AgentHeader.tsx';
import { type AgentDraft, changesOf, useAgentDraft } from './agent-draft.ts';
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

/** What Save would send: the changed fields (`PATCH`) and a new manager (`PUT` of its place), then both in turn. */
function useSaveAgent(
  agent: AgentDetail,
  draft: AgentDraft,
  calls: OrgCalls,
  onChanged: (a: AgentDetail) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const changes = changesOf(draft, agent);
  const manager = draft.values.reportsTo;
  const move = agent.status !== 'archived' && manager !== (agent.reportsTo ?? '');
  const save = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const saved = Object.keys(changes).length > 0 ? await calls.update(agent.id, changes) : agent;
      if (move) await calls.place(agent.principalId, { reportsToPrincipalId: manager });
      onChanged(saved);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, dirty: Object.keys(changes).length > 0 || move, save };
}

/** The loaded agent: its header with the status actions, then its fields, editable for admins. */
function ProfileBody({
  agent,
  companyId,
  chart,
  admin,
  meUserId,
  onChanged,
}: Omit<AgentProfileProps, 'agent' | 'links'> & { readonly agent: AgentDetail }) {
  const api = useApi();
  const calls = useMemo(() => orgCalls(api, companyId), [api, companyId]);
  const draft = useAgentDraft(agent, '');
  const { busy, error, dirty, save } = useSaveAgent(agent, draft, calls, onChanged);
  const manager = agent.reportsTo ? nodesById(chart.data?.nodes ?? []).get(agent.reportsTo) : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void save();
  };
  return (
    <div className="grid gap-4 md:gap-5">
      <AgentHeader agent={agent} manager={manager} admin={admin} calls={calls} onChanged={onChanged} />
      <form onSubmit={submit} className="grid gap-4 md:gap-5">
        <AgentForm draft={draft} chart={chart.data} agent={agent} meUserId={meUserId} readOnly={!admin} />
        {admin && (
          <FormActions status={dirty ? 'Unsaved changes.' : 'Everything is saved.'} error={error}>
            <Button tone="quiet" disabled={!dirty || busy} onClick={draft.reset}>
              Discard
            </Button>
            <Button type="submit" tone="primary" icon={Save} busy={busy} disabled={!dirty || !draft.valid}>
              Save changes
            </Button>
          </FormActions>
        )}
      </form>
    </div>
  );
}

/** A new manager (a move saved, an archive, a restore) starts the form again from the saved agent. */
const formKey = (agent: AgentDetail) => `${agent.id}:${agent.reportsTo ?? ''}`;

/** An agent's page: back to the agents, then the agent (or why it cannot be shown). */
export function AgentProfile({ agent, links, ...rest }: AgentProfileProps) {
  return (
    <>
      <ButtonLink href={links.chart} tone="quiet" size="sm" icon={ArrowLeft} className="mb-3 -ml-2">
        Agents
      </ButtonLink>
      <LoadState loaded={agent} label="Loading the agent…">
        {(data) => <ProfileBody key={formKey(data)} agent={data} {...rest} />}
      </LoadState>
    </>
  );
}
