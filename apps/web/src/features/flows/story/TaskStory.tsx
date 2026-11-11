import { useMemo, useState } from 'react';
import type { Flow, TaskDetail } from '../../../api/flows.ts';
import type { TaskArtifact } from '../../../api/task-artifacts.ts';
import type { ChartNode } from '../../../api/types.ts';
import { ErrorBlock } from '../../../components/data/LoadState.tsx';
import { SegmentedControl } from '../../../components/forms/Segmented.tsx';
import { ArtifactViewer } from '../artifacts/ArtifactViewer.tsx';
import { fileName, saveBlob } from '../artifacts/groups.ts';
import type { TaskRuns } from '../task/runs.ts';
import { AllFiles } from './AllFiles.tsx';
import { StoryRound } from './StoryRound.tsx';
import { StoryAside } from './StoryStepRow.tsx';
import { buildStory } from './story.ts';

type Order = 'newest' | 'oldest';

const ORDERS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
] as const;

/** Rounds open at first: the latest two (all of them up to three). */
const OPEN_AT_FIRST = 2;

/**
 * The task's story (the page's first tab): its rounds, newest first by default (where it stands now is what the page
 * is opened for; the older rounds are why), each its steps with what came of them, notes, files and conversations;
 * then every file of the task, folded. Files open the viewer; "conversation" opens the Conversations tab on it.
 */
export function TaskStory({
  task,
  flow,
  nodes,
  runs,
  onConversation,
  me,
}: {
  readonly task: TaskDetail;
  /** The viewer's principal on the chart. */
  readonly me: string | undefined;
  readonly flow: Flow | null | undefined;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly runs: TaskRuns;
  readonly onConversation: (chatId: string) => void;
}) {
  const [order, setOrder] = useState<Order>('newest');
  const [toggled, setToggled] = useState<ReadonlySet<number>>(new Set());
  const [viewing, setViewing] = useState<TaskArtifact>();
  const [failed, setFailed] = useState<unknown>();
  const { data, error, reload } = runs.artifacts;
  const story = useMemo(() => buildStory(task, flow, data ?? []), [task, flow, data]);
  const count = story.rounds.length;
  const isOpen = (n: number) => (count <= 3 || n > count - OPEN_AT_FIRST) !== toggled.has(n);
  const toggle = (n: number) =>
    setToggled((now) => {
      const next = new Set(now);
      if (!next.delete(n)) next.add(n);
      return next;
    });
  const download = (artifact: TaskArtifact) => {
    setFailed(undefined);
    runs.bytes(artifact).then((blob) => saveBlob(blob, fileName(artifact)), setFailed);
  };
  const rounds = order === 'newest' ? story.rounds.toReversed() : story.rounds;
  const trailing =
    story.trailing.length > 0 ? (
      <ul className="grid gap-0.5 py-1 pl-6">
        {story.trailing.map((event) => (
          <StoryAside key={event.id} event={event} />
        ))}
      </ul>
    ) : null;
  return (
    <div className="grid gap-1">
      {count > 1 && (
        <div className="flex justify-end">
          <SegmentedControl
            options={ORDERS}
            value={order}
            onChange={setOrder}
            label="Order of the rounds"
            size="sm"
          />
        </div>
      )}
      {error !== undefined && <ErrorBlock error={error} onRetry={reload} />}
      {failed !== undefined && <ErrorBlock error={failed} />}
      {order === 'newest' && trailing}
      <div className="grid divide-y divide-line">
        {rounds.map((round) => (
          <StoryRound
            key={round.number}
            round={round}
            open={isOpen(round.number)}
            onToggle={() => toggle(round.number)}
            nodes={nodes}
            load={runs.bytes}
            onOpenFile={setViewing}
            onConversation={onConversation}
            me={me}
          />
        ))}
      </div>
      {order === 'oldest' && trailing}
      {data && <AllFiles artifacts={data} flow={flow} onOpen={setViewing} onDownload={download} />}
      <ArtifactViewer
        artifact={viewing}
        load={runs.bytes}
        onDownload={download}
        onClose={() => setViewing(undefined)}
      />
    </div>
  );
}
