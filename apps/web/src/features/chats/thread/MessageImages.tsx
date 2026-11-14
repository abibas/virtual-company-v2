import { ImageOff } from 'lucide-react';
import { useContext, useState } from 'react';
import { type ChatImage, retryChatImage, useChatImageUrl } from '../../../api/chat-images.ts';
import { CompanyContext } from '../../../app/company.ts';
import { cx } from '../../../components/cx.ts';
import { formatBytes } from '../../../components/data/format.ts';
import { ErrorBlock, LoadingBlock } from '../../../components/data/LoadState.tsx';
import { Sheet } from '../../../components/layout/Drawer.tsx';

/**
 * A message's images in the thread (T-18): a row of thumbnails with its bubble, on the bubble's side, each opening the
 * image large beside the page. The bytes come through the API client (`useChatImageUrl`), once per image for the page.
 * Each is labeled "Image N", as the `[Image N]` marker in the message's text that points to it (T-20).
 */

const TYPE_WORDS: Readonly<Record<ChatImage['contentType'], string>> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
};

const FRAME = 'relative overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line';

/** Where the images are read from: the chat, and the company on screen (none in the design gallery). */
interface Source {
  readonly companyId: string | undefined;
  readonly chatId: string;
}

/** One thumbnail: the image at most 160 px high, a quiet square while it loads, a mark when it could not be read. */
function Thumbnail({
  source,
  image,
  label,
  onOpen,
}: {
  readonly source: Source;
  readonly image: ChatImage;
  readonly label: string;
  readonly onOpen: () => void;
}) {
  const url = useChatImageUrl(source.companyId, source.chatId, image.id);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${label}`}
      className={cx(
        FRAME,
        'cursor-zoom-in transition-shadow hover:ring-line-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue',
      )}
    >
      {url ? (
        <img src={url} alt={label} className="block h-auto max-h-40 w-auto max-w-60" />
      ) : (
        <span
          className={cx(
            'flex size-24 items-center justify-center text-faint',
            url === undefined && 'motion-safe:animate-pulse',
          )}
        >
          {url === null && <ImageOff size={20} aria-hidden="true" />}
        </span>
      )}
      <span
        aria-hidden="true"
        className="absolute bottom-1 left-1 rounded-md bg-ink/70 px-1.5 py-px text-2xs leading-4 font-medium text-surface"
      >
        {label}
      </span>
    </button>
  );
}

/** The image as large as the sheet allows, with a loading and an error state. */
function LargeImage({
  source,
  image,
  label,
}: {
  readonly source: Source;
  readonly image: ChatImage;
  readonly label: string;
}) {
  const url = useChatImageUrl(source.companyId, source.chatId, image.id);
  if (url === undefined) return <LoadingBlock label="Loading the image…" />;
  if (url === null)
    return (
      <ErrorBlock error={new Error('The image could not be read')} onRetry={() => retryChatImage(image.id)} />
    );
  return <img src={url} alt={label} className="mx-auto h-auto max-w-full rounded-lg ring-1 ring-line" />;
}

/** The images of a message, in the order they were attached; nothing when it has none. */
export function MessageImages({
  chatId,
  images,
  own,
}: {
  readonly chatId: string;
  readonly images: readonly ChatImage[];
  /** The reader's own message: the row sits at the right, as its bubble does. */
  readonly own: boolean;
}) {
  const companyId = useContext(CompanyContext)?.membership.companyId;
  const [open, setOpen] = useState<number>();
  if (images.length === 0) return null;
  const source = { companyId, chatId };
  const labelOf = (index: number) => `Image ${index + 1}`;
  const shown = open === undefined ? undefined : images[open];
  return (
    <>
      <ul
        aria-label={images.length === 1 ? 'Image' : `${images.length} images`}
        className={cx('flex max-w-full flex-wrap gap-1.5', own ? 'justify-end' : 'justify-start')}
      >
        {images.map((image, index) => (
          <li key={image.id} className="min-w-0">
            <Thumbnail source={source} image={image} label={labelOf(index)} onOpen={() => setOpen(index)} />
          </li>
        ))}
      </ul>
      {shown && open !== undefined && (
        <Sheet
          open
          onClose={() => setOpen(undefined)}
          title={images.length === 1 ? 'Image' : `Image ${open + 1} of ${images.length}`}
          description={`${TYPE_WORDS[shown.contentType]} · ${formatBytes(shown.size)}`}
          wide
        >
          <LargeImage source={source} image={shown} label={labelOf(open)} />
        </Sheet>
      )}
    </>
  );
}
