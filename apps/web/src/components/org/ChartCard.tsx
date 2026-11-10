import { Server } from 'lucide-react';
import type { PointerEvent, ReactNode } from 'react';
import type { ChartNode } from '../../api/types.ts';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';
import { AgentIcon } from '../feed/AgentIcon.tsx';
import type { AvatarSize } from '../ui/Avatar.tsx';
import { Badge, roleName } from '../ui/Badge.tsx';
import { harnessLabel, runsLine } from './agent-labels.ts';
import { DRAGGABLE } from './ChartCanvas.tsx';
import { nodeName, nodeSubtitle } from './chart.ts';
import { CARD } from './layout.ts';
import { NodeAvatar } from './OrgNodeCard.tsx';

/**
 * How a card reads while another card is dragged: a place it may go (`valid`, `over` under the pointer), one the org
 * rules refuse (`refused`), its manager now (`current`), or the card being dragged itself (`source`).
 */
export type DropState = 'valid' | 'over' | 'refused' | 'current' | 'source';

/** The attribute a drop target carries: a principal's id, or `COMPANY` for the top of the chart. */
export const DROP_ID = 'data-drop-id';
export const COMPANY = 'company';

export const DROP_LOOK: Readonly<Record<DropState, string>> = {
  valid: 'outline-2 outline-offset-4 outline-dashed outline-blue/60',
  over: 'ring-2 ring-blue shadow-raised scale-[1.03]',
  refused: 'opacity-35 saturate-50',
  current: 'outline-2 outline-offset-4 outline-dashed outline-line-2',
  source: 'opacity-40',
};

/** An agent's icon on its card (its image, emoji or drawn face, muted while paused): the one place the chart draws it. */
function AgentMark({ agent, size }: { readonly agent: AgentOf; readonly size: AvatarSize }) {
  const { agentId: id, name, face, icon, status } = agent;
  return <AgentIcon agent={{ id, name, face, icon, status }} size={size} />;
}

type AgentOf = Extract<ChartNode, { kind: 'agent' }>['agent'];

/** The face with a status dot for an agent: green while it is active, amber while it is paused. */
function Face({ node }: { readonly node: ChartNode }) {
  if (node.kind === 'person') return <NodeAvatar node={node} />;
  return (
    <span className="relative inline-flex shrink-0">
      <AgentMark agent={node.agent} size="md" />
      <span
        aria-hidden="true"
        className={cx(
          'absolute right-0 bottom-0 size-3 rounded-full ring-2 ring-surface',
          node.agent.status === 'active' ? 'bg-done' : 'bg-input',
        )}
      />
    </span>
  );
}

/** The card's last lines: a person's role (and You); an agent's harness, model and effort, and its machine. */
function Facts({
  node,
  you,
  orphan,
}: {
  readonly node: ChartNode;
  readonly you: boolean;
  readonly orphan: boolean;
}) {
  const missing = orphan && (
    <Badge tone="input" size="sm">
      Manager missing
    </Badge>
  );
  if (node.kind === 'person') {
    return (
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        <Badge tone="blue" size="sm">
          {roleName(node.person.role)}
        </Badge>
        {you && (
          <Badge tone="blue" variant="solid" size="sm">
            You
          </Badge>
        )}
        {missing}
        {node.title && node.person.displayName && (
          <span className="min-w-0 truncate text-2xs text-dim">{node.person.email}</span>
        )}
      </div>
    );
  }
  const { agent } = node;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
        {agent.status === 'paused' && (
          <Badge tone="input" size="sm">
            Paused
          </Badge>
        )}
        {missing}
        <span className="min-w-0 truncate font-mono text-2xs text-ink-2">
          {harnessLabel(agent.harness)} · {runsLine(agent.runsWith)}
        </span>
      </div>
      <span className="flex min-w-0 items-center gap-1 text-2xs text-dim">
        <Server size={11} aria-hidden="true" className="shrink-0" />
        <span className="truncate">{agent.placement ? agent.placement.machineName : 'No machine yet'}</span>
      </span>
    </div>
  );
}

export interface ChartCardProps {
  readonly node: ChartNode;
  readonly you: boolean;
  readonly orphan: boolean;
  /** The agent's page: the name links to it. */
  readonly href?: string | undefined;
  /** The card's buttons, top right (its menu). */
  readonly actions?: ReactNode;
  readonly drop?: DropState | undefined;
  /** Admins and owners drag cards to another manager. */
  readonly draggable: boolean;
  readonly onPointerDown?: ((event: PointerEvent<HTMLElement>) => void) | undefined;
}

/**
 * A person or an agent on the chart canvas, compact and of one size (`CARD`): the face (an agent's with its status
 * dot), the name, the title or role, and a line of facts. People carry the blue accent and agents the teal one. A
 * drop target while another card is dragged, and draggable itself for admins and owners.
 */
export function ChartCard({
  node,
  you,
  orphan,
  href,
  actions,
  drop,
  draggable,
  onPointerDown,
}: ChartCardProps) {
  const agent = node.kind === 'agent';
  const name = nodeName(node);
  const subtitle = nodeSubtitle(node);
  return (
    <article
      aria-label={`${name}, ${agent ? 'agent' : 'person'}`}
      {...{ [DROP_ID]: node.principalId, ...(draggable ? { [DRAGGABLE]: '' } : {}) }}
      onPointerDown={onPointerDown}
      style={{ width: CARD.width, height: CARD.height }}
      className={cx(
        'group/card relative flex flex-col gap-2 rounded-xl bg-surface p-3 shadow-card ring-1 transition-[opacity,transform,box-shadow] duration-150 [-webkit-touch-callout:none]',
        agent ? 'ring-teal/30' : 'ring-line',
        draggable && 'cursor-grab active:cursor-grabbing',
        drop && DROP_LOOK[drop],
      )}
    >
      <span
        aria-hidden="true"
        className={cx('absolute inset-x-4 top-0 h-[3px] rounded-b-full', agent ? 'bg-teal' : 'bg-blue')}
      />
      <div className="flex min-w-0 items-start gap-2.5">
        <Face node={node} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="line-clamp-2 text-sm leading-tight font-bold break-words text-ink" title={name}>
            {href ? (
              <Link
                to={href}
                draggable={false}
                className="rounded-xs hover:text-teal focus-visible:text-teal"
              >
                {name}
              </Link>
            ) : (
              name
            )}
          </p>
          {subtitle && <p className="truncate text-xs text-dim">{subtitle}</p>}
        </div>
        {actions && <div className="-mt-1 -mr-1 flex shrink-0 items-center">{actions}</div>}
      </div>
      <div className="mt-auto min-w-0">
        <Facts node={node} you={you} orphan={orphan} />
      </div>
    </article>
  );
}
