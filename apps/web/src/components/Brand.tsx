import { Link } from '../app/router.tsx';

/** The bearing mark: a chart-room diamond around a fixed point. */
function Mark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 shrink-0 text-amber">
      <path d="M10 1.5 18.5 10 10 18.5 1.5 10Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 5.5 14.5 10 10 14.5 5.5 10Z" fill="currentColor" fillOpacity="0.22" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** The product's name with its mark; a link home unless `plain`. `compact` hides the words on phones. */
export function Brand({
  plain = false,
  compact = false,
}: {
  readonly plain?: boolean;
  readonly compact?: boolean;
}) {
  const content = (
    <>
      <Mark />
      <span
        className={`font-display text-[17px] font-[550] tracking-[0.01em] text-ink ${compact ? 'max-sm:sr-only' : ''}`}
      >
        Most Wanted Corp
      </span>
    </>
  );
  if (plain) return <span className="inline-flex items-center gap-2">{content}</span>;
  return (
    <Link to="/" className="inline-flex items-center gap-2 rounded-xs">
      {content}
    </Link>
  );
}
