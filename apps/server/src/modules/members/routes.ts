import type { ServerDeps } from '../../platform/env.ts';
import { invitationRoutes } from './routes/invitations.ts';
import { memberRoutes } from './routes/members.ts';
import type { MembersDeps } from './service.ts';

/**
 * A company's people: the member list, role changes and removals (`routes/members.ts`), and invitations: invite,
 * list, resend and revoke (`routes/invitations.ts`). A removal moves people on the org chart (`chart`).
 */
export function membersRoutes(deps: ServerDeps & MembersDeps) {
  return memberRoutes(deps).route('/', invitationRoutes(deps));
}
