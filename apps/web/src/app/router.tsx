import { type ComponentPropsWithRef, type MouseEvent, useEffect, useSyncExternalStore } from 'react';

/**
 * A tiny router for a handful of routes: the History API, a `useLocation()` hook and `<Link>`. Clerk's components
 * navigate through `navigate` too (the Clerk root passes it as `routerPush` / `routerReplace`).
 */

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

const here = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** Goes to `to` (a path, or a URL of this origin) without reloading; another origin is a full navigation. */
export function navigate(to: string, options: { readonly replace?: boolean } = {}): void {
  const url = new URL(to, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.assign(url.href);
    return;
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next === here()) return;
  const samePage = url.pathname === window.location.pathname;
  window.history[options.replace ? 'replaceState' : 'pushState'](null, '', next);
  if (!samePage) window.scrollTo(0, 0);
  for (const listener of listeners) listener();
}

export interface Location {
  readonly pathname: string;
  readonly search: URLSearchParams;
  /** The path with its query and hash, as a `redirect_url`. */
  readonly href: string;
}

/** The current location; the component renders again when it changes. */
export function useLocation(): Location {
  const href = useSyncExternalStore(subscribe, here);
  const url = new URL(href, window.location.origin);
  return { pathname: url.pathname.replace(/(.)\/+$/, '$1'), search: url.searchParams, href };
}

/**
 * The parameters of `pattern` in `pathname`, or null. `:name` matches one segment; a trailing `/*` matches the rest
 * (also nothing) as `*`.
 */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const rest = pattern.endsWith('/*');
  const want = (rest ? pattern.slice(0, -2) : pattern).split('/').filter(Boolean);
  const have = pathname.split('/').filter(Boolean);
  if (have.length < want.length || (!rest && have.length !== want.length)) return null;
  const params: Record<string, string> = {};
  for (const [index, part] of want.entries()) {
    const value = have[index] ?? '';
    if (part.startsWith(':')) params[part.slice(1)] = decodeURIComponent(value);
    else if (part !== value) return null;
  }
  if (rest) params['*'] = have.slice(want.length).join('/');
  return params;
}

const plainClick = (event: MouseEvent<HTMLAnchorElement>) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

/** An anchor that navigates in place on a plain click and keeps every other click (new tab, copy link) native. */
export function Link({ to, onClick, ...rest }: ComponentPropsWithRef<'a'> & { readonly to: string }) {
  return (
    <a
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !plainClick(event) || rest.target === '_blank') return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}

/** Goes to `to` in place of the current entry as soon as it renders. */
export function Redirect({ to }: { readonly to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}
