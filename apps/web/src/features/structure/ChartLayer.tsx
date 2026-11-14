import { Ellipsis, Plus } from 'lucide-react';
import type { PointerEvent, ReactNode } from 'react';
import type { ChartNode } from '../../api/types.ts';
import { cx } from '../../components/cx.ts';
import { ChartCard, COMPANY } from '../../components/org/ChartCard.tsx';
import { ChartLines } from '../../components/org/ChartLines.tsx';
import { CompanyCard, type CompanyCardProps } from '../../components/org/CompanyCard.tsx';
import { nodeName } from '../../components/org/chart.ts';
import type { ChartLayout } from '../../components/org/layout.ts';
import { IconButton } from '../../components/ui/IconButton.tsx';
import type { MenuAt } from './ChartMenu.tsx';
import { type DropPlan, stateAt } from './drop-targets.ts';
import { FlowTags, ringOf } from './flow/FlowTags.tsx';
import type { FlowFocus } from './flow/flow-focus.ts';

/** A card's buttons: + (hire or invite under it; admins, on hover or focus) and ⋯ (its menu). */
export function CardButtons({
  target,
  name,
  add,
  more,
  open,
  onOpen,
}: {
  readonly target: string;
  readonly name: string;
  readonly add: boolean;
  readonly more: boolean;
  /** The menu open now, if any. */
  readonly open: MenuAt | undefined;
  readonly onOpen: (at: MenuAt | undefined) => void;
}) {
  const toggle = (kind: MenuAt['kind']) => (event: { currentTarget: HTMLElement }) => {
    const same = open?.kind === kind && open.target === target;
    onOpen(same ? undefined : { kind, target, trigger: event.currentTarget });
  };
  const expanded = (kind: MenuAt['kind']) => open?.kind === kind && open.target === target;
  return (
    <>
      {add && (
        <IconButton
          label={`Add someone reporting to ${name}`}
          icon={Plus}
          size="sm"
          aria-haspopup="menu"
          aria-expanded={expanded('add')}
          onClick={toggle('add')}
          className={cx(
            'opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100 max-sm:opacity-100',
            expanded('add') && 'opacity-100',
          )}
        />
      )}
      {more && (
        <IconButton
          label={`Actions for ${name}`}
          icon={Ellipsis}
          size="sm"
          aria-haspopup="menu"
          aria-expanded={expanded('more')}
          onClick={toggle('more')}
        />
      )}
    </>
  );
}

export interface ChartLayerProps {
  readonly layout: ChartLayout;
  readonly nodes: ReadonlyMap<string, ChartNode>;
  /** The tops whose manager is not on the chart. */
  readonly orphans: ReadonlySet<string>;
  readonly company: Omit<CompanyCardProps, 'drop' | 'actions'>;
  /** While a card is dragged: where it may go, and the place under the pointer. */
  readonly plan: DropPlan | undefined;
  readonly over: string | undefined;
  readonly meUserId: string;
  readonly draggable: boolean;
  readonly grab: (principalId: string) => (event: PointerEvent<HTMLElement>) => void;
  /** A card's buttons (the company's with `COMPANY`). */
  readonly buttons: (target: string, node: ChartNode | undefined) => ReactNode;
  readonly agentHref: (node: ChartNode & { kind: 'agent' }) => string;
  /** A highlighted flow: its members ringed with their roles, everyone else faded; and the lines that join them. */
  readonly focus?: { readonly flow: FlowFocus; readonly edges: ReadonlySet<string> } | undefined;
  /** What a hovered requester (or an agent's requesters) lights: these cards stay, the rest and every line fade. */
  readonly hovered?: ReadonlySet<string> | undefined;
  /** The pointer entered or left an agent's card (its requesters light up). */
  readonly onAgentHover?: ((principalId: string | undefined) => void) | undefined;
}

const NO_EDGES: ReadonlySet<string> = new Set();

/** Where a card sits; outside a highlighted flow it fades and greys, in its place. */
const PLACE = 'absolute transition-[opacity,filter] duration-200 motion-reduce:transition-none';
const FADED = 'opacity-40 saturate-0';

/**
 * What the canvas zooms: the lines, then each card where the layout puts it (the company on top), each a drop target
 * while another card is dragged, and draggable itself for admins and owners. A highlighted flow rings its members and
 * fades the rest; a hovered requester fades all but the agents they talked to, with the same fade.
 */
export function ChartLayer(props: ChartLayerProps) {
  const { layout, nodes, plan, over, buttons, focus, hovered, onAgentHover } = props;
  const faded = plan ? new Set([plan.principalId]) : undefined;
  const kept = hovered ?? focus?.flow.members;
  const place = (id: string) => cx(PLACE, kept && !kept.has(id) && FADED);
  const hoverOf = (node: ChartNode) =>
    node.kind === 'agent' && onAgentHover
      ? {
          onPointerEnter: () => onAgentHover(node.principalId),
          onPointerLeave: () => onAgentHover(undefined),
        }
      : {};
  const accentOf = (id: string) => {
    const roles = focus?.flow.members.get(id);
    return roles && { ring: ringOf(roles), tags: <FlowTags roles={roles} /> };
  };
  return (
    <>
      <ChartLines layout={layout} faded={faded} emphasis={hovered ? NO_EDGES : focus?.edges} />
      {layout.cards.map((card) => {
        const node = nodes.get(card.id);
        const style = { left: card.x, top: card.y };
        if (card.id === COMPANY) {
          return (
            <div key={card.id} className={place(card.id)} style={style}>
              <CompanyCard
                {...props.company}
                drop={stateAt(plan, COMPANY, over)}
                actions={buttons(COMPANY, undefined)}
              />
            </div>
          );
        }
        if (!node) return null;
        return (
          <div key={card.id} className={place(card.id)} style={style} {...hoverOf(node)}>
            <ChartCard
              accent={accentOf(node.principalId)}
              node={node}
              you={node.kind === 'person' && node.person.userId === props.meUserId}
              orphan={props.orphans.has(node.principalId)}
              href={node.kind === 'agent' ? props.agentHref(node) : undefined}
              actions={buttons(node.principalId, node)}
              drop={stateAt(plan, node.principalId, over)}
              draggable={props.draggable}
              onPointerDown={props.grab(node.principalId)}
            />
          </div>
        );
      })}
    </>
  );
}

/** The card under the pointer while dragging: the face's name and where a drop would put it, or why not. */
export function DragGhost({
  node,
  x,
  y,
  hint,
  refused,
}: {
  readonly node: ChartNode;
  readonly x: number;
  readonly y: number;
  readonly hint: string;
  readonly refused: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      style={{ left: x + 14, top: y + 14 }}
      className="pointer-events-none fixed z-50 flex max-w-72 flex-col gap-0.5 rounded-xl bg-surface px-3 py-2 shadow-float ring-1 ring-line"
    >
      <span className="truncate text-sm font-bold text-ink">{nodeName(node)}</span>
      <span className={cx('text-xs', refused ? 'font-medium text-failed' : 'text-dim')}>{hint}</span>
    </div>
  );
}
