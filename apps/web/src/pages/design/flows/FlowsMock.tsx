import { useMemo, useState } from 'react';
import { ApiContext } from '../../../api/context.ts';
import { ApiError } from '../../../api/errors.ts';
import type { Board } from '../../../api/flows.ts';
import { flowCalls } from '../../../api/flows.ts';
import type { Loaded } from '../../../api/use-load.ts';
import { useLocation } from '../../../app/router.tsx';
import { ErrorBlock } from '../../../components/data/LoadState.tsx';
import type { Viewer } from '../../../features/flows/access.ts';
import { nodeAddress } from '../../../features/flows/access.ts';
import type { FlowLinks, TeamTab } from '../../../features/flows/links.ts';
import { FlowsView } from '../../../features/flows/list/FlowsView.tsx';
import { TaskView } from '../../../features/flows/task/TaskView.tsx';
import { TeamView } from '../../../features/flows/team/TeamView.tsx';
import { RoomCapSection } from '../../../features/room/RoomCap.tsx';
import { RoomFrame } from '../../../features/room/RoomFrame.tsx';
import { RoomFaces, RoomView } from '../../../features/room/RoomView.tsx';
import { MockShell } from '../MockShell.tsx';
import { SAMPLE_CHART, SAMPLE_NODES } from '../org-sample.ts';
import { loaded, SAMPLE_COMPANY, SAMPLE_ME, sampleApi } from '../records.ts';
import { SAMPLE_ROOM } from '../team-chat-sample.ts';
import { sampleArtifacts, sampleBytes } from './artifact-sample.ts';
import { SAMPLE_FLOW_LIST, SAMPLE_FLOWS, sampleBoard, sampleText } from './flow-sample.ts';
import { sampleThread } from './SampleThread.tsx';
import { sampleFlowOf, sampleTask } from './task-sample.ts';

const HERE = '/design/flows';

/** The flows' links inside the gallery: a team and a task are query strings of this one mock. */
export const FLOW_LINKS: FlowLinks = {
  structure: '/design/org',
  flows: HERE,
  team: (lead, tab = 'board', edit = false) =>
    `${HERE}?team=${encodeURIComponent(lead)}${tab === 'board' ? '' : `&tab=${tab}`}${edit ? '&edit=1' : ''}`,
  task: (key) => `${HERE}?task=${encodeURIComponent(key)}`,
};

/** The owner, Ihor, on the sample chart. */
export const SAMPLE_VIEWER: Viewer = { role: 'owner', userId: SAMPLE_ME.id, chart: SAMPLE_CHART };

/** A sample flow's board for its card on the Flows page (a hook in name only: the gallery reads no API). */
export function useSampleBoard(_companyId: string, flowId: string): Loaded<Board> {
  return loaded(sampleBoard(flowId));
}

const none = () => undefined;
const refuse = () => Promise.reject(new Error('Sample data: nothing is sent here'));

/** The team page's tab in the gallery's address (`&tab=flow`, `&tab=chat`), the board otherwise. */
const tabOf = (search: URLSearchParams): TeamTab => {
  const tab = search.get('tab');
  return tab === 'flow' || tab === 'chat' ? tab : 'board';
};

/** The Team chat tab on the sample room. */
function SampleRoomTab() {
  const { members } = SAMPLE_ROOM;
  return (
    <RoomFrame>
      <div className="mx-auto w-full max-w-[44rem] px-4 pb-1 md:px-8">
        <RoomFaces members={[...members.agents, ...members.people]} nodes={SAMPLE_NODES} />
      </div>
      <RoomView
        room={SAMPLE_ROOM}
        nodes={SAMPLE_NODES}
        reader={SAMPLE_ME}
        taskHref={FLOW_LINKS.task}
        onSend={refuse}
      />
    </RoomFrame>
  );
}

/** A team's page on the samples: its board, its flow, the editor (`&edit=1`), or a manager's new flow. */
function Team({ address, search }: { readonly address: string; readonly search: URLSearchParams }) {
  const [api] = useState(sampleApi);
  const calls = useMemo(() => flowCalls(api, SAMPLE_COMPANY.id), [api]);
  const lead = SAMPLE_CHART.nodes.find((node) => nodeAddress(node) === address);
  const flow = SAMPLE_FLOWS.find((f) => f.lead.principalId === lead?.principalId) ?? null;
  return (
    <TeamView
      address={address}
      tab={tabOf(search)}
      editing={search.get('edit') === '1'}
      flow={flow}
      lead={lead}
      chart={SAMPLE_CHART}
      viewer={SAMPLE_VIEWER}
      board={flow ? loaded(sampleBoard(flow.id)) : undefined}
      text={flow ? loaded(sampleText(flow)) : undefined}
      links={FLOW_LINKS}
      calls={calls}
      onFlowSaved={none}
      onBoardChanged={none}
      wakes={<RoomCapSection maxPerHour={30} askedLastHour={4} onSave={refuse} />}
      room={<SampleRoomTab />}
    />
  );
}

/** A move on a task whose turn runs (T-18): refused with `step_running` until it is forced, as the server does. */
const RUNNING = new ApiError(
  409,
  'step_running',
  "The step's turn is running: stop it first, or move with force",
);

/** A task's page on the samples. */
function Task({ taskKey }: { readonly taskKey: string }) {
  const [api] = useState(sampleApi);
  const calls = useMemo(() => {
    const real = flowCalls(api, SAMPLE_COMPANY.id);
    const act: typeof real.act = (key, move) =>
      key === 'T-18' && !move.force ? Promise.reject(RUNNING) : real.act(key, move);
    return { ...real, act };
  }, [api]);
  const task = sampleTask(taskKey);
  if (!task) return <ErrorBlock error={new ApiError(404, 'task_not_found', 'No such task')} />;
  return (
    <TaskView
      task={task}
      flow={sampleFlowOf(task)}
      chart={SAMPLE_CHART}
      viewer={SAMPLE_VIEWER}
      links={FLOW_LINKS}
      calls={calls}
      runs={{ artifacts: loaded(sampleArtifacts(taskKey)), bytes: sampleBytes, thread: sampleThread }}
      onChanged={none}
    />
  );
}

/**
 * `/design/flows`: the Flows page; a team's board (`?team=vega`), its flow (`&tab=flow`) and the editor (`&edit=1`);
 * a manager without a flow (`?team=p-1&tab=flow`: the editor that makes one); a task (`?task=T-12` with its
 * conversations and artifacts, `T-14` escalated, `T-18` running, `T-17` ended without a hand-off, `T-15` blocked),
 * on sample records and an API client that refuses every change, as the owner sees them.
 */
export function FlowsMock() {
  const { search } = useLocation();
  const [api] = useState(sampleApi);
  const team = search.get('team');
  const task = search.get('task');
  return (
    <ApiContext value={api}>
      <MockShell active="flows">
        {task !== null && <Task taskKey={task} />}
        {task === null && team !== null && <Team address={team} search={search} />}
        {task === null && team === null && (
          <FlowsView
            companyId={SAMPLE_COMPANY.id}
            flows={loaded(SAMPLE_FLOW_LIST)}
            chart={SAMPLE_CHART}
            viewer={SAMPLE_VIEWER}
            links={FLOW_LINKS}
            useBoard={useSampleBoard}
          />
        )}
      </MockShell>
    </ApiContext>
  );
}
