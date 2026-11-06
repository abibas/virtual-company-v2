import type { MembershipRole } from '@mwc/shared/enums';
import { grantableRoles } from '@mwc/shared/roles';
import { Mail } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call, friendlyMessage } from '../../api/errors.ts';
import type { Invitation } from '../../api/types.ts';
import { type Column, DataTable, Primary } from '../../components/data/DataTable.tsx';
import { formatDateTime, fromNow } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { roleName, StatusPill } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { EmptyState } from '../../components/ui/EmptyState.tsx';

interface InvitationTableProps {
  readonly companyId: string;
  readonly invitations: readonly Invitation[];
  readonly myRole: MembershipRole;
  /** An invitation was resent or revoked: reload the list, and say what happened. */
  readonly onChanged: (message: string) => void;
}

/** Resend one invitation: a new email, valid for 14 days from now. */
function ResendButton({
  companyId,
  invitation,
  onChanged,
}: Pick<InvitationTableProps, 'companyId' | 'onChanged'> & { readonly invitation: Invitation }) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const resend = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await call(
        api.api.companies[':companyId'].invitations[':invitationId'].resend.$post({
          param: { companyId, invitationId: invitation.id },
        }),
      );
      onChanged(`A new invitation is on its way to ${invitation.email}, valid for 14 days.`);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" tone="quiet" busy={busy} onClick={() => void resend()}>
        Resend
      </Button>
      {error && (
        <span role="alert" className="max-w-56 text-xs font-medium text-failed">
          {error}
        </span>
      )}
    </span>
  );
}

type Context = Pick<InvitationTableProps, 'companyId' | 'onChanged'> & {
  readonly manageable: readonly MembershipRole[];
  readonly onRevoke: (invitation: Invitation) => Promise<void>;
};

/** The columns: who, with which role, whether the email went out, when it expires; resend or revoke. */
function invitationColumns(ctx: Context): readonly Column<Invitation>[] {
  return [
    {
      key: 'email',
      header: 'Email',
      cell: (invitation) => (
        <Primary
          title={invitation.email}
          phone={
            <>
              <StatusPill status={invitation.sent ? 'sent' : 'sending'} size="sm" />
              <span className="sm:hidden">{roleName(invitation.role)}</span>
            </>
          }
        />
      ),
    },
    { key: 'role', header: 'Role', hide: 'sm', cell: (invitation) => roleName(invitation.role) },
    {
      key: 'sent',
      header: 'Delivery',
      hide: 'md',
      cell: (invitation) => <StatusPill status={invitation.sent ? 'sent' : 'sending'} />,
    },
    {
      key: 'expires',
      header: 'Expires',
      hide: 'md',
      className: 'whitespace-nowrap',
      cell: (invitation) => (
        <time dateTime={invitation.expiresAt} title={formatDateTime(invitation.expiresAt)}>
          {fromNow(invitation.expiresAt)}
        </time>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      srOnly: true,
      align: 'right',
      cell: (invitation) =>
        ctx.manageable.includes(invitation.role) && (
          <div className="flex flex-wrap items-start justify-end gap-1">
            <ResendButton companyId={ctx.companyId} invitation={invitation} onChanged={ctx.onChanged} />
            <ConfirmInline
              label="Revoke"
              question={`Revoke the invitation to ${invitation.email}? Its link stops working.`}
              confirmLabel="Revoke"
              onConfirm={() => ctx.onRevoke(invitation)}
            />
          </div>
        ),
    },
  ];
}

/** The pending invitations: who, with which role, whether the email went out, when it expires; resend or revoke. */
export function InvitationTable({ companyId, invitations, myRole, onChanged }: InvitationTableProps) {
  const api = useApi();
  const onRevoke = async (invitation: Invitation) => {
    await call(
      api.api.companies[':companyId'].invitations[':invitationId'].$delete({
        param: { companyId, invitationId: invitation.id },
      }),
    );
    onChanged(`The invitation to ${invitation.email} is revoked; its link no longer works.`);
  };
  const manageable = grantableRoles(myRole, 'viewer');
  return (
    <DataTable
      columns={invitationColumns({ companyId, onChanged, manageable, onRevoke })}
      rows={invitations}
      rowKey={(invitation) => invitation.id}
      empty={
        <EmptyState icon={Mail} tone="input" title="No pending invitations" size="sm">
          Invite someone above; they show here until they accept.
        </EmptyState>
      }
    />
  );
}
