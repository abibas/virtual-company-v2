import type { MembershipRole } from '@mwc/shared/enums';
import { grantableRoles, ROLE_RANK } from '@mwc/shared/roles';
import { useId, useState } from 'react';
import { useApi } from '../../api/context.ts';
import { call, friendlyMessage } from '../../api/errors.ts';
import type { Member } from '../../api/types.ts';
import { Select } from '../forms/Input.tsx';
import { roleName } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';

interface RoleControlProps {
  readonly companyId: string;
  readonly member: Member;
  readonly myRole: MembershipRole;
  /** The row is the signed-in person: lowering their own role asks first. */
  readonly self: boolean;
  readonly onChanged: (member: Member) => void;
}

/** `PATCH .../members/:id {role}`, with its progress and refusal. */
function useRoleChange({
  companyId,
  member,
  onChanged,
}: Pick<RoleControlProps, 'companyId' | 'member' | 'onChanged'>) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const change = async (role: MembershipRole) => {
    setBusy(true);
    setError(undefined);
    try {
      onChanged(
        await call(
          api.api.companies[':companyId'].members[':membershipId'].$patch({
            param: { companyId, membershipId: member.id },
            json: { role },
          }),
        ),
      );
    } catch (failure) {
      setError(friendlyMessage(failure));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, change };
}

/** Lowering one's own role, confirmed in place. */
function SelfDemotion({
  role,
  onCancel,
  onConfirm,
}: {
  readonly role: MembershipRole;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  return (
    <div className="flex max-w-56 flex-col gap-2 rounded-lg bg-failed-soft p-3">
      <p className="text-xs font-medium text-ink">
        Make yourself {roleName(role).toLowerCase()}? You may lose controls on this page.
      </p>
      <div className="flex gap-1.5">
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" tone="danger" onClick={onConfirm}>
          Change my role
        </Button>
      </div>
    </div>
  );
}

/**
 * A member's role: a dropdown with the roles the signed-in person may give (the server's rules, from
 * `@mwc/shared/roles`), plain text otherwise. A refusal (such as the last owner) shows under it in plain words.
 */
export function RoleControl(props: RoleControlProps) {
  const { member, myRole, self } = props;
  const id = useId();
  const { busy, error, change } = useRoleChange(props);
  const [asking, setAsking] = useState<MembershipRole | undefined>();
  const roles = grantableRoles(myRole, member.role);
  if (roles.length === 0 || member.status !== 'active') {
    return <span className="text-sm text-ink-2">{roleName(member.role)}</span>;
  }
  const pick = (role: MembershipRole) => {
    if (role === member.role) return;
    if (self && ROLE_RANK[role] < ROLE_RANK[member.role]) setAsking(role);
    else void change(role);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="sr-only">
        Role of {member.displayName || member.email}
      </label>
      <Select
        id={id}
        size="sm"
        value={asking ?? member.role}
        disabled={busy}
        onChange={(event) => pick(event.target.value as MembershipRole)}
        options={roles.map((role) => ({ value: role, label: roleName(role) }))}
        className="w-32 min-w-28"
      />
      {asking && (
        <SelfDemotion
          role={asking}
          onCancel={() => setAsking(undefined)}
          onConfirm={() => {
            setAsking(undefined);
            void change(asking);
          }}
        />
      )}
      {error && (
        <p role="alert" className="max-w-56 text-xs font-medium text-failed">
          {error}
        </p>
      )}
    </div>
  );
}
