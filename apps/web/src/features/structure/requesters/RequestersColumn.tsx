import { Link } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { RequesterCard } from './RequesterCard.tsx';
import { type RequesterWindow, WINDOWS } from './requesters.ts';
import {
  COLUMN,
  REQUESTER,
  type RequesterHover,
  type RequestersLayout,
  type RequestersLit,
} from './requesters-layout.ts';

/** Where a card sits; outside what is lit it fades, as the chart's own cards do. */
const PLACE = 'absolute transition-[opacity,filter] duration-200 motion-reduce:transition-none';
const FADED = 'opacity-40 saturate-0';

/**
 * The Requesters column on the canvas: its label, each contact's card where the layout puts it (hovering one lights
 * their links and agents), and "+N more" opening the Contacts tab.
 */
export function RequestersColumn({
  layout,
  range,
  lit,
  contactHref,
  moreHref,
  onHover,
}: {
  readonly layout: RequestersLayout;
  readonly range: RequesterWindow;
  readonly lit: RequestersLit | undefined;
  readonly contactHref: (contactId: string) => string;
  readonly moreHref: string;
  readonly onHover: (hover: RequesterHover | undefined) => void;
}) {
  return (
    <>
      <p
        className="absolute flex items-center text-2xs font-bold tracking-wide text-dim uppercase"
        style={{ left: layout.x + 4, top: 0, height: COLUMN.label - 8 }}
      >
        Requesters
      </p>
      {layout.cards.map(({ contact, requests, x, y }) => (
        <div
          key={contact.contact.id}
          className={cx(PLACE, lit && !lit.contacts.has(contact.contact.id) && FADED)}
          style={{ left: x, top: y }}
        >
          <RequesterCard
            name={contact.contact.name}
            title={contact.contact.title}
            avatarUrl={contact.contact.avatarUrl}
            requests={requests}
            span={WINDOWS[range].span}
            live={contact.live}
            href={contactHref(contact.contact.id)}
            onHover={(on) => onHover(on ? { kind: 'contact', id: contact.contact.id } : undefined)}
          />
        </div>
      ))}
      {layout.more && (
        <Link
          to={moreHref}
          draggable={false}
          className={cx(
            PLACE,
            'flex items-center justify-center rounded-full border border-dashed border-line-2 bg-surface text-xs font-semibold text-dim hover:text-ink focus-visible:outline-2 focus-visible:outline-blue',
            lit && FADED,
          )}
          style={{ left: layout.more.x, top: layout.more.y, width: REQUESTER.width, height: COLUMN.more }}
        >
          +{layout.more.count} more
        </Link>
      )}
    </>
  );
}
