import type { AgentStatus } from '@mwc/shared/enums';
import type { ReactNode } from 'react';
import type { ChartNode } from '../../api/types.ts';
import { Link } from '../../app/router.tsx';
import { cx } from '../cx.ts';
import { AgentFace } from '../feed/AgentFace.tsx';
import { Avatar, type AvatarSize, initials } from '../ui/Avatar.tsx';
import { Badge, roleName, StatusPill } from '../ui/Badge.tsx';
import { modelLine } from './agent-labels.ts';
import { nodeName, nodeSubtitle } from './chart.ts';

export interface OrgNodeCardProps {
  readonly node: ChartNode;
  /** A person's picture (from the member list); their initials without one. */
  readonly imageUrl?: string | null | undefined;
  /** The signed-in person's own card. */
  readonly you?: boolean;
  /** A top entry whose manager is not on the chart (a flaw the server reports). */
  readonly orphan?: boolean;
  /** The agent's page: the name becomes a link to it. */
  readonly href?: string | undefined;
  /** The card's actions (a menu), top right. */
  readonly actions?: ReactNode;
  /** An editor shown in the card (its title, its manager). */
  readonly children?: ReactNode;
  readonly className?: string;
}

/** An agent's drawn face, muted while it is paused or archived. */
export function AgentAvatar({
  agent,
  size = 'md',
  className,
}: {
  readonly agent: { readonly name: string; readonly face: number; readonly status: AgentStatus };
  readonly size?: AvatarSize;
  readonly className?: string;
}) {
  const face = <AgentFace variant={agent.face} muted={agent.status !== 'active'} />;
  return <Avatar name={agent.name} size={size} fallback={face} {...(className ? { className } : {})} />;
}

/** A place on the chart's face: an agent's drawn face, or a person's picture, else their initials in blue. */
export function NodeAvatar({
  node,
  imageUrl,
  size = 'md',
}: {
  readonly node: ChartNode;
  readonly imageUrl?: string | null | undefined;
  readonly size?: AvatarSize;
}) {
  if (node.kind === 'agent') return <AgentAvatar agent={node.agent} size={size} />;
  const name = nodeName(node);
  const blue = (
    <span className="flex size-full items-center justify-center bg-blue-soft text-blue">
      {initials(name)}
    </span>
  );
  return <Avatar name={name} src={imageUrl} size={size} fallback={blue} />;
}

/** What a card says under its name: a person's role; an agent's status, model and effort; a missing manager. */
function NodeFacts({ node, orphan }: { readonly node: ChartNode; readonly orphan: boolean }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-3">
      {node.kind === 'person' ? (
        <Badge tone="blue" size="sm">
          {roleName(node.person.role)}
        </Badge>
      ) : (
        <>
          <StatusPill status={node.agent.status} size="sm" />
          <span className="min-w-0 truncate font-mono text-2xs text-dim">
            {modelLine(node.agent.model, node.agent.effort)}
          </span>
        </>
      )}
      {orphan && (
        <Badge tone="input" size="sm">
          Manager missing
        </Badge>
      )}
    </div>
  );
}

/**
 * A person or an agent on the org chart: the face, the name and the line under it, the actions, and the facts below.
 * People carry the blue accent and agents the teal one, so the two read apart at a glance.
 */
export function OrgNodeCard(props: OrgNodeCardProps) {
  const { node, imageUrl, you = false, orphan = false, href, actions, children, className } = props;
  const agent = node.kind === 'agent';
  const name = nodeName(node);
  const subtitle = nodeSubtitle(node);
  return (
    <article
      aria-label={`${name}, ${agent ? 'agent' : 'person'}`}
      className={cx(
        'relative w-full min-w-0 rounded-xl bg-surface shadow-card ring-1',
        agent ? 'ring-teal/25' : 'ring-line',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cx('absolute inset-x-4 top-0 h-[3px] rounded-b-full', agent ? 'bg-teal' : 'bg-blue')}
      />
      <div className="flex items-start gap-3 p-3 pb-2.5">
        <NodeAvatar node={node} imageUrl={imageUrl} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-sm font-bold text-ink">
            {href ? (
              <Link to={href} className="rounded-xs hover:text-teal focus-visible:text-teal">
                {name}
              </Link>
            ) : (
              name
            )}
            {you && <span className="ml-1 text-xs font-normal text-dim">(you)</span>}
          </p>
          {subtitle && <p className="truncate text-xs text-dim">{subtitle}</p>}
        </div>
        {actions && <div className="-mt-1 -mr-1 shrink-0">{actions}</div>}
      </div>
      <NodeFacts node={node} orphan={orphan} />
      {children && <div className="border-t border-line p-3">{children}</div>}
    </article>
  );
}
