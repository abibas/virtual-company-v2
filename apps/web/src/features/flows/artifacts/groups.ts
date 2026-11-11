import type { TaskArtifact } from '../../../api/task-artifacts.ts';

/**
 * A task's artifacts as its page groups them (S5.3b): by step in the flow's order (a removed step's last), then by
 * round, the latest first; in each round the hand-off note, the images, the other files and the skipped ones. Pure.
 */

/** The name a round's hand-off note is kept under. */
export const HAND_OFF_NOTE = 'hand-off note';

export interface ArtifactRound {
  readonly round: number;
  readonly note: TaskArtifact | undefined;
  readonly images: readonly TaskArtifact[];
  readonly files: readonly TaskArtifact[];
  readonly skipped: readonly TaskArtifact[];
}

export interface ArtifactStep {
  readonly step: TaskArtifact['step'];
  readonly rounds: readonly ArtifactRound[];
}

/** How an artifact opens: an image, Markdown, plain text, or not at all (skipped, a link). */
export type ArtifactView = 'image' | 'markdown' | 'text' | 'none';

export function viewOf(artifact: TaskArtifact): ArtifactView {
  if (artifact.kind === 'skipped' || artifact.kind === 'link') return 'none';
  const type = artifact.contentType ?? '';
  if (type.startsWith('image/')) return 'image';
  if (artifact.kind === 'note' || type.startsWith('text/markdown') || /\.(md|markdown)$/i.test(artifact.name))
    return 'markdown';
  return 'text';
}

function roundOf(round: number, items: readonly TaskArtifact[]): ArtifactRound {
  const byName = items.toSorted((a, b) => a.name.localeCompare(b.name));
  return {
    round,
    note: byName.find((a) => a.kind === 'note'),
    images: byName.filter((a) => a.kind === 'file' && viewOf(a) === 'image'),
    files: byName.filter((a) => (a.kind === 'file' && viewOf(a) !== 'image') || a.kind === 'link'),
    skipped: byName.filter((a) => a.kind === 'skipped'),
  };
}

/** The artifacts by step (in `stepIds` order), then by round, the latest round first. */
export function groupArtifacts(
  artifacts: readonly TaskArtifact[],
  stepIds: readonly string[],
): ArtifactStep[] {
  const at = (id: string) => {
    const index = stepIds.indexOf(id);
    return index < 0 ? stepIds.length : index;
  };
  const steps = [...Map.groupBy(artifacts, (a) => a.step.id).values()].map((items) => ({
    step: (items[0] as TaskArtifact).step,
    rounds: [...Map.groupBy(items, (a) => a.round).entries()]
      .toSorted(([a], [b]) => b - a)
      .map(([round, list]) => roundOf(round, list)),
  }));
  return steps.toSorted((a, b) => at(a.step.id) - at(b.step.id));
}

/** "26 B", "3.4 KB", "1.2 MB". */
export function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The file name a download saves under: the path's last part; the note as `hand-off-note.md`. */
export const fileName = (artifact: TaskArtifact): string =>
  artifact.kind === 'note' ? 'hand-off-note.md' : (artifact.name.split('/').at(-1) ?? 'artifact');

/** Saves `blob` as `name` through a link the page clicks (the bytes came through the bearer client). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
