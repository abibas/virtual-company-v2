import { ChevronRight } from 'lucide-react';
import type { Flow } from '../../../api/flows.ts';
import type { TaskArtifact } from '../../../api/task-artifacts.ts';
import { ArtifactRow, SkippedRow } from '../artifacts/ArtifactRow.tsx';
import { groupArtifacts } from '../artifacts/groups.ts';

type Open = (artifact: TaskArtifact) => void;

/**
 * Every file of the task in one list, folded under the story: by step in the flow's order, then by round, the latest
 * first; each row opens the viewer or downloads. The hand-off notes are left out (each is in its step's row).
 */
export function AllFiles({
  artifacts,
  flow,
  onOpen,
  onDownload,
}: {
  readonly artifacts: readonly TaskArtifact[];
  readonly flow: Flow | null | undefined;
  readonly onOpen: Open;
  readonly onDownload: Open;
}) {
  const files = artifacts.filter((a) => a.kind !== 'note');
  if (files.length === 0) return null;
  const groups = groupArtifacts(files, flow?.steps.map((s) => s.id) ?? []);
  return (
    <details className="group mt-1 border-t border-line pt-1">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md text-xs font-bold tracking-wide text-dim uppercase hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="transition-transform group-open:rotate-90" />
        All files
        <span className="font-semibold tabular">{files.length}</span>
      </summary>
      <div className="grid gap-2 pb-1 pl-6">
        {groups.flatMap(({ step, rounds }) =>
          rounds.map((round) => (
            <section key={`${step.id}:${round.round}`} aria-label={`${step.name}, round ${round.round}`}>
              <h4 className="text-2xs font-semibold text-dim">
                {step.name} · round {round.round}
              </h4>
              <ul className="grid">
                {[...round.images, ...round.files].map((a) => (
                  <ArtifactRow
                    key={a.id}
                    artifact={a}
                    onOpen={() => onOpen(a)}
                    onDownload={() => onDownload(a)}
                  />
                ))}
                {round.skipped.map((a) => (
                  <SkippedRow key={a.id} artifact={a} />
                ))}
              </ul>
            </section>
          )),
        )}
      </div>
    </details>
  );
}
