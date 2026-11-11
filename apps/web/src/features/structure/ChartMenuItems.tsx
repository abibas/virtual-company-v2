import type { MembershipRole } from '@mwc/shared/enums';
import { grantableRoles } from '@mwc/shared/roles';
import {
  Archive,
  ArrowUpRight,
  CornerLeftUp,
  Pause,
  Play,
  ShieldCheck,
  Tag,
  UserPlus,
  Users,
  Workflow,
} from 'lucide-react';
import type { ChartNode } from '../../api/types.ts';
import { MenuItem, MenuLabel, MenuSeparator } from '../../components/forms/Menu.tsx';
import { nodeName } from '../../components/org/chart.ts';
import type { ChartFlowItem } from '../flows/access.ts';

/** What a menu item opens in a sheet: a principal's manager, title, role or archiving, or an invitation under someone. */
export type ChartTask =
  | { readonly kind: 'manager' | 'title' | 'role' | 'archive'; readonly principalId: string }
  | { readonly kind: 'invite'; readonly reportsTo: string | null };

/** What the signed-in person may do on the chart. */
export interface ChartAbilities {
  /** Admins and owners move, title, hire, invite, pause and archive. */
  readonly admin: boolean;
  readonly myRole: MembershipRole;
  readonly meUserId: string;
}

/** What the items do: open a sheet, pause or resume an agent, or go to a page. */
export interface ChartActions {
  task(task: ChartTask): void;
  setStatus(agentId: string, status: 'active' | 'paused'): void;
  /** The hire form with the manager chosen. */
  hireHref(reportsTo: string): string;
  agentHref(agent: { readonly slug: string; readonly agentId: string }): string;
  /** The People tab. */
  readonly peopleHref: string;
  /** A manager's flow: open it, or make it (S5.3a); nothing for anyone else. */
  flow(principalId: string): ChartFlowItem | undefined;
}

interface ItemsProps {
  readonly kind: 'more' | 'add';
  /** The card's principal; undefined for the company. */
  readonly node: ChartNode | undefined;
  readonly abilities: ChartAbilities;
  readonly actions: ChartActions;
}

/**
 * Adding under the card: hire an agent (under anyone but the company, since an agent never goes to the top) and invite a
 * person (under a person or the company), headed by whom they will report to.
 */
function AddItems({ node, abilities, actions }: Omit<ItemsProps, 'kind'>) {
  if (!abilities.admin) return null;
  return (
    <>
      <p className="truncate px-2.5 pt-1.5 pb-1 text-xs font-semibold text-dim">
        {node ? `Reporting to ${nodeName(node)}` : 'At the top of the chart'}
      </p>
      {node && (
        <MenuItem icon={UserPlus} href={actions.hireHref(node.principalId)} description="Opens the hire form">
          Hire an agent
        </MenuItem>
      )}
      {node?.kind !== 'agent' && (
        <MenuItem
          icon={Users}
          onSelect={() => actions.task({ kind: 'invite', reportsTo: node?.principalId ?? null })}
          description="They join here once they accept"
        >
          Invite a person
        </MenuItem>
      )}
    </>
  );
}

/** An agent's pause or resume and archive (admins). */
function AgentStatusItems({
  node,
  actions,
}: { readonly node: ChartNode & { kind: 'agent' } } & Pick<ItemsProps, 'actions'>) {
  const { agent } = node;
  const paused = agent.status === 'paused';
  return (
    <>
      <MenuItem
        icon={paused ? Play : Pause}
        onSelect={() => actions.setStatus(agent.agentId, paused ? 'active' : 'paused')}
      >
        {paused ? 'Resume' : 'Pause'}
      </MenuItem>
      <MenuItem
        icon={Archive}
        tone="danger"
        onSelect={() => actions.task({ kind: 'archive', principalId: node.principalId })}
      >
        Archive…
      </MenuItem>
    </>
  );
}

/**
 * A card's menu items. `more` (its ⋯): open it, and a manager's flow (open it, or create it for those who lead the
 * team); change its manager and title (admins; anyone their own title); an agent's pause, resume and archive and a
 * person's role (admins, the roles they may give); then the add items. `add` (its +): hire an agent under it, invite a
 * person under it.
 */
export function ChartMenuItems({ kind, node, abilities, actions }: ItemsProps) {
  if (kind === 'add' || !node) return <AddItems node={node} abilities={abilities} actions={actions} />;
  const you = node.kind === 'person' && node.person.userId === abilities.meUserId;
  const roles = node.kind === 'person' ? grantableRoles(abilities.myRole, node.person.role) : [];
  const task = (kind: 'manager' | 'title' | 'role') => () =>
    actions.task({ kind, principalId: node.principalId });
  const flow = actions.flow(node.principalId);
  return (
    <>
      <MenuLabel>{nodeName(node)}</MenuLabel>
      {node.kind === 'agent' ? (
        <MenuItem icon={ArrowUpRight} href={actions.agentHref(node.agent)}>
          Open agent
        </MenuItem>
      ) : (
        <MenuItem icon={ArrowUpRight} href={actions.peopleHref}>
          Open in People
        </MenuItem>
      )}
      {flow && (
        <MenuItem icon={Workflow} href={flow.href}>
          {flow.label}
        </MenuItem>
      )}
      {abilities.admin && (
        <MenuItem icon={CornerLeftUp} onSelect={task('manager')}>
          Change manager…
        </MenuItem>
      )}
      {(abilities.admin || you) && (
        <MenuItem icon={Tag} onSelect={task('title')}>
          Edit title…
        </MenuItem>
      )}
      {abilities.admin && roles.length > 0 && (
        <MenuItem icon={ShieldCheck} onSelect={task('role')}>
          Change role…
        </MenuItem>
      )}
      {abilities.admin && node.kind === 'agent' && <AgentStatusItems node={node} actions={actions} />}
      {abilities.admin && (
        <>
          <MenuSeparator />
          <AddItems node={node} abilities={abilities} actions={actions} />
        </>
      )}
    </>
  );
}
