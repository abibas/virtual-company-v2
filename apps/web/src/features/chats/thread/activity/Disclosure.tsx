import { ChevronRight } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { cx } from '../../../../components/cx.ts';

/**
 * The look of a quiet activity row (a tool call, a group, a thought): full width, 13px, dim, a soft hover; pulled out
 * by its padding so its icon lines up with the reply's text.
 */
export const ACTIVITY_ROW =
  '-mx-2 w-[calc(100%+1rem)] items-center rounded-md px-2 py-1 text-sm text-dim hover:bg-surface-2 hover:text-ink-2';

/**
 * A row that opens to more (S5.2): a button with `aria-expanded`, and a panel that grows smoothly (its grid row goes
 * from 0 to its height; instant with reduced motion). The panel's content renders the first time it opens, then stays.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen = false,
  className,
  buttonClassName,
  label,
}: {
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  readonly className?: string;
  /** The button's layout and look (its width and alignment too: `ACTIVITY_ROW` for an activity row). */
  readonly buttonClassName?: string;
  /** The button's accessible name, when the summary alone does not say what opens. */
  readonly label?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [seen, setSeen] = useState(defaultOpen);
  const panel = useId();
  return (
    <div className={cx('min-w-0', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        aria-label={label}
        onClick={() => {
          setOpen(!open);
          setSeen(true);
        }}
        className={cx('group/disclosure flex min-w-0 cursor-pointer gap-2 text-left', buttonClassName)}
      >
        {summary}
        <ChevronRight
          size={13}
          aria-hidden="true"
          className="shrink-0 text-faint transition-transform duration-200 group-aria-expanded/disclosure:rotate-90 motion-reduce:transition-none"
        />
      </button>
      <div
        id={panel}
        inert={!open}
        className={cx(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 min-w-0 overflow-hidden">{seen && children}</div>
      </div>
    </div>
  );
}
