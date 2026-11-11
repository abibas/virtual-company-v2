import { Download, FileCode, FileText, Link2, type LucideIcon } from 'lucide-react';
import type { TaskArtifact } from '../../../api/task-artifacts.ts';
import { formatDateTime } from '../../../components/data/format.ts';
import { IconButton } from '../../../components/ui/IconButton.tsx';
import { ago } from '../../notifications/NotificationList.tsx';
import { sizeWords, viewOf } from './groups.ts';

/** A file's icon by how it opens: Markdown, other text (code), a link. */
const ICON: Readonly<Record<string, LucideIcon>> = { markdown: FileText, text: FileCode, none: Link2 };

/** A link's address, when it is a web address (anything else is not followed). */
const webAddress = (note: string | null) => (note && /^https?:\/\//i.test(note) ? note : undefined);

/** Its size (none for a link) and when it was last collected. */
function Facts({ artifact }: { readonly artifact: TaskArtifact }) {
  return (
    <span className="shrink-0 text-2xs text-dim tabular" title={formatDateTime(artifact.updatedAt)}>
      {artifact.kind === 'link' ? 'link' : sizeWords(artifact.size)} · {ago(artifact.updatedAt)}
    </span>
  );
}

/**
 * A collected file or a link in a round's list: its icon by kind, its path (it opens the viewer; a link opens its
 * address in a new tab), its size and time, and Download.
 */
export function ArtifactRow({
  artifact,
  onOpen,
  onDownload,
}: {
  readonly artifact: TaskArtifact;
  readonly onOpen: () => void;
  readonly onDownload: () => void;
}) {
  const view = viewOf(artifact);
  const Icon = ICON[view] ?? FileText;
  const link = artifact.kind === 'link' ? webAddress(artifact.note) : undefined;
  const name = <span className="min-w-0 truncate">{artifact.name}</span>;
  const line =
    'flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-sm text-ink hover:text-blue';
  return (
    <li className="flex min-h-8 items-center gap-2 pl-1">
      <Icon size={14} aria-label={artifact.kind} className="shrink-0 text-dim" />
      {artifact.kind === 'link' ? (
        <a href={link} target="_blank" rel="noreferrer" className={line} title={artifact.note ?? undefined}>
          {name}
        </a>
      ) : (
        <button type="button" onClick={onOpen} className={line} title={artifact.name}>
          {name}
        </button>
      )}
      <Facts artifact={artifact} />
      {artifact.kind !== 'link' && (
        <IconButton label={`Download ${artifact.name}`} icon={Download} size="sm" onClick={onDownload} />
      )}
    </li>
  );
}

/** A file seen but not collected: its path, faint, and why ("too large"). */
export function SkippedRow({ artifact }: { readonly artifact: TaskArtifact }) {
  return (
    <li className="flex min-h-7 items-center gap-2 pl-1 text-xs text-faint">
      <span className="min-w-0 shrink-0 truncate line-through decoration-faint/60">{artifact.name}</span>
      <span className="min-w-0 shrink truncate" title={artifact.note ?? undefined}>
        {artifact.note?.replace(/^Not collected: /, '') ?? 'not collected'}
      </span>
    </li>
  );
}
