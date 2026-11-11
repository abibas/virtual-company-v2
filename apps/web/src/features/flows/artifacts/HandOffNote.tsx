import { CornerDownRight } from 'lucide-react';
import type { TaskArtifact } from '../../../api/task-artifacts.ts';
import { ago, formatDateTime } from '../../../components/data/format.ts';
import { useArtifactText } from './ArtifactViewer.tsx';

/** The first lines of the note, plain (the viewer renders it whole). */
const preview = (text: string) =>
  text
    .split('\n')
    .map((line) =>
      line
        .replace(/^[#>*\-\s]+/, '')
        .replace(/[`*]/g, '')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');

/**
 * A round's hand-off note (the step's final reply, which the next step reads), highlighted at the top of its round:
 * its first lines; a click opens it rendered.
 */
export function HandOffNote({
  artifact,
  load,
  onOpen,
}: {
  readonly artifact: TaskArtifact;
  readonly load: (artifact: TaskArtifact) => Promise<Blob>;
  readonly onOpen: () => void;
}) {
  const text = useArtifactText(artifact, load);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full cursor-pointer gap-1 rounded-lg bg-blue-soft px-2.5 py-2 text-left ring-1 ring-blue/25 transition-shadow ring-inset hover:ring-blue/60"
    >
      <span className="flex items-center gap-1.5 text-2xs font-bold text-blue">
        <CornerDownRight size={12} aria-hidden="true" />
        Hand-off note
        <time
          dateTime={artifact.updatedAt}
          title={formatDateTime(artifact.updatedAt)}
          className="ml-auto font-medium"
        >
          {ago(artifact.updatedAt)}
        </time>
      </span>
      <span className="line-clamp-3 text-xs leading-relaxed text-ink-2">
        {text.data === undefined ? (text.error ? 'Could not be read' : '…') : preview(text.data)}
      </span>
    </button>
  );
}
