import { FileCode, FileText, ImageOff, Link2 } from 'lucide-react';
import { type TaskArtifact, useArtifactUrl } from '../../../api/task-artifacts.ts';
import { sizeWords, viewOf } from '../artifacts/groups.ts';

type Load = (artifact: TaskArtifact) => Promise<Blob>;

const CHIP =
  'inline-flex h-6 max-w-[14rem] min-w-0 items-center gap-1.5 rounded-md bg-surface-2 pr-2 pl-1 text-2xs font-medium ring-1 ring-line ring-inset';

/** The path's last part: `login-safari.png`. */
const shortName = (artifact: TaskArtifact) => artifact.name.split('/').at(-1) ?? artifact.name;

/** An image's tiny thumbnail (its bytes through the bearer client). */
function Thumb({ artifact, load }: { readonly artifact: TaskArtifact; readonly load: Load }) {
  const url = useArtifactUrl(artifact, load);
  if (!url) return <ImageOff size={12} aria-hidden="true" className="text-faint" />;
  return <img src={url} alt="" className="size-4 shrink-0 rounded-xs object-cover" />;
}

/** One file: an image with its thumbnail, text with its icon (both open the viewer), a link to its address. */
function Chip({
  artifact,
  load,
  onOpen,
}: {
  readonly artifact: TaskArtifact;
  readonly load: Load;
  readonly onOpen: () => void;
}) {
  if (artifact.kind === 'skipped') {
    return (
      <span className={`${CHIP} text-faint`} title={`${artifact.name}: ${artifact.note ?? 'not collected'}`}>
        <span className="truncate pl-1 line-through decoration-faint/60">{shortName(artifact)}</span>
      </span>
    );
  }
  if (artifact.kind === 'link') {
    const href = artifact.note && /^https?:\/\//i.test(artifact.note) ? artifact.note : undefined;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={artifact.note ?? undefined}
        className={`${CHIP} text-ink-2 hover:text-blue`}
      >
        <Link2 size={12} aria-hidden="true" className="shrink-0 text-dim" />
        <span className="truncate">{artifact.name}</span>
      </a>
    );
  }
  const view = viewOf(artifact);
  const Icon = view === 'markdown' ? FileText : FileCode;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${artifact.name} · ${sizeWords(artifact.size)}`}
      className={`${CHIP} cursor-pointer text-ink-2 hover:text-blue hover:ring-blue/40`}
    >
      {view === 'image' ? (
        <Thumb artifact={artifact} load={load} />
      ) : (
        <Icon size={12} aria-hidden="true" className="shrink-0 text-dim" />
      )}
      <span className="truncate">{shortName(artifact)}</span>
    </button>
  );
}

/** A step's files as small chips (images with a tiny thumbnail; files left out struck through, why on hover). */
export function FileChips({
  files,
  load,
  onOpen,
}: {
  readonly files: readonly TaskArtifact[];
  readonly load: Load;
  readonly onOpen: (artifact: TaskArtifact) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {files.map((artifact) => (
        <Chip key={artifact.id} artifact={artifact} load={load} onOpen={() => onOpen(artifact)} />
      ))}
    </div>
  );
}
