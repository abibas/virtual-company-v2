import { type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Membership } from '../api/types.ts';
import { roleName, StatusBadge } from '../components/ui/Badge.tsx';
import { Link } from './router.tsx';
import { useSession } from './session.tsx';

const ITEM = 'flex items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-[13.5px] hover:bg-panel-2';

/** Closes an open disclosure on Escape (focus back on its button) or on a click outside it. */
function useDismiss(
  open: boolean,
  close: () => void,
  root: RefObject<HTMLElement | null>,
  button: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      close();
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', onEscape);
    };
  }, [open, close, root, button]);
}

/** The person's active companies (on the same page of each) and Create company. */
function CompanyMenu({
  id,
  open,
  current,
  section,
  onPick,
}: {
  readonly id: string;
  readonly open: boolean;
  readonly current: Membership;
  readonly section: string;
  readonly onPick: () => void;
}) {
  const { me } = useSession();
  const companies = me.memberships.filter((membership) => membership.status === 'active');
  return (
    <div
      id={id}
      hidden={!open}
      className="absolute top-full left-0 z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-line-2 bg-panel-solid p-1.5 shadow-[0_16px_40px_-16px_rgba(0,0,0,0.55)]"
    >
      <p className="px-2.5 pt-1 pb-1.5 text-[12px] text-dim">Your companies</p>
      <ul>
        {companies.map((company) => (
          <li key={company.companyId}>
            <Link
              to={`/c/${company.slug}${section ? `/${section}` : ''}`}
              aria-current={company.slug === current.slug ? 'page' : undefined}
              onClick={onPick}
              className={`${ITEM} ${company.slug === current.slug ? 'bg-panel-2 text-ink' : 'text-ink-2'}`}
            >
              <span className="truncate">{company.name}</span>
              <span className="shrink-0 text-[12px] text-dim">{roleName(company.role)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-1 border-t border-line pt-1">
        <Link to="/companies/new" onClick={onPick} className={`${ITEM} text-amber`}>
          Create company
        </Link>
      </div>
    </div>
  );
}

/**
 * The company on screen, and a list of the person's other companies to switch to (on the same page of the other
 * company) or to create one. A disclosure: Escape or a click outside closes it.
 */
export function CompanySwitcher({
  current,
  section,
}: {
  readonly current: Membership;
  readonly section: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, button);

  return (
    <div ref={root} className="relative flex min-w-0 items-center">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((was) => !was)}
        className="flex min-w-0 cursor-pointer items-center gap-2 rounded-sm px-2 py-1 hover:bg-panel-2"
      >
        <span className="sr-only">Company:</span>
        <span className="truncate font-display text-[19px] font-[450] text-ink">{current.name}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className={`size-3 shrink-0 text-dim ${open ? 'rotate-180' : ''}`}
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      {current.companyStatus !== 'active' && (
        <span className="ml-2 max-sm:hidden">
          <StatusBadge status={current.companyStatus} />
        </span>
      )}
      <CompanyMenu id={menuId} open={open} current={current} section={section} onPick={close} />
    </div>
  );
}
