import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';

const SIZES = {
  xs: 'size-6 rounded-md',
  sm: 'size-7 rounded-md',
  md: 'size-9 rounded-lg',
  lg: 'size-11 rounded-xl',
} as const;

/** The mark: an org tree (one at the top, three below) in white on the blue gradient; `inverse` on a gradient card. */
export function BrandMark({
  size = 'md',
  inverse = false,
  className,
}: {
  readonly size?: keyof typeof SIZES;
  readonly inverse?: boolean;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center',
        SIZES[size],
        inverse ? 'bg-white text-blue-strong' : 'gradient-mark text-white shadow-primary',
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-[62%]"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <circle cx="12" cy="6" r="2.6" fill="currentColor" stroke="none" />
        <path d="M12 8.6v3.2M6 15.2c0-1.4 1.2-2.6 2.6-2.6h6.8c1.4 0 2.6 1.2 2.6 2.6" />
        <circle cx="6" cy="18.2" r="2" fill="currentColor" stroke="none" />
        <circle cx="12" cy="18.2" r="2" fill="currentColor" stroke="none" />
        <circle cx="18" cy="18.2" r="2" fill="currentColor" stroke="none" />
      </svg>
    </span>
  );
}

/** The product's name with its mark; a link home unless `plain`; `words` false keeps the mark alone. */
export function Brand({
  plain = false,
  words = true,
  inverse = false,
  size = 'md',
  className,
}: {
  readonly plain?: boolean;
  readonly words?: boolean;
  readonly inverse?: boolean;
  readonly size?: keyof typeof SIZES;
  readonly className?: string;
}) {
  const content = (
    <>
      <BrandMark size={size} inverse={inverse} />
      {words && (
        <span
          className={cx(
            'font-extrabold tracking-[-0.02em]',
            size === 'lg' ? 'text-xl' : 'text-md',
            inverse ? 'text-white' : 'text-ink',
          )}
        >
          Most Wanted Corp
        </span>
      )}
    </>
  );
  const classes = cx('inline-flex items-center gap-2.5 rounded-lg', className);
  if (plain) return <span className={classes}>{content}</span>;
  return (
    <Link to="/" className={classes} aria-label="Most Wanted Corp, home">
      {content}
    </Link>
  );
}
