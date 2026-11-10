import { roleAtLeast } from '@mwc/shared/roles';
import { useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call } from '../../api/errors.ts';
import { useLoad } from '../../api/use-load.ts';
import { useCompany } from '../../app/company.ts';
import { navigate } from '../../app/router.tsx';
import { Notice, type NoticeTone } from '../../components/ui/Notice.tsx';
import { InvitationsPanel } from '../../features/members/InvitationsPanel.tsx';
import { InvitePanel } from '../../features/members/InviteForm.tsx';
import { PeoplePanel } from '../../features/members/PeoplePanel.tsx';

/** The member list, and (admins and owners) the pending invitations. */
function useMembersData(companyId: string, admin: boolean) {
  const api = useApi();
  const members = useLoad(`members:${companyId}`, () =>
    call(api.api.companies[':companyId'].members.$get({ param: { companyId } })),
  );
  const invitations = useLoad(`invitations:${companyId}:${admin}`, () =>
    admin
      ? call(
          api.api.companies[':companyId'].invitations.$get({
            param: { companyId },
            query: { status: 'pending' },
          }),
        )
      : Promise.resolve({ invitations: [] }),
  );
  return { members, invitations };
}

/**
 * The People tab of the Company structure page (`/:slug/structure/people`): the people of the company with their
 * roles; for admins and owners also the invitation form, the pending invitations and Sync now. Viewers and members
 * see the list, and may leave.
 */
export function PeopleTab() {
  const { membership, me, reload } = useCompany();
  const { companyId, role } = membership;
  const admin = roleAtLeast(role, 'admin');
  const { members, invitations } = useMembersData(companyId, admin);
  const [notice, setNotice] = useState<{ readonly tone: NoticeTone; readonly text: string }>();
  const say = (tone: NoticeTone, text: string) => setNotice({ tone, text });
  const reloadMe = () => reload().catch(() => undefined);

  return (
    <div className="grid gap-4 md:gap-5">
      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(undefined)}>
          {notice.text}
        </Notice>
      )}
      {admin && (
        <InvitePanel
          companyId={companyId}
          myRole={role}
          onInvited={(invitation) => {
            say('success', `An invitation is on its way to ${invitation.email}.`);
            invitations.reload();
          }}
        />
      )}
      <PeoplePanel
        companyId={companyId}
        companyName={membership.name}
        members={members}
        myRole={role}
        myUserId={me.user.id}
        admin={admin}
        onNotice={say}
        onSynced={() => {
          invitations.reload();
          void reloadMe();
        }}
        onChanged={(self) => {
          members.reload();
          if (self) void reloadMe();
        }}
        onLeft={() => void reloadMe().then(() => navigate('/', { replace: true }))}
      />
      {admin && (
        <InvitationsPanel
          companyId={companyId}
          invitations={invitations}
          myRole={role}
          onChanged={(text) => say('success', text)}
        />
      )}
    </div>
  );
}
