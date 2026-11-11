import { ArrowLeft, UserPlus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { agentIconCalls } from '../../api/agent-icon.ts';
import { useApi } from '../../api/context.ts';
import { friendlyMessage } from '../../api/errors.ts';
import { orgCalls, placementCalls } from '../../api/org.ts';
import { useAccessProfiles } from '../../api/subscriptions.ts';
import type { AgentDetail, ChartNode, OrgChart } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { useCompany } from '../../app/company.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import { PageHeader } from '../../components/layout/PageHeader.tsx';
import type { RunsWith } from '../../components/org/agent-labels.ts';
import { nodesById, personNode } from '../../components/org/chart.ts';
import { OrgNodeCard } from '../../components/org/OrgNodeCard.tsx';
import { OrgTree } from '../../components/org/OrgTree.tsx';
import { Button, ButtonLink } from '../../components/ui/Button.tsx';
import { Card } from '../../components/ui/Card.tsx';
import { HarnessToolWarning } from '../machines/tools/ToolWarning.tsx';
import { type PlacementDraft, placementStep, usePlacementDraft } from '../placements/placement-draft.ts';
import { WhereItRuns } from '../placements/WhereItRuns.tsx';
import { AgentForm, FormActions } from './AgentForm.tsx';
import { type AgentDraft, newAgentOf, type ProfileDefaults, useAgentDraft } from './agent-draft.ts';
import { previewBriefing } from './CompanyBriefing.tsx';
import { runsOf } from './harness-from-profile.ts';
import { saveNewIcon } from './icon-draft.ts';
import type { AgentLinks } from './links.ts';

export interface HireAgentProps {
  readonly companyId: string;
  readonly chart: Loaded<OrgChart>;
  readonly meUserId: string;
  readonly links: AgentLinks;
  /**
   * The hirer's default access profile of each provider in the company: the form starts with the one of its harness's
   * provider, and a harness change takes the other's; none by default.
   */
  readonly defaults?: ProfileDefaults | undefined;
  /** Hired: refresh the team and open its page. */
  readonly onHired: (agent: AgentDetail) => void;
  /** The manager chosen before the form opened (the chart's "Hire an agent reporting to …"), when on the chart. */
  readonly reportsTo?: string | null | undefined;
}

const PREVIEW = 'preview';

/** The new agent as its card will read, from what the form holds so far and what its profile runs. */
function previewNode(draft: AgentDraft, runsWith: RunsWith | null): ChartNode {
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
      harness: values.harness,
      face: draft.face,
      icon: values.icon.kind === 'emoji' && values.icon.emoji ? values.icon : { kind: 'face' },
      profile: null,
      runsWith,
      placement: null,
    },
  };
}

/** Its place as the chart will show it: its manager's card, and its own card under it, live. */
function ChartPreview({
  draft,
  chart,
  meUserId,
  runsWith,
}: Omit<HireFormProps, 'companyId' | 'links' | 'onHired' | 'placement'> & {
  readonly runsWith: RunsWith | null;
}) {
  const manager = nodesById(chart.nodes).get(draft.values.reportsTo);
  const node = previewNode(draft, runsWith);
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
  readonly placement: PlacementDraft;
  readonly meUserId: string;
  readonly links: AgentLinks;
  readonly onHired: (agent: AgentDetail) => void;
}

/**
 * Hiring: `POST /agents`, then where it runs (`PUT` of its placement, when a machine is chosen) and its icon, then
 * `onHired`; a refusal of the hire shows in the form.
 */
function useHire(companyId: string, drafts: Pick<HireFormProps, 'draft' | 'placement' | 'onHired'>) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const agent = await orgCalls(api, companyId).hire(newAgentOf(drafts.draft));
      const step = placementStep(drafts.placement);
      // Hired already: a placement refused here is chosen again on its page, which then shows it nowhere.
      if (step.kind === 'put') {
        await placementCalls(api, companyId)
          .set(agent.id, step.change)
          .catch(() => undefined);
      }
      await saveNewIcon(agentIconCalls(api, companyId), agent.id, drafts.draft.values.icon);
      drafts.onHired(agent);
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

/** The form with its live preview and the Hire button. */
function HireForm({ companyId, chart, draft, placement, meUserId, links, onHired }: HireFormProps) {
  const { busy, error, submit } = useHire(companyId, { draft, placement, onHired });
  const profiles = useAccessProfiles();
  const runsWith = runsOf(draft.values.profileId, profiles.data?.profiles) ?? null;
  const company = useCompany().membership.name;
  const where = (
    <WhereItRuns
      draft={placement}
      companyId={companyId}
      machinesHref={links.machines}
      readOnly={false}
      agentSlug={draft.slug}
    />
  );
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid items-start gap-4 md:gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]"
    >
      <div className="grid min-w-0 gap-4 md:gap-5">
        <AgentForm
          draft={draft}
          where={where}
          profileNote={
            <HarnessToolWarning
              companyId={companyId}
              machineId={placement.values.machineId}
              harness={draft.values.harness}
              machinesHref={links.machines}
            />
          }
          chart={chart}
          meUserId={meUserId}
          profiles={profiles}
          briefing={previewBriefing(company, chart.nodes, previewNode(draft, runsWith))}
        />
        <FormActions status="" error={error}>
          <ButtonLink href={links.chart} tone="quiet">
            Cancel
          </ButtonLink>
          <Button
            type="submit"
            tone="primary"
            icon={UserPlus}
            busy={busy}
            disabled={!draft.valid || !placement.valid}
          >
            Hire agent
          </Button>
        </FormActions>
      </div>
      <aside className="sticky top-5 max-lg:hidden">
        <ChartPreview draft={draft} chart={chart} meUserId={meUserId} runsWith={runsWith} />
      </aside>
    </form>
  );
}

/**
 * The draft starts under the manager chosen on the chart, else the signed-in person, else the chart's first top, with
 * the hirer's default access profile of its harness's provider, once the chart is known.
 */
function HireWithChart({
  defaults,
  chosen,
  ...props
}: Omit<HireFormProps, 'draft' | 'placement'> & {
  readonly defaults: ProfileDefaults;
  readonly chosen: string | null | undefined;
}) {
  const me = personNode(props.chart.nodes, props.meUserId);
  const picked = props.chart.nodes.find((node) => node.principalId === chosen);
  const reportsTo = picked?.principalId ?? me?.principalId ?? props.chart.tree[0]?.principalId ?? '';
  const draft = useAgentDraft(undefined, reportsTo, defaults);
  const placement = usePlacementDraft(null);
  return <HireForm {...props} draft={draft} placement={placement} />;
}

const NO_DEFAULTS: ProfileDefaults = { claude: null, openai: null };

/** `/agents/new` (admins and owners): hire an agent onto the chart. */
export function HireAgent({ chart, links, defaults = NO_DEFAULTS, reportsTo, ...rest }: HireAgentProps) {
  return (
    <>
      <PageHeader
        title="Hire an agent"
        actions={
          <ButtonLink href={links.list} tone="quiet" icon={ArrowLeft}>
            Back to agents
          </ButtonLink>
        }
      ></PageHeader>
      <LoadState loaded={chart} label="Loading the chart…">
        {(data) => (
          <HireWithChart chart={data} links={links} defaults={defaults} chosen={reportsTo} {...rest} />
        )}
      </LoadState>
    </>
  );
}
