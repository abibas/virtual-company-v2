import type { MembershipRole } from '@mwc/shared/enums';
import { grantableRoles } from '@mwc/shared/roles';
import { Send } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call, friendlyMessage } from '../../api/errors.ts';
import type { Invitation, OrgChart } from '../../api/types.ts';
import { Field, SelectField, TextField } from '../../components/forms/Field.tsx';
import { Sheet } from '../../components/layout/Drawer.tsx';
import { nodeName, TOP } from '../../components/org/chart.ts';
import { PrincipalSelect } from '../../components/org/PrincipalSelect.tsx';
import { roleName } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';

export interface InviteSheetProps {
  readonly companyId: string;
  readonly chart: OrgChart;
  /** The inviter's role: an owner invites with any role, an admin with any role but owner. */
  readonly myRole: MembershipRole;
  readonly meUserId: string;
  /** The manager chosen on the chart: a person's principal, or null for the top. */
  readonly reportsTo: string | null;
  readonly onClose: () => void;
  readonly onInvited: (invitation: Invitation, managerName: string | undefined) => void;
}

/** `POST .../invitations` with the manager, its progress and the server's refusal in plain words. */
function useInvite(companyId: string, onInvited: (invitation: Invitation) => void) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const send = async (body: { email: string; role: MembershipRole; reportsToPrincipalId: string | null }) => {
    setBusy(true);
    setError(undefined);
    try {
      onInvited(
        await call(api.api.companies[':companyId'].invitations.$post({ param: { companyId }, json: body })),
      );
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return { busy, error, send };
}

/** Who the invitee will report to: a person on the chart, or the top (agents are shown, not offered). */
function ManagerField({
  chart,
  meUserId,
  value,
  onChange,
}: {
  readonly chart: OrgChart;
  readonly meUserId: string;
  readonly value: string;
  readonly onChange: (principalId: string) => void;
}) {
  const id = useId();
  return (
    <Field label="Reports to" id={id} hint="People report to people; agents are not offered.">
      <PrincipalSelect
        id={id}
        nodes={chart.nodes}
        tree={chart.tree}
        subject={{ kind: 'person' }}
        value={value}
        onChange={onChange}
        meUserId={meUserId}
      />
    </Field>
  );
}

/** The server's refusal, if any, then Cancel and Send invitation. */
function SendRow({
  error,
  busy,
  ready,
  onCancel,
}: {
  readonly error: string | undefined;
  readonly busy: boolean;
  readonly ready: boolean;
  readonly onCancel: () => void;
}) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm font-medium text-failed">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button tone="quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" tone="primary" icon={Send} busy={busy} disabled={!ready}>
          Send invitation
        </Button>
      </div>
    </>
  );
}

/**
 * Invite a person from the chart: their email, their role, and the person they will report to once they accept
 * (chosen from the card the invitation was asked from; people only, or the top). The sign-in service emails them.
 */
export function InviteSheet({
  companyId,
  chart,
  myRole,
  meUserId,
  reportsTo,
  onClose,
  onInvited,
}: InviteSheetProps) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('member');
  const [manager, setManager] = useState(reportsTo ?? TOP);
  const managerNode = chart.nodes.find((node) => node.principalId === manager);
  const { busy, error, send } = useInvite(companyId, (invitation) =>
    onInvited(invitation, managerNode && nodeName(managerNode)),
  );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send({ email: email.trim(), role, reportsToPrincipalId: manager === TOP ? null : manager });
  };
  const roles = grantableRoles(myRole, 'viewer').map((value) => ({ value, label: roleName(value) }));
  return (
    <Sheet open onClose={onClose} title="Invite a person" description={DESCRIPTION}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          maxLength={320}
          autoComplete="off"
          spellCheck={false}
          placeholder="name@example.com"
          autoFocus
        />
        <SelectField
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value as MembershipRole)}
          options={roles}
        />
        <ManagerField chart={chart} meUserId={meUserId} value={manager} onChange={setManager} />
        <SendRow error={error} busy={busy} ready={email.trim() !== ''} onCancel={onClose} />
      </form>
    </Sheet>
  );
}

const DESCRIPTION =
  'They get an email whose link signs them up, and they join the chart where you place them.';
