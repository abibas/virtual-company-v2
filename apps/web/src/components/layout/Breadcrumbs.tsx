import { ChevronRight } from 'lucide-react';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';

/** One step of the path: a link, or the page itself (the last step, or one without `href`). */
export interface Crumb {
  readonly label: string;
  readonly href?: string | undefined;
}

/**
 * The path the person came through, on one line: each step a link, the last one the page itself
 * (`aria-current="page"`). Long names shorten with an ellipsis instead of wrapping.
 */
export function Breadcrumbs({
  items,
  className,
}: {
  readonly items: readonly Crumb[];
  readonly className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={cx('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: a step's place in the path is its identity.
            <li key={index} className="flex min-w-0 items-center gap-1">
              {index > 0 && <ChevronRight size={13} aria-hidden="true" className="shrink-0 text-faint" />}
              {item.href && !last ? (
                <Link
                  to={item.href}
                  title={item.label}
                  className="truncate rounded-xs font-medium text-dim transition-colors hover:text-ink"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? 'page' : undefined}
                  title={item.label}
                  className={cx('truncate', last ? 'font-semibold text-ink' : 'font-medium text-dim')}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
