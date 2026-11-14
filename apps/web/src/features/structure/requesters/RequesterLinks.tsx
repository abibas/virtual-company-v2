import { cx } from '../../../components/cx.ts';
import type { RequesterLink, RequestersLit } from './requesters-layout.ts';

/** The dash of a link, and how far one turn of the live animation moves it (`animate-dash-flow`). */
const DASH = '6 6';

/**
 * The Requesters' links, under every card: a dashed curve from each contact to each agent they talked to, wider the
 * more messages. A live one (a turn of theirs waits or runs there) is green with a soft glow under it, and its dash
 * flows toward the agent unless motion is reduced. While something is lit (a hover, a highlighted flow) the lit links
 * come forward, darker, and the rest fade.
 */
export function RequesterLinks({
  links,
  width,
  height,
  lit,
}: {
  readonly links: readonly RequesterLink[];
  readonly width: number;
  readonly height: number;
  readonly lit: RequestersLit | undefined;
}) {
  const on = (link: RequesterLink) => lit?.links.has(link.key) ?? false;
  const ordered = [...links].sort((a, b) => Number(on(a)) - Number(on(b)) || Number(a.live) - Number(b.live));
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      className="pointer-events-none absolute top-0 left-0 overflow-visible"
    >
      {ordered.map((link) => {
        const faded = lit !== undefined && !on(link);
        return (
          <g
            key={link.key}
            className={cx(
              'transition-opacity duration-200 motion-reduce:transition-none',
              faded && 'opacity-15',
            )}
          >
            {link.live && (
              <path
                d={link.d}
                fill="none"
                strokeWidth={link.width + 6}
                strokeLinecap="round"
                className="stroke-done/20"
              />
            )}
            <path
              d={link.d}
              fill="none"
              strokeWidth={link.width}
              strokeDasharray={DASH}
              strokeLinecap="round"
              className={cx(
                link.live
                  ? 'stroke-done motion-safe:animate-dash-flow'
                  : on(link)
                    ? 'stroke-ink-2'
                    : 'stroke-faint',
              )}
            />
          </g>
        );
      })}
    </svg>
  );
}
