import { useMemo } from 'react';
import { useApi } from '../../../api/context.ts';
import { type Flow, flowCalls, useFlowBoard, useFlowText, useLeadFlow } from '../../../api/flows.ts';
import { useOrgChart } from '../../../api/org.ts';
import type { ChartNode, OrgChart } from '../../../api/types.ts';
import type { Loaded } from '../../../api/use-load.ts';
import { useCompany } from '../../../app/company.ts';
import { useLocation } from '../../../app/router.tsx';
import { ErrorBlock, LoadingBlock } from '../../../components/data/LoadState.tsx';
import { leadsTeam, nodeAddress } from '../../../features/flows/access.ts';
import { companyFlowLinks, type TeamTab } from '../../../features/flows/links.ts';
import { TeamView, type TeamViewProps } from '../../../features/flows/team/TeamView.tsx';
import { LiveLeadWakes } from '../../../features/flows/wakes/LiveLeadWakes.tsx';
import { LiveRoom } from '../../../features/room/LiveRoom.tsx';
import { LiveRoomCap } from '../../../features/room/RoomCap.tsx';
import { RoomFrame } from '../../../features/room/RoomFrame.tsx';

type Common = Omit<TeamViewProps, 'flow' | 'board' | 'text' | 'onBoardChanged'>;

/**
 * A team with its flow: the board (read again every 30 seconds while visible), the written form, the team room and,
 * for those who lead the team, the Lead's wake-ups (S6c, when the Lead is an agent) and the room's cap.
 */
function WithFlow({
  common,
  flow,
  loaded,
}: {
  readonly common: Common;
  readonly flow: Flow;
  readonly loaded: Loaded<Flow | null>;
}) {
  const { companyId, slug } = useCompany().membership;
  const board = useFlowBoard(companyId, flow.id);
  const text = useFlowText(companyId, flow.id, flow.updatedAt);
  const leads = leadsTeam(common.viewer, flow.lead.principalId);
  const wakes = leads ? (
    <>
      {flow.lead.kind === 'agent' && (
        <LiveLeadWakes companyId={companyId} slug={slug} flow={flow} calls={common.calls} />
      )}
      <LiveRoomCap flowId={flow.id} />
    </>
  ) : undefined;
  return (
    <TeamView
      {...common}
      flow={flow}
      board={board}
      text={text}
      wakes={wakes}
      room={
        <RoomFrame>
          <LiveRoom flowId={flow.id} faces />
        </RoomFrame>
      }
      onBoardChanged={() => {
        board.reload();
        loaded.reload();
      }}
    />
  );
}

/** The Lead at `address` on the chart: an agent by its slug, anyone by their principal id. */
const leadAt = (chart: OrgChart, address: string): ChartNode | undefined =>
  chart.nodes.find((node) => nodeAddress(node) === address || node.principalId === address);

/**
 * `/:slug/flows/<lead>` (the board) and `/:slug/flows/<lead>/flow` (the flow, `?edit=1` with the editor open): a
 * team's page, by its Lead's address (an agent's slug, a person's principal id). A Lead without a flow gets the editor
 * that makes one, for those who may.
 */
export function TeamPage({ address, tab }: { readonly address: string; readonly tab: TeamTab }) {
  const { membership, me } = useCompany();
  const { companyId } = membership;
  const api = useApi();
  const calls = useMemo(() => flowCalls(api, companyId), [api, companyId]);
  const flow = useLeadFlow(companyId, address);
  const chart = useOrgChart(companyId);
  const editing = useLocation().search.get('edit') === '1';
  if (flow.error !== undefined) return <ErrorBlock error={flow.error} onRetry={flow.reload} />;
  if (chart.error !== undefined) return <ErrorBlock error={chart.error} onRetry={chart.reload} />;
  if (flow.data === undefined || chart.data === undefined) return <LoadingBlock label="Loading the team…" />;
  const common: Common = {
    address,
    tab,
    editing,
    lead: leadAt(chart.data, flow.data?.lead.principalId ?? address),
    chart: chart.data,
    viewer: { role: membership.role, userId: me.user.id, chart: chart.data },
    links: companyFlowLinks(membership.slug),
    calls,
    onFlowSaved: () => flow.reload(),
  };
  if (flow.data === null) {
    return (
      <TeamView {...common} flow={null} board={undefined} text={undefined} onBoardChanged={flow.reload} />
    );
  }
  return <WithFlow key={flow.data.id} common={common} flow={flow.data} loaded={flow} />;
}
