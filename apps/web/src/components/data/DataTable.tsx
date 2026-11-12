import type { MouseEvent, ReactNode } from 'react';
import { navigate } from '../../app/router.tsx';
import { cx } from '../cx.ts';

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly cell: (row: T) => ReactNode;
  /** Hidden below this breakpoint (the row's first cell shows the essentials instead). */
  readonly hide?: 'sm' | 'md' | 'lg';
  readonly align?: 'left' | 'right';
  /** A header read by screen readers only (the actions column). */
  readonly srOnly?: boolean;
  readonly className?: string;
}

const HIDE = { sm: 'max-sm:hidden', md: 'max-md:hidden', lg: 'max-lg:hidden' } as const;

/** A click on a row opens its page, unless it was on a control of its own; with ⌘ or Ctrl, in a new tab. */
function openRow(event: MouseEvent<HTMLTableRowElement>, href: string) {
  if ((event.target as Element).closest('a, button, input, select, textarea, label')) return;
  if (event.metaKey || event.ctrlKey) window.open(href, '_blank', 'noopener');
  else navigate(href);
}

/**
 * The table of every list of records (members, invitations, keys): a quiet header, hairline rows, cells that
 * hide below a breakpoint, and the actions on the right. It scrolls sideways on its own at phone width.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  rowHref,
  className,
}: {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  /** Each row's page: a click anywhere on the row opens it (a link in the row stays the keyboard's way there). */
  readonly rowHref?: (row: T) => string;
  /** Shown instead of the table when there are no rows. */
  readonly empty?: ReactNode;
  readonly className?: string;
}) {
  if (rows.length === 0 && empty !== undefined) return <>{empty}</>;
  return (
    <div className={cx('-mx-5 overflow-x-auto px-5 md:-mx-6 md:px-6', className)}>
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="border-b border-line">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cx(
                  'py-2 pr-4 text-xs font-semibold text-dim last:pr-0',
                  column.hide && HIDE[column.hide],
                  column.align === 'right' && 'text-right',
                )}
              >
                {column.srOnly ? <span className="sr-only">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={rowHref ? (event) => openRow(event, rowHref(row)) : undefined}
              className={cx(
                'border-b border-line align-top last:border-b-0',
                rowHref && 'cursor-pointer transition-colors duration-100 hover:bg-surface-2',
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cx(
                    'py-3.5 pr-4 text-sm text-ink-2 last:pr-0',
                    column.hide && HIDE[column.hide],
                    column.align === 'right' && 'text-right',
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The first cell of a record: its name, a line under it, and what the hidden columns said, on phones. */
export function Primary({
  title,
  subtitle,
  phone,
}: {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  /** Shown under the subtitle below `md` only. */
  readonly phone?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <p className="font-semibold break-words text-ink">{title}</p>
      {subtitle && <p className="text-xs wrap-anywhere text-dim">{subtitle}</p>}
      {phone && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-dim md:hidden">
          {phone}
        </div>
      )}
    </div>
  );
}
