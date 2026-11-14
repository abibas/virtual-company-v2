import { ExternalLink, Scale } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../cx.ts';
import { Badge, type Tone } from '../ui/Badge.tsx';

/**
 * One decision an agent recorded with `record_decision` (2026-11-14): its outcome as a chip, what it decided, why
 * (folded after three lines), and the sources it relied on (a web address as a link, a Jira key or a file path as it
 * is). The chat's thread shows it where it was made; the agent's page and the task's list them with `footer` (who,
 * when, a link to its chat).
 */

/** What the card shows of a decision. */
export interface DecisionCardView {
  readonly what: string;
  readonly why: string;
  readonly sources: readonly string[];
  readonly outcome: DecisionOutcomeWord | null;
}

export type DecisionOutcomeWord = 'approved' | 'rejected' | 'done' | 'declined' | 'deferred' | 'other';

/** Each outcome's chip. */
export const OUTCOMES: Readonly<Record<DecisionOutcomeWord, { readonly word: string; readonly tone: Tone }>> =
  {
    approved: { word: 'Approved', tone: 'done' },
    rejected: { word: 'Rejected', tone: 'failed' },
    done: { word: 'Done', tone: 'teal' },
    declined: { word: 'Declined', tone: 'blocked' },
    deferred: { word: 'Deferred', tone: 'pending' },
    other: { word: 'Other', tone: 'neutral' },
  };

/** A web address the source is, or undefined for a reference (a Jira key, a path). */
function webAddress(source: string): string | undefined {
  try {
    const url = new URL(source);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** The address without its scheme, for the link's words. */
const shortAddress = (href: string) => href.replace(/^https?:\/\//, '').replace(/\/$/, '');

function Source({ source }: { readonly source: string }) {
  const href = webAddress(source);
  if (href === undefined) {
    return (
      <code className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-ink-2">{source}</code>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-xs text-xs font-medium text-blue hover:underline"
    >
      <span className="truncate">{shortAddress(href)}</span>
      <ExternalLink size={11} aria-hidden="true" className="shrink-0" />
    </a>
  );
}

/** Why, folded to three lines with "Show more" when it does not fit. */
function Why({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new text or folding it again is what needs measuring again.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || open) return;
    const check = () => setClipped(element.scrollHeight > element.clientHeight + 1);
    check();
    const watch = new ResizeObserver(check);
    watch.observe(element);
    return () => watch.disconnect();
  }, [open, text]);
  return (
    <div className="grid gap-1">
      <p
        ref={ref}
        className={cx(
          'text-sm leading-relaxed break-words whitespace-pre-wrap text-ink-2',
          !open && 'line-clamp-3',
        )}
      >
        {text}
      </p>
      {(clipped || open) && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="w-fit cursor-pointer rounded-xs text-2xs font-semibold text-blue hover:text-blue-strong"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export function DecisionCard({
  decision,
  footer,
  className,
}: {
  readonly decision: DecisionCardView;
  /** Who and when, and where it was made, under the sources. */
  readonly footer?: ReactNode;
  readonly className?: string;
}) {
  const outcome = decision.outcome === null ? undefined : OUTCOMES[decision.outcome];
  return (
    <article
      className={cx(
        'grid min-w-0 gap-2 rounded-xl border border-line bg-surface px-3.5 py-3 shadow-card',
        className,
      )}
    >
      <header className="flex min-w-0 items-start gap-2">
        <Scale size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-faint" />
        <h4 className="min-w-0 flex-1 text-sm leading-snug font-semibold break-words text-ink">
          {decision.what}
        </h4>
        {outcome && (
          <Badge tone={outcome.tone} size="sm" className="shrink-0">
            {outcome.word}
          </Badge>
        )}
      </header>
      <Why text={decision.why} />
      {decision.sources.length > 0 && (
        <ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {decision.sources.map((source) => (
            <li key={source} className="min-w-0 max-w-full">
              <Source source={source} />
            </li>
          ))}
        </ul>
      )}
      {footer !== undefined && <footer className="text-2xs text-faint">{footer}</footer>}
    </article>
  );
}
