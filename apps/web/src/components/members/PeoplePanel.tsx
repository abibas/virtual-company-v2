import type { MembershipRole } from '@mwc/shared/enums';
import { friendlyMessage } from '../../api/errors.ts';
import type { Member } from '../../api/types.ts';
import type { Loaded } from '../../api/use-load.ts';
import { LoadState } from '../data/LoadState.tsx';
import type { NoticeTone } from '../ui/Notice.tsx';
import { Panel } from '../ui/Panel.tsx';
import { MemberTable } from './MemberTable.tsx';
import { SyncButton, syncSummary } from './SyncButton.tsx';

/** A wide table scrolls on its own at phone width, never the page. */
export const SCROLL_X = '-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0';

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
    <Panel title="People" actions={sync}>
      <LoadState loaded={members} label="Loading members…">
        {(data) => (
          <div className={SCROLL_X}>
            <MemberTable members={data.members} {...table} />
          </div>
        )}
      </LoadState>
    </Panel>
  );
}
