import type { MembershipRole } from '@mwc/shared/enums';
import { mayRemove } from '@mwc/shared/roles';
import { useApi } from '../../api/context.ts';
import { call } from '../../api/errors.ts';
import type { Member } from '../../api/types.ts';
import { StatusBadge } from '../ui/Badge.tsx';
import { ConfirmInline } from '../ui/ConfirmInline.tsx';
import { formatDate, formatDateTime } from '../ui/format.ts';
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

interface MemberRowProps extends Omit<MemberTableProps, 'members' | 'onLeft'> {
  readonly member: Member;
  readonly onRemove: (member: Member) => Promise<void>;
}

const nameOf = (member: Member) => member.displayName || member.email;

function Avatar({ member }: { readonly member: Member }) {
  if (member.imageUrl) {
    return <img src={member.imageUrl} alt="" className="size-8 shrink-0 rounded-full border border-line" />;
  }
  return (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-2 bg-panel-2 text-[13px] text-ink-2"
    >
      {nameOf(member).slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Leave (one's own row) or remove (when the rules allow), each confirmed in place. */
function RemoveControl({ member, companyName, myRole, myUserId, onRemove }: MemberRowProps) {
  if (member.userId === myUserId) {
    return (
      <ConfirmInline
        label="Leave company"
        question={`Leave ${companyName}? You lose access at once.`}
        confirmLabel="Leave"
        onConfirm={() => onRemove(member)}
      />
    );
  }
  if (!mayRemove(myRole, member.role, false)) return null;
  return (
    <ConfirmInline
      label="Remove"
      question={`Remove ${nameOf(member)}? Their access and API keys here stop at once.`}
      confirmLabel="Remove"
      onConfirm={() => onRemove(member)}
    />
  );
}

function MemberRow(props: MemberRowProps) {
  const { member, companyId, myRole, myUserId, onChanged } = props;
  const self = member.userId === myUserId;
  return (
    <tr className="border-b border-line align-top last:border-b-0">
      <td className="py-3 pr-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <Avatar member={member} />
          <div className="min-w-0">
            <p className="font-medium break-words text-ink">
              {nameOf(member)}
              {self && <span className="ml-1.5 text-[12px] font-normal text-dim">(you)</span>}
            </p>
            <p className="text-[12.5px] break-all text-dim">{member.email}</p>
            <p className="mt-1 sm:hidden">
              <StatusBadge status={member.status} />
            </p>
          </div>
        </div>
      </td>
      <td className="py-3 pr-3">
        <RoleControl
          companyId={companyId}
          member={member}
          myRole={myRole}
          self={self}
          onChanged={() => onChanged(self)}
        />
      </td>
      <td className="py-3 pr-3 max-sm:hidden">
        <StatusBadge status={member.status} />
      </td>
      <td className="py-3 pr-3 text-[13px] whitespace-nowrap text-ink-2 max-md:hidden">
        <time dateTime={member.joinedAt} title={formatDateTime(member.joinedAt)}>
          {formatDate(member.joinedAt)}
        </time>
      </td>
      <td className="py-3 text-right">
        <RemoveControl {...props} />
      </td>
    </tr>
  );
}

/** The people of the company: who they are, their role (changeable when the rules allow), status and start date. */
export function MemberTable({ members, onLeft, ...rest }: MemberTableProps) {
  const api = useApi();
  const remove = async (member: Member) => {
    await call(
      api.api.companies[':companyId'].members[':membershipId'].$delete({
        param: { companyId: rest.companyId, membershipId: member.id },
      }),
    );
    if (member.userId === rest.myUserId) onLeft();
    else rest.onChanged(false);
  };
  return (
    <table className="w-full border-collapse text-left">
      <thead>
        <tr className="border-b border-line text-[12.5px] text-dim">
          <th scope="col" className="py-2 pr-3 font-medium">
            Person
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Role
          </th>
          <th scope="col" className="py-2 pr-3 font-medium max-sm:hidden">
            Status
          </th>
          <th scope="col" className="py-2 pr-3 font-medium max-md:hidden">
            Joined
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            <span className="sr-only">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <MemberRow key={member.id} member={member} onRemove={remove} {...rest} />
        ))}
      </tbody>
    </table>
  );
}
