import type { MembershipRole } from '@mwc/shared/enums';
import type { Invitation } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { LoadState } from '../data/LoadState.tsx';
import { Panel } from '../ui/Panel.tsx';
import { InvitationTable } from './InvitationTable.tsx';
import { SCROLL_X } from './PeoplePanel.tsx';

/** The pending invitations (admins and owners), with resend and revoke. */
export function InvitationsPanel({
  companyId,
  invitations,
  myRole,
  onChanged,
}: {
  readonly companyId: string;
  readonly invitations: Loaded<{ readonly invitations: readonly Invitation[] }>;
  readonly myRole: MembershipRole;
  /** An invitation was resent or revoked: what happened, in a sentence. */
  readonly onChanged: (text: string) => void;
}) {
  return (
    <Panel title="Pending invitations" description="Invitations expire 14 days after they are sent.">
      <LoadState loaded={invitations} label="Loading invitations…">
        {(data) => (
          <div className={SCROLL_X}>
            <InvitationTable
              companyId={companyId}
              invitations={data.invitations}
              myRole={myRole}
              onChanged={(text) => {
                onChanged(text);
                invitations.reload();
              }}
            />
          </div>
        )}
      </LoadState>
    </Panel>
  );
}
