import { formatDateTime, formatTime } from '../data/format.ts';
import { ListRow } from '../data/List.tsx';
import { type AttentionItem, KINDS } from './kinds.ts';

/** One item of the feed: the kind's tile, what and who, and on the right the status word over the time. */
export function AttentionRow({ item }: { readonly item: AttentionItem }) {
  const kind = KINDS[item.kind];
  const who = [item.agent?.name, item.company].filter(Boolean).join(' in ');
  return (
    <ListRow
      icon={kind.icon}
      tone={kind.tone}
      title={item.title}
      subtitle={item.subtitle ?? who}
      value={kind.word}
      valueTone={kind.tone}
      meta={
        <time dateTime={item.at} title={formatDateTime(item.at)}>
          {formatTime(item.at)}
        </time>
      }
      {...(item.href !== undefined ? { href: item.href } : {})}
    />
  );
}
