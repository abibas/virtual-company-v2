import type { MembershipRole } from '@mwc/shared/enums';
import { grantableRoles } from '@mwc/shared/roles';
import { useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call, friendlyMessage } from '../../api/errors.ts';
import type { Invitation } from '../../api/types.ts';
import { formatDateTime, fromNow } from '../data/format.ts';
import { ConfirmInline } from '../forms/ConfirmInline.tsx';
import { roleName, StatusPill } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';

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
}: Omit<InvitationTableProps, 'invitations' | 'myRole'> & {
  readonly invitation: Invitation;
}) {
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
        <span role="alert" className="max-w-56 text-[12.5px] text-alarm">
          {error}
        </span>
      )}
    </span>
  );
}

/** One pending invitation, with Resend and Revoke when the signed-in person may manage its role. */
function InvitationRow({
  companyId,
  invitation,
  manage,
  onChanged,
  onRevoke,
}: Pick<InvitationTableProps, 'companyId' | 'onChanged'> & {
  readonly invitation: Invitation;
  readonly manage: boolean;
  readonly onRevoke: (invitation: Invitation) => Promise<void>;
}) {
  return (
    <tr className="border-b border-line align-top last:border-b-0">
      <td className="py-3 pr-3">
        <p className="break-all text-ink">{invitation.email}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-dim">
          <StatusPill status={invitation.sent ? 'sent' : 'sending'} />
          <span className="sm:hidden">{roleName(invitation.role)}</span>
        </p>
      </td>
      <td className="py-3 pr-3 text-[13px] text-ink-2 max-sm:hidden">{roleName(invitation.role)}</td>
      <td className="py-3 pr-3 text-[13px] whitespace-nowrap text-ink-2 max-md:hidden">
        <time dateTime={invitation.expiresAt} title={formatDateTime(invitation.expiresAt)}>
          {fromNow(invitation.expiresAt)}
        </time>
      </td>
      <td className="py-3 text-right">
        {manage && (
          <div className="flex flex-wrap items-start justify-end gap-1">
            <ResendButton companyId={companyId} invitation={invitation} onChanged={onChanged} />
            <ConfirmInline
              label="Revoke"
              question={`Revoke the invitation to ${invitation.email}? Its link stops working.`}
              confirmLabel="Revoke"
              onConfirm={() => onRevoke(invitation)}
            />
          </div>
        )}
      </td>
    </tr>
  );
}

/** The pending invitations: who, with which role, whether the email went out, when it expires; resend or revoke. */
export function InvitationTable({ companyId, invitations, myRole, onChanged }: InvitationTableProps) {
  const api = useApi();
  if (invitations.length === 0) {
    return <p className="py-2 text-[13.5px] text-dim">No pending invitations.</p>;
  }
  const revoke = async (invitation: Invitation) => {
    await call(
      api.api.companies[':companyId'].invitations[':invitationId'].$delete({
        param: { companyId, invitationId: invitation.id },
      }),
    );
    onChanged(`The invitation to ${invitation.email} is revoked; its link no longer works.`);
  };
  const manageable = grantableRoles(myRole, 'viewer');
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-line text-[12.5px] text-dim">
          <th scope="col" className="py-2 pr-3 font-medium">
            Email
          </th>
          <th scope="col" className="py-2 pr-3 font-medium max-sm:hidden">
            Role
          </th>
          <th scope="col" className="py-2 pr-3 font-medium max-md:hidden">
            Expires
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {invitations.map((invitation) => (
          <InvitationRow
            key={invitation.id}
            companyId={companyId}
            invitation={invitation}
            manage={manageable.includes(invitation.role)}
            onChanged={onChanged}
            onRevoke={revoke}
          />
        ))}
      </tbody>
    </table>
  );
}
