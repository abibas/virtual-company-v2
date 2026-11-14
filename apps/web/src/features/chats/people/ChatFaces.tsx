import type { ChatPerson } from '../../../api/types.ts';
import { cx } from '../../../components/cx.ts';
import { Avatar } from '../../../components/ui/Avatar.tsx';

/**
 * Who the agent talks with in a chat (2026-11-14, docs/harness.md "Who is in a chat"): the faces of its people, members'
 * photos and contacts' Slack photos (initials on a tint without one), about 18 px, overlapping a little, at most four
 * and "+N"; their names in the tooltip (the browser's own, which no scrolling list cuts off). The agent itself is never
 * one of them.
 */

/** The people's names in a line: "Ihor, Anna and Erich". */
export function namesLine(people: readonly Pick<ChatPerson, 'name'>[]): string {
  const names = people.map((person) => person.name);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const FACE = 'size-[18px]! text-[8px]! ring-[1.5px] ring-surface';

export function ChatFaces({
  people,
  max = 4,
  className,
}: {
  readonly people: readonly Pick<ChatPerson, 'id' | 'name' | 'imageUrl'>[];
  readonly max?: number;
  readonly className?: string;
}) {
  if (people.length === 0) return null;
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const names = namesLine(people);
  return (
    <span
      className={cx('inline-flex shrink-0 items-center', className)}
      role="img"
      aria-label={names}
      title={names}
    >
      {shown.map((person, index) => (
        <Avatar
          key={person.id}
          name={person.name}
          src={person.imageUrl}
          size="xs"
          className={cx(FACE, index > 0 && '-ml-1.5')}
        />
      ))}
      {rest > 0 && (
        <span
          aria-hidden="true"
          className="-ml-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-surface-3 px-1 text-[9px] font-bold text-ink-2 ring-[1.5px] ring-surface tabular"
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
