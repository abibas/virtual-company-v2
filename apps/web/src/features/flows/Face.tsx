import type { PrincipalRef } from '../../api/flows.ts';
import type { ChartNode } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { AgentIcon } from '../../components/feed/AgentIcon.tsx';
import { NodeAvatar } from '../../components/org/OrgNodeCard.tsx';
import { Avatar, type AvatarSize } from '../../components/ui/Avatar.tsx';

/**
 * A person or an agent a flow names, as the chart draws them: an agent's icon (its image, emoji or face), a person's
 * photo or initials; someone no longer on the chart by their initials.
 */
export function Face({
  who,
  nodes,
  size = 'xs',
  className,
}: {
  readonly who: Pick<PrincipalRef, 'principalId' | 'name'>;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly size?: AvatarSize;
  readonly className?: string;
}) {
  const node = nodes.get(who.principalId);
  const extra = className ? { className } : {};
  if (node?.kind === 'agent') {
    const { agent } = node;
    const subject = {
      id: agent.agentId,
      name: agent.name,
      face: agent.face,
      icon: agent.icon,
      status: agent.status,
    };
    return <AgentIcon agent={subject} size={size} {...extra} />;
  }
  if (node) {
    return (
      <span className={cx('inline-flex shrink-0', className)}>
        <NodeAvatar node={node} size={size} />
      </span>
    );
  }
  return <Avatar name={who.name} size={size} {...extra} />;
}

/** A face and a name on one line. */
export function Who({
  who,
  nodes,
  size = 'xs',
  className,
}: {
  readonly who: Pick<PrincipalRef, 'principalId' | 'name'>;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly size?: AvatarSize;
  readonly className?: string;
}) {
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5', className)}>
      <Face who={who} nodes={nodes} size={size} />
      <span className="truncate">{who.name}</span>
    </span>
  );
}
