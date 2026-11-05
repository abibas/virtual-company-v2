import { ArrowUpRight, CornerLeftUp, Ellipsis, Tag } from 'lucide-react';
import { useState } from 'react';
import type { OrgCalls } from '../../api/org.ts';
import type { ChartNode, OrgChart, OrgTreeNode } from '../../api/types.ts';
import { Menu, MenuItem, MenuSeparator } from '../forms/Menu.tsx';
import { nodeName } from '../org/chart.ts';
import { OrgNodeCard } from '../org/OrgNodeCard.tsx';
import { IconButton } from '../ui/IconButton.tsx';
import type { AgentLinks } from './links.ts';
import { ManagerEditor, TitleEditor } from './NodeEditor.tsx';

/** What every card of the chart page needs: the chart, who is looking, and how to change it. */
export interface ChartView {
  readonly chart: OrgChart;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly meUserId: string;
  /** Admins and owners move anyone and title anyone. */
  readonly admin: boolean;
  readonly calls: OrgCalls;
  readonly links: AgentLinks;
  /** A place changed: read the chart (and the team) again. */
  readonly onChanged: () => void;
}

type Edit = 'title' | 'manager';

/** The card's menu: Reports to… (admins), Edit title (admins, or one's own card), Open agent. */
function NodeMenu({
  node,
  canMove,
  canTitle,
  href,
  onEdit,
}: {
  readonly node: ChartNode;
  readonly canMove: boolean;
  readonly canTitle: boolean;
  readonly href: string | undefined;
  readonly onEdit: (edit: Edit) => void;
}) {
  return (
    <Menu
      floating
      align="end"
      width="w-52"
      trigger={(props) => (
        <IconButton {...props} label={`Actions for ${nodeName(node)}`} icon={Ellipsis} size="sm" />
      )}
    >
      {canMove && (
        <MenuItem icon={CornerLeftUp} onSelect={() => onEdit('manager')}>
          Reports to…
        </MenuItem>
      )}
      {canTitle && (
        <MenuItem icon={Tag} onSelect={() => onEdit('title')}>
          Edit title
        </MenuItem>
      )}
      {href && (canMove || canTitle) && <MenuSeparator />}
      {href && (
        <MenuItem icon={ArrowUpRight} href={href}>
          Open agent
        </MenuItem>
      )}
    </Menu>
  );
}

/** One place of the chart page: its card, its menu, and the editor its menu opened. */
export function ChartNodeCard({ place, view }: { readonly place: OrgTreeNode; readonly view: ChartView }) {
  const [edit, setEdit] = useState<Edit>();
  const node = view.nodes.get(place.principalId);
  if (!node) return null;
  const you = node.kind === 'person' && node.person.userId === view.meUserId;
  const href =
    node.kind === 'agent' ? view.links.agent({ slug: node.agent.slug, id: node.agent.agentId }) : undefined;
  const canMove = view.admin;
  const canTitle = view.admin || you;
  const props = {
    node,
    calls: view.calls,
    onCancel: () => setEdit(undefined),
    onSaved: () => {
      setEdit(undefined);
      view.onChanged();
    },
  };
  const editor =
    edit === 'title' ? (
      <TitleEditor {...props} />
    ) : edit === 'manager' ? (
      <ManagerEditor {...props} chart={view.chart} meUserId={view.meUserId} />
    ) : undefined;
  return (
    <OrgNodeCard
      node={node}
      you={you}
      orphan={place.orphan}
      href={href}
      actions={
        (canMove || canTitle || href) && (
          <NodeMenu node={node} canMove={canMove} canTitle={canTitle} href={href} onEdit={setEdit} />
        )
      }
    >
      {editor}
    </OrgNodeCard>
  );
}
