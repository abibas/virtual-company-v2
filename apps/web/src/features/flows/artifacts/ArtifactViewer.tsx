import { Download } from 'lucide-react';
import { artifactKey, type TaskArtifact, useArtifactUrl } from '../../../api/task-artifacts.ts';
import { useLoad } from '../../../api/use-load.ts';
import { ErrorBlock, LoadingBlock } from '../../../components/data/LoadState.tsx';
import { Sheet } from '../../../components/layout/Drawer.tsx';
import { Button } from '../../../components/ui/Button.tsx';
import { Markdown } from '../../chats/thread/markdown/Markdown.tsx';
import { HAND_OFF_NOTE, sizeWords, viewOf } from './groups.ts';

type Load = (artifact: TaskArtifact) => Promise<Blob>;

/** A text artifact's words, read once per version. */
export function useArtifactText(artifact: TaskArtifact, load: Load) {
  return useLoad(`artifact-text:${artifactKey(artifact)}`, async () => (await load(artifact)).text());
}

/** The full image, as large as the sheet allows. */
function FullImage({ artifact, load }: { readonly artifact: TaskArtifact; readonly load: Load }) {
  const url = useArtifactUrl(artifact, load);
  if (url === undefined) return <LoadingBlock label="Loading the image…" />;
  if (url === null) return <ErrorBlock error={new Error('The image could not be read')} />;
  return (
    <img src={url} alt={artifact.name} className="mx-auto h-auto max-w-full rounded-lg ring-1 ring-line" />
  );
}

/** Markdown rendered; any other text in monospace, as it is. */
function TextBody({ artifact, load }: { readonly artifact: TaskArtifact; readonly load: Load }) {
  const text = useArtifactText(artifact, load);
  if (text.error !== undefined) return <ErrorBlock error={text.error} onRetry={text.reload} />;
  if (text.data === undefined) return <LoadingBlock label="Loading…" />;
  if (viewOf(artifact) === 'markdown') return <Markdown text={text.data} className="text-sm" />;
  return (
    <pre className="overflow-x-auto rounded-xl bg-surface-2 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-ink">
      {text.data}
    </pre>
  );
}

/**
 * An artifact opened beside the page: an image full size, Markdown rendered, other text in monospace; the step, round,
 * size and type under its name, and Download.
 */
export function ArtifactViewer({
  artifact,
  load,
  onDownload,
  onClose,
}: {
  readonly artifact: TaskArtifact | undefined;
  readonly load: Load;
  readonly onDownload: (artifact: TaskArtifact) => void;
  readonly onClose: () => void;
}) {
  if (!artifact) return null;
  const title = artifact.name === HAND_OFF_NOTE ? 'Hand-off note' : artifact.name;
  const facts = [
    artifact.step.name,
    `round ${artifact.round}`,
    sizeWords(artifact.size),
    artifact.contentType,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Sheet open onClose={onClose} title={title} description={facts} wide>
      <div className="mx-auto grid max-w-[52rem] gap-4">
        <div className="flex justify-end">
          <Button size="sm" icon={Download} onClick={() => onDownload(artifact)}>
            Download
          </Button>
        </div>
        {viewOf(artifact) === 'image' ? (
          <FullImage artifact={artifact} load={load} />
        ) : (
          <TextBody artifact={artifact} load={load} />
        )}
      </div>
    </Sheet>
  );
}
