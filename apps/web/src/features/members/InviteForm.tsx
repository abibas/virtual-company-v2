import type { MembershipRole } from '@mwc/shared/enums';
import { grantableRoles } from '@mwc/shared/roles';
import { Send } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call, friendlyMessage } from '../../api/errors.ts';
import type { Invitation } from '../../api/types.ts';
import { SelectField, TextField } from '../../components/forms/Field.tsx';
import { roleName } from '../../components/ui/Badge.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Panel } from '../../components/ui/Panel.tsx';

interface InviteFormProps {
  readonly companyId: string;
  /** The inviter's role: an owner invites with any role, an admin with any role but owner. */
  readonly myRole: MembershipRole;
  readonly onInvited: (invitation: Invitation) => void;
}

/** Invite someone by email with a role; the sign-in service emails them the link. */
export function InviteForm({ companyId, myRole, onInvited }: InviteFormProps) {
  const api = useApi();
  const roles = grantableRoles(myRole, 'viewer');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MembershipRole>('member');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const invitation = await call(
        api.api.companies[':companyId'].invitations.$post({
          param: { companyId },
          json: { email: email.trim(), role },
        }),
      );
      setEmail('');
      onInvited(invitation);
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
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
          error={error}
        />
        <SelectField
          label="Role"
          value={role}
          onChange={(event) => setRole(event.target.value as MembershipRole)}
          options={roles.map((value) => ({ value, label: roleName(value) }))}
        />
        <Button type="submit" tone="primary" icon={Send} busy={busy} disabled={email.trim() === ''}>
          Send invitation
        </Button>
      </div>
      <p className="text-xs text-dim">
        Owners manage everything, admins manage people, members work in the company, viewers only look.
      </p>
    </form>
  );
}

/** The invitation form in its panel (admins and owners). */
export function InvitePanel(props: InviteFormProps) {
  return (
    <Panel
      title="Invite someone"
      description="They get an email whose link signs them up and adds them here."
    >
      <InviteForm {...props} />
    </Panel>
  );
}
