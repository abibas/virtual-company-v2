import { ImageOff } from 'lucide-react';
import { type TaskArtifact, useArtifactUrl } from '../../../api/task-artifacts.ts';
import { Skeleton } from '../../../components/ui/Skeleton.tsx';
import { sizeWords } from './groups.ts';

/** An image artifact as a thumbnail (its bytes through the bearer client); a click opens it full size. */
export function ArtifactThumb({
  artifact,
  load,
  onOpen,
}: {
  readonly artifact: TaskArtifact;
  readonly load: (artifact: TaskArtifact) => Promise<Blob>;
  readonly onOpen: () => void;
}) {
  const url = useArtifactUrl(artifact, load);
  const name = artifact.name.split('/').at(-1) ?? artifact.name;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${artifact.name} · ${sizeWords(artifact.size)}`}
      className="group flex min-w-0 cursor-pointer flex-col gap-1 text-left"
    >
      <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-lg bg-surface-2 ring-1 ring-line transition-shadow ring-inset group-hover:ring-blue/50">
        {url === undefined && <Skeleton className="size-full" />}
        {url === null && <ImageOff size={16} aria-label="Could not be read" className="text-faint" />}
        {url && <img src={url} alt={artifact.name} className="size-full object-cover" />}
      </span>
      <span className="truncate text-2xs text-dim">{name}</span>
    </button>
  );
}
