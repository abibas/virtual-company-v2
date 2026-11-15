import { type KeyboardEvent, type MouseEvent, type ReactNode, useContext } from 'react';
import type { PrincipalRef } from '../../api/flows.ts';
import type { ChartNode } from '../../api/types.ts';
import { CompanyContext } from '../../app/company.ts';
import { Link, navigate } from '../../app/router.tsx';
import { cx } from '../../components/cx.ts';
import { AgentIcon } from '../../components/feed/AgentIcon.tsx';
import { NodeAvatar } from '../../components/org/OrgNodeCard.tsx';
import { Avatar, type AvatarSize } from '../../components/ui/Avatar.tsx';
import { companyAgentLinks } from '../agents/links.ts';

/**
 * How a face links to its agent's page (T-31): an anchor (the default); `nested` when it sits inside another link or
 * button, where it acts as a link without being an anchor; `false` not at all. A person never links.
 */
export type FaceLink = boolean | 'nested';

/** The page of the agent `node` is, in the company on screen; none for a person, or outside a company (the gallery). */
function useAgentHref(node: ChartNode | undefined): string | undefined {
  const slug = useContext(CompanyContext)?.membership.slug;
  if (node?.kind !== 'agent' || slug === undefined) return undefined;
  return companyAgentLinks(slug).agent({ slug: node.agent.slug, id: node.agent.agentId });
}

/** A click or key that opens the page in a new tab rather than in place. */
const newTab = (event: MouseEvent | KeyboardEvent): boolean =>
  event.metaKey || event.ctrlKey || event.shiftKey || ('button' in event && event.button === 1);

/** Keeps the parent's own click, press and drag (a card, a board column, a sheet) from seeing it. */
const stop = (event: { stopPropagation(): void }) => event.stopPropagation();

/** The link around a face (or a face and a name) to the agent's page; its name on hover. */
function AgentLink({
  href,
  name,
  mode,
  className,
  children,
}: {
  readonly href: string;
  readonly name: string;
  readonly mode: true | 'nested';
  readonly className?: string | undefined;
  readonly children: ReactNode;
}) {
  const look = cx('cursor-pointer transition-opacity hover:opacity-80', className);
  if (mode === true) {
    return (
      <Link to={href} title={name} draggable={false} onClick={stop} onPointerDown={stop} className={look}>
        {children}
      </Link>
    );
  }
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (newTab(event)) window.open(href, '_blank', 'noopener');
    else navigate(href);
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: inside another link, where an <a> may not go.
    <span
      role="link"
      tabIndex={0}
      title={name}
      onClick={open}
      onAuxClick={(event) => event.button === 1 && open(event)}
      onKeyDown={(event) => event.key === 'Enter' && open(event)}
      onPointerDown={stop}
      className={look}
    >
      {children}
    </span>
  );
}

/** A person or an agent's face as the chart draws it, without a link. */
function FaceImage({
  who,
  node,
  size,
  className,
}: {
  readonly who: Pick<PrincipalRef, 'principalId' | 'name'>;
  readonly node: ChartNode | undefined;
  readonly size: AvatarSize;
  readonly className?: string | undefined;
}) {
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

/**
 * A person or an agent a flow names, as the chart draws them: an agent's icon (its image, emoji or face), a person's
 * photo or initials; someone no longer on the chart by their initials. An agent's face links to its page (`link`).
 */
export function Face({
  who,
  nodes,
  size = 'xs',
  className,
  link = true,
}: {
  readonly who: Pick<PrincipalRef, 'principalId' | 'name'>;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly size?: AvatarSize;
  readonly className?: string;
  readonly link?: FaceLink;
}) {
  const node = nodes.get(who.principalId);
  const href = useAgentHref(node);
  const image = <FaceImage who={who} node={node} size={size} className={className} />;
  if (href === undefined || link === false) return image;
  return (
    <AgentLink href={href} name={who.name} mode={link} className="inline-flex shrink-0 rounded-full">
      {image}
    </AgentLink>
  );
}

/** A face and a name on one line; an agent's link to its page (`link`). */
export function Who({
  who,
  nodes,
  size = 'xs',
  className,
  link = true,
}: {
  readonly who: Pick<PrincipalRef, 'principalId' | 'name'>;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  readonly size?: AvatarSize;
  readonly className?: string;
  readonly link?: FaceLink;
}) {
  const node = nodes.get(who.principalId);
  const href = useAgentHref(node);
  const line = cx('inline-flex min-w-0 items-center gap-1.5', className);
  const content = (
    <>
      <FaceImage who={who} node={node} size={size} />
      <span className="truncate">{who.name}</span>
    </>
  );
  if (href === undefined || link === false) return <span className={line}>{content}</span>;
  return (
    <AgentLink href={href} name={who.name} mode={link} className={cx(line, 'hover:underline')}>
      {content}
    </AgentLink>
  );
}
