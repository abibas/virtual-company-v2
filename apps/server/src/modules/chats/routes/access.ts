import type { MembershipRole } from '@mwc/shared/enums';
import type { MiddlewareHandler } from 'hono';
import type { AuthEnv, MemberEnv } from '../../../platform/auth/actor.ts';
import type { AuthDeps } from '../../../platform/auth/authn.ts';
import { type CompanyPath, companyRoute } from '../../../platform/auth/membership.ts';
import { errorJson, errorResponse } from '../../../platform/http/errors.ts';
import { NOT_IN_CHAT } from '../rules/people.ts';
import { CHAT_NOT_FOUND } from '../rules.ts';
import { seatIn } from '../service/people.ts';

/**
 * The routes of one chat (`/api/companies/{companyId}/chats/{chatId}/…`), locked to its people (2026-11-14,
 * docs/harness.md "Who is in a chat"): after the company's guard, a message chat lets in a member who is in it; a
 * company owner who is not in it only where the route reads (`read`: the chat, its older turns, its stream), and is told
 * to add themselves where it writes (403 `not_in_chat`); anyone else gets the same 404 as an unknown chat. A task's
 * conversation and a team chat keep their own rules, and an unknown chat is the handler's own 404.
 */

/** What a route does with the chat: reads it (an owner may), or writes in it (only its people). */
export type ChatAccess = 'read' | 'write';

/** The guard of a chat's people, after the company's (see above). */
export function chatPeopleGuard(access: ChatAccess): MiddlewareHandler<MemberEnv> {
  return async (c, next) => {
    const { principalId, role } = c.var.membership;
    const seat = await seatIn(c.var.tenant, c.req.param('chatId') ?? '', { principalId, role });
    if (seat === 'none') return errorJson(c, 404, CHAT_NOT_FOUND.code, CHAT_NOT_FOUND.message);
    if (seat === 'owner' && access === 'write')
      return errorJson(c, 403, NOT_IN_CHAT.code, NOT_IN_CHAT.message);
    await next();
  };
}

/** `companyRoute` for a chat's route: its role, then its people's guard, and that guard's refusals in the document. */
export function chatRoute<P extends CompanyPath>(
  deps: AuthDeps,
  route: { readonly role: MembershipRole; readonly path: P; readonly access: ChatAccess },
) {
  const { base, refusals } = companyRoute(deps, { role: route.role, path: route.path, tag: 'chats' });
  const [authn, member] = base.middleware;
  const middleware: [MiddlewareHandler<AuthEnv>, MiddlewareHandler<MemberEnv>, MiddlewareHandler<MemberEnv>] =
    [authn, member, chatPeopleGuard(route.access)];
  const owners = route.access === 'write' ? ', or an owner who is not in the chat (`not_in_chat`)' : '';
  return {
    base: { ...base, middleware },
    refusals: {
      ...refusals,
      403: errorResponse(`The caller's role is below ${route.role} (\`forbidden\`)${owners}`),
    },
  };
}
