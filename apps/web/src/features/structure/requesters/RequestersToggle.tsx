import { ChevronDown, Contact } from 'lucide-react';
import { navigate, useLocation } from '../../../app/router.tsx';
import { cx } from '../../../components/cx.ts';
import { Menu, MenuItem, MenuLabel } from '../../../components/forms/Menu.tsx';
import {
  REQUESTERS_PARAM,
  type RequestersChoice,
  requestersAt,
  requestersValue,
  WINDOW_ORDER,
  WINDOWS,
} from './requesters.ts';

/** The column as the address has it (`?requesters=`). */
export const useRequestersChoice = (): RequestersChoice =>
  requestersAt(useLocation().search.get(REQUESTERS_PARAM));

/**
 * The org chart's Requesters switch, in the structure page's header row beside the flow picker: one press shows or
 * hides the column, and its menu picks the window (24 hours, 7 days, 30 days). The choice is the address's
 * `?requesters=`, so a link shares it and Back undoes it.
 */
export function RequestersToggle() {
  const { pathname, search } = useLocation();
  const choice = requestersAt(search.get(REQUESTERS_PARAM));
  const choose = (next: RequestersChoice) => {
    const query = new URLSearchParams(search);
    const value = requestersValue(next);
    if (value === null) query.delete(REQUESTERS_PARAM);
    else query.set(REQUESTERS_PARAM, value);
    const text = query.toString();
    navigate(text ? `${pathname}?${text}` : pathname);
  };
  return (
    <span className="inline-flex h-8 items-stretch rounded-full bg-surface ring-1 ring-line-2 ring-inset">
      <button
        type="button"
        aria-pressed={choice.shown}
        title={choice.shown ? 'Hide the requesters' : 'Show the requesters'}
        onClick={() => choose({ ...choice, shown: !choice.shown })}
        className={cx(
          'inline-flex cursor-pointer items-center gap-1.5 rounded-l-full pr-2 pl-3 text-sm font-semibold transition-colors duration-150 hover:bg-surface-2',
          choice.shown ? 'text-ink' : 'text-dim',
        )}
      >
        <Contact size={14} aria-hidden="true" className={choice.shown ? 'text-blue' : 'text-dim'} />
        Requesters
        {choice.shown && <span className="text-xs font-medium text-dim">{choice.window}</span>}
      </button>
      <Menu
        align="end"
        width="w-52"
        trigger={(props) => (
          <button
            type="button"
            {...props}
            aria-label="Requesters' window"
            className="inline-flex cursor-pointer items-center rounded-r-full border-l border-line pr-2.5 pl-1.5 text-dim hover:bg-surface-2 hover:text-ink"
          >
            <ChevronDown size={14} aria-hidden="true" />
          </button>
        )}
      >
        <MenuLabel>Count requests over</MenuLabel>
        {WINDOW_ORDER.map((range) => (
          <MenuItem
            key={range}
            current={choice.shown && choice.window === range}
            onSelect={() => choose({ shown: true, window: range })}
          >
            {WINDOWS[range].label}
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}
