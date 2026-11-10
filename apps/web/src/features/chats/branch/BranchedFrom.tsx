import { GitBranch } from 'lucide-react';
import type { ChatDetail } from '../../../api/types.ts';
import { Link } from '../../../app/router.tsx';
import { formatDateTime } from '../../../components/data/format.ts';

/** The quiet line at the top of a branch: "Branched from <parent> · <when>", the parent's title linking back to it. */
export function BranchedFrom({
  from,
  at,
  hrefOf,
}: {
  readonly from: NonNullable<ChatDetail['branchedFrom']>;
  /** When the branch began. */
  readonly at: string;
  readonly hrefOf: (chatId: string) => string;
}) {
  return (
    <p className="flex min-w-0 items-center justify-center gap-1.5 text-xs text-faint">
      <GitBranch size={13} aria-hidden="true" className="shrink-0" />
      <span className="shrink-0">Branched from</span>
      <Link
        to={hrefOf(from.chatId)}
        className="min-w-0 truncate font-medium text-dim underline-offset-2 hover:text-ink hover:underline"
      >
        {from.title ?? 'a chat'}
      </Link>
      <span aria-hidden="true">·</span>
      <time dateTime={at} className="shrink-0 tabular">
        {formatDateTime(at)}
      </time>
    </p>
  );
}
