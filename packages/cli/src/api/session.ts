/**
 * From a login to the company it acts in: the key's shape checked, then `GET /api/me`, then the company (`--company`
 * or the `company` argument, else the saved login's, else the only one). `mwc org tree`, `mwc agents list` and the
 * `@mwc/mcp` tools start here, so they word refusals alike; exported as `@mwc/cli/api/session`.
 */
import { apiKeyKind } from '@mwc/shared/api-keys';
import { getMe, type Me, type MeMembership } from '../account/api.ts';
import type { ActiveLogin } from '../credentials.ts';
import type { ApiFailure, Fetch } from './client.ts';

export type { Me, MeMembership } from '../account/api.ts';

/** A checked login and the company it acts in. */
export interface Session {
  readonly server: string;
  readonly key: string;
  readonly me: Me;
  readonly company: MeMembership;
}

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const refuse = (message: string): { ok: false; message: string } => ({ ok: false, message });

/** Where the key came from, as messages say it. */
export const keySource = (login: ActiveLogin) =>
  login.source === 'env' ? 'from MWC_API_KEY' : 'saved by mwc login';

/** Why a key cannot be sent at all (it is not a personal API key), or undefined when it can. */
export function keyProblem(login: ActiveLogin): string | undefined {
  if (apiKeyKind(login.key) === 'personal') return undefined;
  return `the key ${keySource(login)} is not a personal API key (mwc_pk_ and 32 letters or digits)`;
}

/** A failed call as a sentence: a 401 says the key was refused and what to do; anything else is the server's message. */
export function refusal(server: string, failure: ApiFailure): string {
  if (failure.status !== 401) return failure.message;
  return `${server} refused the key (${failure.message}). Make a new key and run mwc login again.`;
}

const slugs = (memberships: readonly MeMembership[]) => memberships.map((m) => m.slug).join(', ');

/**
 * The company to act in: the one named (slug or id), else the saved login's, else the only one. Refused with the slugs
 * the login reaches when the name matches none, or when there are several and none is named (`hint` says how to name
 * one: `--company <slug>`, or the tool's argument).
 */
export function chooseCompany(
  memberships: readonly MeMembership[],
  named: string | undefined,
  savedCompanyId: string | undefined,
  hint: string,
): Outcome<MeMembership> {
  if (memberships.length === 0) {
    return refuse("the key's company is not available any more (deleted, or you are no longer a member)");
  }
  if (named !== undefined) {
    const found = memberships.find((m) => m.slug === named || m.companyId === named);
    if (found) return { ok: true, value: found };
    return refuse(`no company "${named}" for this key; it can reach ${slugs(memberships)}`);
  }
  const saved = memberships.find((m) => m.companyId === savedCompanyId);
  if (saved) return { ok: true, value: saved };
  const [only, ...others] = memberships;
  if (only && others.length === 0) return { ok: true, value: only };
  return refuse(`this key reaches several companies (${slugs(memberships)}); choose one with ${hint}`);
}

/** Checks the key's shape, then `GET /api/me`: who the login acts as, and the companies it reaches. */
export async function checkLogin(fetch: Fetch, login: ActiveLogin): Promise<Outcome<Me>> {
  const problem = keyProblem(login);
  if (problem !== undefined) return refuse(problem);
  const result = await getMe(fetch, login.server, login.key);
  return result.ok ? { ok: true, value: result.me } : refuse(refusal(login.server, result));
}

/** Checks the login (`checkLogin`) and chooses the company (`chooseCompany`). */
export async function openSession(
  fetch: Fetch,
  login: ActiveLogin,
  options: { readonly company?: string | undefined; readonly hint: string },
): Promise<Outcome<Session>> {
  const checked = await checkLogin(fetch, login);
  if (!checked.ok) return checked;
  const me = checked.value;
  const chosen = chooseCompany(me.memberships, options.company, login.saved?.companyId, options.hint);
  if (!chosen.ok) return chosen;
  return { ok: true, value: { server: login.server, key: login.key, me, company: chosen.value } };
}
