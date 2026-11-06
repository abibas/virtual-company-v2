import type { MembershipRole } from '@mwc/shared/enums';
import { mayRemove } from '@mwc/shared/roles';
import { useApi } from '../../api/context.ts';
import { call } from '../../api/errors.ts';
import type { Member } from '../../api/types.ts';
import { type Column, DataTable, Primary } from '../../components/data/DataTable.tsx';
import { formatDate, formatDateTime } from '../../components/data/format.ts';
import { ConfirmInline } from '../../components/forms/ConfirmInline.tsx';
import { Avatar } from '../../components/ui/Avatar.tsx';
import { StatusPill } from '../../components/ui/Badge.tsx';
import { RoleControl } from './RoleControl.tsx';

interface MemberTableProps {
  readonly companyId: string;
  readonly companyName: string;
  readonly members: readonly Member[];
  readonly myRole: MembershipRole;
  readonly myUserId: string;
  /** A member's role changed or someone was removed: reload the list (and the session, for one's own role). */
  readonly onChanged: (self: boolean) => void;
  /** The signed-in person left the company. */
  readonly onLeft: () => void;
}

type Context = Omit<MemberTableProps, 'members' | 'onLeft'> & {
  readonly onRemove: (member: Member) => Promise<void>;
};

const nameOf = (member: Member) => member.displayName || member.email;

/** Leave (one's own row) or remove (when the rules allow), each confirmed in place. */
function RemoveControl({ member, ctx }: { readonly member: Member; readonly ctx: Context }) {
  if (member.userId === ctx.myUserId) {
    return (
      <ConfirmInline
        label="Leave company"
        question={`Leave ${ctx.companyName}? You lose access at once.`}
        confirmLabel="Leave"
        onConfirm={() => ctx.onRemove(member)}
      />
    );
  }
  if (!mayRemove(ctx.myRole, member.role, false)) return null;
  return (
    <ConfirmInline
      label="Remove"
      question={`Remove ${nameOf(member)}? Their access and API keys here stop at once.`}
      confirmLabel="Remove"
      onConfirm={() => ctx.onRemove(member)}
    />
  );
}

/** The columns: who, their role (changeable when the rules allow), status, start date, and leave or remove. */
function memberColumns(ctx: Context): readonly Column<Member>[] {
  const self = (member: Member) => member.userId === ctx.myUserId;
  return [
    {
      key: 'person',
      header: 'Person',
      cell: (member) => (
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar name={nameOf(member)} src={member.imageUrl} size="sm" />
          <Primary
            title={
              <>
                {nameOf(member)}
                {self(member) && <span className="ml-1.5 text-xs font-normal text-dim">(you)</span>}
              </>
            }
            subtitle={member.email}
            phone={<StatusPill status={member.status} size="sm" />}
          />
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      cell: (member) => (
        <RoleControl
          companyId={ctx.companyId}
          member={member}
          myRole={ctx.myRole}
          self={self(member)}
          onChanged={() => ctx.onChanged(self(member))}
        />
      ),
    },
    { key: 'status', header: 'Status', hide: 'md', cell: (member) => <StatusPill status={member.status} /> },
    {
      key: 'joined',
      header: 'Joined',
      hide: 'md',
      className: 'whitespace-nowrap',
      cell: (member) => (
        <time dateTime={member.joinedAt} title={formatDateTime(member.joinedAt)}>
          {formatDate(member.joinedAt)}
        </time>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      srOnly: true,
      align: 'right',
      cell: (member) => <RemoveControl member={member} ctx={ctx} />,
    },
  ];
}

/** The people of the company: who they are, their role (changeable when the rules allow), status and start date. */
export function MemberTable({ members, onLeft, ...rest }: MemberTableProps) {
  const api = useApi();
  const onRemove = async (member: Member) => {
    await call(
      api.api.companies[':companyId'].members[':membershipId'].$delete({
        param: { companyId: rest.companyId, membershipId: member.id },
      }),
    );
    if (member.userId === rest.myUserId) onLeft();
    else rest.onChanged(false);
  };
  return (
    <DataTable columns={memberColumns({ ...rest, onRemove })} rows={members} rowKey={(member) => member.id} />
  );
}
