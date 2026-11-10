import type { MembershipRole } from '@mwc/shared/enums';
import { Archive } from 'lucide-react';
import { useState } from 'react';
import { friendlyMessage } from '../../api/errors.ts';
import type { OrgCalls } from '../../api/org.ts';
import type { ChartNode, Invitation, Member, OrgChart } from '../../api/types.ts';
import { Sheet } from '../../components/layout/Drawer.tsx';
import { nodeName } from '../../components/org/chart.ts';
import { Button } from '../../components/ui/Button.tsx';
import { ManagerEditor, TitleEditor } from '../agents/NodeEditor.tsx';
import { RoleControl } from '../members/RoleControl.tsx';
import type { ChartTask } from './ChartMenuItems.tsx';
import { InviteSheet } from './InviteSheet.tsx';

export interface ChartSheetProps {
  readonly task: ChartTask;
  readonly companyId: string;
  readonly chart: OrgChart;
  readonly calls: OrgCalls;
  readonly myRole: MembershipRole;
  readonly meUserId: string;
  readonly onClose: () => void;
  /** Something changed: read the chart again (`self`: the signed-in person's own role). */
  readonly onChanged: (self?: boolean) => void;
  readonly onInvited: (invitation: Invitation, managerName: string | undefined) => void;
}

/** A person on the chart as the member list shows them, for their role control. */
function memberOf(node: ChartNode & { kind: 'person' }): Member {
  const { person } = node;
  return {
    id: person.membershipId,
    userId: person.userId,
    principalId: node.principalId,
    displayName: person.displayName,
    email: person.email,
    imageUrl: person.imageUrl,
    role: person.role,
    status: 'active',
    joinedAt: '',
  };
}

/** Archiving an agent, asked first: it leaves the chart and its reports move up to its manager. */
function ArchiveAgent({
  node,
  calls,
  onClose,
  onChanged,
}: { readonly node: ChartNode & { kind: 'agent' } } & Pick<
  ChartSheetProps,
  'calls' | 'onClose' | 'onChanged'
>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const archive = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await calls.update(node.agent.agentId, { status: 'archived' });
      onChanged();
      onClose();
    } catch (failure) {
      setError(friendlyMessage(failure));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-2">
        {node.agent.name} leaves the chart and takes no more work. Whoever reports to it moves up to its
        manager. You can bring it back from its page.
      </p>
      {error && (
        <p role="alert" className="text-sm font-medium text-failed">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button tone="quiet" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button tone="danger" icon={Archive} busy={busy} onClick={() => void archive()}>
          Archive {node.agent.name}
        </Button>
      </div>
    </div>
  );
}

const TITLES = {
  manager: ['Change manager', 'Who they report to. The places the org rules refuse are shown, not offered.'],
  title: ['Edit title', 'The title the chart shows under the name; empty clears it.'],
  role: ['Change role', 'Owners manage everything, admins manage people, members work, viewers only look.'],
  archive: ['Archive agent', undefined],
} as const;

/** The sheet a card's menu opened: its manager, its title, a person's role, archiving an agent, or an invitation. */
export function ChartSheet(props: ChartSheetProps) {
  const { task, chart, calls, meUserId, onClose, onChanged } = props;
  if (task.kind === 'invite') return <InviteSheet {...props} reportsTo={task.reportsTo} />;
  const node = chart.nodes.find((n) => n.principalId === task.principalId);
  if (!node) return null;
  const [title, description] = TITLES[task.kind];
  const saved = () => {
    onChanged();
    onClose();
  };
  const editor = { node, calls, onSaved: saved, onCancel: onClose };
  return (
    <Sheet open onClose={onClose} title={`${title}: ${nodeName(node)}`} description={description}>
      {task.kind === 'manager' && <ManagerEditor {...editor} chart={chart} meUserId={meUserId} />}
      {task.kind === 'title' && <TitleEditor {...editor} />}
      {task.kind === 'role' && node.kind === 'person' && (
        <RoleControl
          companyId={props.companyId}
          member={memberOf(node)}
          myRole={props.myRole}
          self={node.person.userId === meUserId}
          onChanged={() => {
            onChanged(node.person.userId === meUserId);
            onClose();
          }}
        />
      )}
      {task.kind === 'archive' && node.kind === 'agent' && (
        <ArchiveAgent node={node} calls={calls} onClose={onClose} onChanged={onChanged} />
      )}
    </Sheet>
  );
}
