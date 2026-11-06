import type { MembershipRole } from '@mwc/shared/enums';
import { friendlyMessage } from '../../api/errors.ts';
import type { Member } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { LoadState } from '../../components/data/LoadState.tsx';
import type { NoticeTone } from '../../components/ui/Notice.tsx';
import { Panel } from '../../components/ui/Panel.tsx';
import { SkeletonRows } from '../../components/ui/Skeleton.tsx';
import { MemberTable } from './MemberTable.tsx';
import { SyncButton, syncSummary } from './SyncButton.tsx';

interface PeoplePanelProps {
  readonly companyId: string;
  readonly companyName: string;
  readonly members: Loaded<{ readonly members: readonly Member[] }>;
  readonly myRole: MembershipRole;
  readonly myUserId: string;
  /** Admins and owners get Sync now. */
  readonly admin: boolean;
  readonly onNotice: (tone: NoticeTone, text: string) => void;
  /** After Sync now: reload the invitations and the session too. */
  readonly onSynced: () => void;
  readonly onChanged: (self: boolean) => void;
  readonly onLeft: () => void;
}

/** The member list, with Sync now for admins and owners. */
export function PeoplePanel({ members, admin, onNotice, onSynced, ...table }: PeoplePanelProps) {
  const sync = admin && (
    <SyncButton
      companyId={table.companyId}
      onSynced={(result) => {
        onNotice('info', syncSummary(result));
        members.reload();
        onSynced();
      }}
      onFailed={(error) => onNotice('error', friendlyMessage(error))}
    />
  );
  return (
    <Panel title="People" description="Everyone in the company and what they may do." actions={sync}>
      <LoadState loaded={members} label="Loading members…" skeleton={<SkeletonRows />}>
        {(data) => <MemberTable members={data.members} {...table} />}
      </LoadState>
    </Panel>
  );
}
