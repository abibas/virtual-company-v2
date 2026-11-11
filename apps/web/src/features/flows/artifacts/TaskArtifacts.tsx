import { Files } from 'lucide-react';
import { useState } from 'react';
import type { Flow, TaskDetail } from '../../../api/flows.ts';
import type { TaskArtifact } from '../../../api/task-artifacts.ts';
import { ErrorBlock } from '../../../components/data/LoadState.tsx';
import { Card } from '../../../components/ui/Card.tsx';
import { Skeleton } from '../../../components/ui/Skeleton.tsx';
import type { TaskRuns } from '../task/runs.ts';
import { ArtifactRow, SkippedRow } from './ArtifactRow.tsx';
import { ArtifactThumb } from './ArtifactThumb.tsx';
import { ArtifactViewer } from './ArtifactViewer.tsx';
import { type ArtifactRound, fileName, groupArtifacts, saveBlob } from './groups.ts';
import { HandOffNote } from './HandOffNote.tsx';

type Open = (artifact: TaskArtifact) => void;

/** One round: its hand-off note highlighted, its images as thumbnails, its files, and the files it left out. */
function Round({
  round,
  load,
  onOpen,
  onDownload,
}: {
  readonly round: ArtifactRound;
  readonly load: TaskRuns['bytes'];
  readonly onOpen: Open;
  readonly onDownload: Open;
}) {
  return (
    <div className="grid gap-1.5">
      <h4 className="text-2xs font-semibold text-dim">Round {round.round}</h4>
      {round.note && (
        <HandOffNote artifact={round.note} load={load} onOpen={() => onOpen(round.note as TaskArtifact)} />
      )}
      {round.images.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {round.images.map((a) => (
            <ArtifactThumb key={a.id} artifact={a} load={load} onOpen={() => onOpen(a)} />
          ))}
        </div>
      )}
      {round.files.length + round.skipped.length > 0 && (
        <ul className="grid">
          {round.files.map((a) => (
            <ArtifactRow key={a.id} artifact={a} onOpen={() => onOpen(a)} onDownload={() => onDownload(a)} />
          ))}
          {round.skipped.map((a) => (
            <SkippedRow key={a.id} artifact={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The list once loaded: each step's name, then its rounds, the latest first. */
function Groups({
  list,
  flow,
  load,
  onOpen,
  onDownload,
}: {
  readonly list: readonly TaskArtifact[];
  readonly flow: Flow | null | undefined;
  readonly load: TaskRuns['bytes'];
  readonly onOpen: Open;
  readonly onDownload: Open;
}) {
  const groups = groupArtifacts(list, flow?.steps.map((step) => step.id) ?? []);
  return groups.map(({ step, rounds }) => (
    <section key={step.id} aria-label={step.name} className="grid gap-2.5">
      <h3 className="text-xs font-bold text-ink">{step.name}</h3>
      {rounds.map((round) => (
        <Round key={round.round} round={round} load={load} onOpen={onOpen} onDownload={onDownload} />
      ))}
    </section>
  ));
}

/**
 * The task's artifacts (S5.3b), grouped by step and round: each round's hand-off note highlighted, images as
 * thumbnails (full size on a click), text and Markdown in a viewer, the files left out with why, and Download on each.
 * Nothing shows before the first.
 */
export function TaskArtifacts({
  task,
  flow,
  runs,
}: {
  readonly task: TaskDetail;
  readonly flow: Flow | null | undefined;
  readonly runs: TaskRuns;
}) {
  const [open, setOpen] = useState<TaskArtifact>();
  const [failed, setFailed] = useState<unknown>();
  const { data, error, reload } = runs.artifacts;
  if (task.artifacts === 0 && (data?.length ?? 0) === 0) return null;
  const download = (artifact: TaskArtifact) => {
    setFailed(undefined);
    runs.bytes(artifact).then((blob) => saveBlob(blob, fileName(artifact)), setFailed);
  };
  return (
    <Card as="section" padding="sm" aria-label="Artifacts">
      <h2 className="mb-2.5 flex items-center gap-1.5 text-xs font-bold tracking-wide text-dim uppercase">
        <Files size={12} aria-hidden="true" />
        Artifacts
        <span className="font-semibold tabular">{task.artifacts}</span>
      </h2>
      <div className="grid gap-4">
        {error !== undefined && <ErrorBlock error={error} onRetry={reload} />}
        {data === undefined && error === undefined && <Skeleton className="h-16 w-full" />}
        {data && <Groups list={data} flow={flow} load={runs.bytes} onOpen={setOpen} onDownload={download} />}
        {failed !== undefined && <ErrorBlock error={failed} />}
      </div>
      <ArtifactViewer
        artifact={open}
        load={runs.bytes}
        onDownload={download}
        onClose={() => setOpen(undefined)}
      />
    </Card>
  );
}
