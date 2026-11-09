import { friendlyMessage, isApiError } from '../../api/errors.ts';

/**
 * The folder browser's path helpers (docs/machines.md, "The folder browser"): the default home folder for an agent, the
 * breadcrumbs of a folder, a new folder's name, and the refusals in plain words.
 */

/** Where an agent's home folder goes by default: `<agentsRoot>/<slug>` (`~/agents/scout`, or `/work/scout`). */
export const suggestedHome = (agentsRoot: string, slug: string): string =>
  `${agentsRoot.replace(/\/+$/, '')}/${slug}`;

/** `name` inside the folder `path`. */
export const joinFolder = (path: string, name: string): string =>
  path === '/' ? `/${name}` : `${path.replace(/\/+$/, '')}/${name}`;

/** The folder above an absolute path; null at `/` or for a path that is not absolute. */
export function parentFolder(path: string): string | null {
  const trimmed = path.trim().replace(/\/+$/, '');
  if (!trimmed.startsWith('/')) return null;
  return trimmed.slice(0, trimmed.lastIndexOf('/')) || '/';
}

export interface Crumb {
  readonly label: string;
  readonly path: string;
}

/** The folders from the top (`/`, or the container's root) down to `path`, each one a step back. */
export function crumbsOf(path: string, root: string | null): readonly Crumb[] {
  const top = root ?? '/';
  const rest = path === top ? '' : path.slice(top === '/' ? 1 : top.length + 1);
  const crumbs: Crumb[] = [{ label: top, path: top }];
  let at = top;
  for (const name of rest.split('/').filter(Boolean)) {
    at = joinFolder(at, name);
    crumbs.push({ label: name, path: at });
  }
  return crumbs;
}

/** Why a new folder's name will not do, or undefined when it will. */
export function folderNameError(name: string): string | undefined {
  const trimmed = name.trim();
  if (trimmed === '') return 'Give the folder a name.';
  if (trimmed.includes('/')) return 'One folder at a time: a name without /.';
  if (trimmed.startsWith('.')) return 'A name starting with a dot would be hidden here.';
  if (trimmed.length > 255) return 'At most 255 characters.';
  return undefined;
}

/** A folder refusal in plain words; an offline machine says what to do about it. */
export function folderErrorText(error: unknown): string {
  if (isApiError(error, 'machine_offline')) {
    return "This machine's runner is not connected. Start it (or the machine) to browse its folders.";
  }
  return friendlyMessage(error);
}
