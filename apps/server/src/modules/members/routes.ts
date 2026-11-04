import type { ServerDeps } from '../../platform/env.ts';
import { invitationRoutes } from './routes/invitations.ts';
import { memberRoutes } from './routes/members.ts';

/**
 * A company's people: the member list, role changes and removals (`routes/members.ts`), and invitations: invite,
 * list, resend and revoke (`routes/invitations.ts`).
 */
export function membersRoutes(deps: ServerDeps) {
  return memberRoutes(deps).route('/', invitationRoutes(deps));
}
