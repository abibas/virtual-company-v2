import { ArrowLeft, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import { orgCalls } from '../../api/org.ts';
import type { AgentDetail, ChartNode, OrgChart } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { LoadState } from '../data/LoadState.tsx';
import { PageHeader } from '../layout/PageHeader.tsx';
import { nodesById, personNode } from '../org/chart.ts';
import { OrgNodeCard } from '../org/OrgNodeCard.tsx';
import { OrgTree } from '../org/OrgTree.tsx';
import { Button, ButtonLink } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';
import { AgentForm, FormActions } from './AgentForm.tsx';
import { type AgentDraft, newAgentOf, useAgentDraft } from './agent-draft.ts';
import type { AgentLinks } from './links.ts';

export interface HireAgentProps {
  readonly companyId: string;
  readonly chart: Loaded<OrgChart>;
  readonly meUserId: string;
  readonly links: AgentLinks;
  /** Hired: refresh the team and open its page. */
  readonly onHired: (agent: AgentDetail) => void;
}

const PREVIEW = 'preview';

/** The new agent as its card will read, from what the form holds so far. */
function previewNode(draft: AgentDraft): ChartNode {
  const { values } = draft;
  return {
    principalId: PREVIEW,
    kind: 'agent',
    reportsTo: values.reportsTo,
    title: null,
    agent: {
      agentId: PREVIEW,
      name: values.name.trim() || 'New agent',
      slug: draft.slug,
      roleTitle: values.roleTitle.trim() || 'Its role',
      status: 'active',
      face: draft.face,
      model: values.model.trim() || '…',
      effort: values.effort,
    },
  };
}

/** Its place as the chart will show it: its manager's card, and its own card under it, live. */
function ChartPreview({ draft, chart, meUserId }: Omit<HireFormProps, 'companyId' | 'links' | 'onHired'>) {
  const manager = nodesById(chart.nodes).get(draft.values.reportsTo);
  const node = previewNode(draft);
  const leaf = { principalId: PREVIEW, kind: 'agent' as const, orphan: false, children: [] };
  const tree = manager
    ? [{ principalId: manager.principalId, kind: manager.kind, orphan: false, children: [leaf] }]
    : [leaf];
  return (
    <Card as="section" aria-label="On the chart" padding="sm" className="canvas-dots ring-1 ring-line">
      <h2 className="mb-3 text-xs font-semibold text-dim">On the chart</h2>
      <OrgTree
        layout="list"
        label="The new agent's place"
        tree={tree}
        renderNode={(place) =>
          place.principalId === PREVIEW || !manager ? (
            <OrgNodeCard node={node} />
          ) : (
            <OrgNodeCard
              node={manager}
              you={manager.kind === 'person' && manager.person.userId === meUserId}
            />
          )
        }
      />
    </Card>
  );
}

interface HireFormProps {
  readonly companyId: string;
  readonly chart: OrgChart;
  readonly draft: AgentDraft;
  readonly meUserId: string;
  readonly links: AgentLinks;
  readonly onHired: (agent: AgentDetail) => void;
}

/** The form with its live preview and the Hire button: `POST /agents`, then its page. */
function HireForm({ companyId, chart, draft, meUserId, links, onHired }: HireFormProps) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onHired(await orgCalls(api, companyId).hire(newAgentOf(draft)));
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid items-start gap-4 md:gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]"
    >
      <div className="grid min-w-0 gap-4 md:gap-5">
        <AgentForm draft={draft} chart={chart} meUserId={meUserId} />
        <FormActions
          status="It joins the chart at once and works only on the tasks it is given."
          error={error}
        >
          <ButtonLink href={links.chart} tone="quiet">
            Cancel
          </ButtonLink>
          <Button type="submit" tone="primary" icon={UserPlus} busy={busy} disabled={!draft.valid}>
            Hire agent
          </Button>
        </FormActions>
      </div>
      <aside className="sticky top-5 max-lg:hidden">
        <ChartPreview draft={draft} chart={chart} meUserId={meUserId} />
      </aside>
    </form>
  );
}

/** The draft starts under the signed-in person (else the chart's first top), once the chart is known. */
function HireWithChart(props: Omit<HireFormProps, 'draft'>) {
  const me = personNode(props.chart.nodes, props.meUserId);
  const draft = useAgentDraft(undefined, me?.principalId ?? props.chart.tree[0]?.principalId ?? '');
  return <HireForm {...props} draft={draft} />;
}

/** `/agents/new` (admins and owners): hire an agent onto the chart. */
export function HireAgent({ chart, links, ...rest }: HireAgentProps) {
  return (
    <>
      <PageHeader
        title="Hire an agent"
        actions={
          <ButtonLink href={links.chart} tone="quiet" icon={ArrowLeft}>
            Back to agents
          </ButtonLink>
        }
      >
        <p>Give it a name, a job and a face, choose how it works, and place it on the chart.</p>
      </PageHeader>
      <LoadState loaded={chart} label="Loading the chart…">
        {(data) => <HireWithChart chart={data} links={links} {...rest} />}
      </LoadState>
    </>
  );
}
