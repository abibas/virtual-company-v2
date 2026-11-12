import { useMemo } from 'react';
import { useApi } from '../../api/context.ts';
import { useOrgChart } from '../../api/org.ts';
import { roomCalls, useRoom } from '../../api/room.ts';
import { useCompany } from '../../app/company.ts';
import { ErrorBlock, LoadingBlock } from '../../components/data/LoadState.tsx';
import { nodesById } from '../../components/org/chart.ts';
import { companyFlowLinks } from '../flows/links.ts';
import { RoomFaces, RoomView } from './RoomView.tsx';

/**
 * A flow's team room, live (docs/processes.md "The team room"): read every few seconds while the page is visible and
 * right after a message, with the company's chart for the faces and the signed-in person as the reader. `faces` puts
 * who is in the room above the feed (the team's page; the rail shows its own header).
 */
export function LiveRoom({
  flowId,
  dense = false,
  faces = false,
}: {
  readonly flowId: string;
  readonly dense?: boolean;
  readonly faces?: boolean;
}) {
  const { membership, me } = useCompany();
  const { companyId, slug } = membership;
  const api = useApi();
  const calls = useMemo(() => roomCalls(api, companyId), [api, companyId]);
  const room = useRoom(companyId, flowId);
  const chart = useOrgChart(companyId);
  const nodes = useMemo(() => (chart.data ? nodesById(chart.data.nodes) : undefined), [chart.data]);
  const links = useMemo(() => companyFlowLinks(slug), [slug]);
  if (room.data === undefined)
    return (
      <div className="flex flex-1 flex-col justify-center p-3">
        {room.error !== undefined ? (
          <ErrorBlock error={room.error} onRetry={room.reload} />
        ) : (
          <LoadingBlock label="Opening the room…" />
        )}
      </div>
    );
  const members = [...room.data.members.agents, ...room.data.members.people];
  return (
    <>
      {faces && (
        <div className="mx-auto w-full max-w-[44rem] px-4 pb-1 md:px-8">
          <RoomFaces members={members} nodes={nodes} />
        </div>
      )}
      <RoomView
        room={room.data}
        nodes={nodes}
        reader={me.user}
        taskHref={links.task}
        dense={dense}
        onSend={async (body) => {
          await calls.say(flowId, body);
          room.reload();
        }}
      />
    </>
  );
}
