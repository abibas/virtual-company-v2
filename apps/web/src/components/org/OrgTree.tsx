import { type ReactNode, useSyncExternalStore } from 'react';
import type { OrgTreeNode } from '../../api/types.ts';
import { cx } from '../cx.ts';

type Render = (node: OrgTreeNode) => ReactNode;

/** From this width the tree is drawn as a chart; below it (phones) as an indented list. */
const WIDE = '(min-width: 40rem)';

function subscribeWide(listener: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

const isWide = () => window.matchMedia(WIDE).matches;

/*
 * The geometry the connectors share. On a chart a card is 15rem wide and a line drops from its middle (7.5rem); in a
 * stack the spine runs under the card's face (2rem in, the face's centre) and meets each card at its face's height
 * (2rem down).
 */
const LINE = 'bg-line-2';
const ELBOW = 'border-line-2';

/** The line from the bar above down to one card of a row: a tee for the first and middle ones, a curve for the last. */
function RowConnector({ index, count }: { readonly index: number; readonly count: number }) {
  const drop = <span className={cx('absolute top-0 left-30 h-5 w-px', LINE)} />;
  if (count === 1) return drop;
  if (index === count - 1) {
    return (
      <span
        className={cx(
          'absolute top-0 left-0 h-5 w-[calc(7.5rem+1px)] rounded-tr-xl border-t border-r',
          ELBOW,
        )}
      />
    );
  }
  return (
    <>
      <span className={cx('absolute top-0 right-0 h-px', LINE, index === 0 ? 'left-30' : 'left-0')} />
      {drop}
    </>
  );
}

/** The spine of a stack past one card, and the tick to it; the last card gets a curve instead. */
function StackConnector({ last }: { readonly last: boolean }) {
  if (last) {
    return <span className={cx('absolute -top-2 left-0 h-10 w-4 rounded-bl-xl border-b border-l', ELBOW)} />;
  }
  return (
    <>
      <span className={cx('absolute -top-2 bottom-0 left-0 w-px', LINE)} />
      <span className={cx('absolute top-8 left-0 h-px w-4', LINE)} />
    </>
  );
}

/** Reports listed under their manager, indented along a spine. */
function Stack({ kids, item }: { readonly kids: readonly OrgTreeNode[]; readonly item: Render }) {
  return (
    <ul className="ml-8 flex flex-col gap-2 pt-2">
      {kids.map((kid, index) => (
        <li key={kid.principalId} className="relative pl-4">
          <StackConnector last={index === kids.length - 1} />
          {item(kid)}
        </li>
      ))}
    </ul>
  );
}

/** Reports side by side under a bar, each with its own branch below it. */
function Row({ kids, render }: { readonly kids: readonly OrgTreeNode[]; readonly render: Render }) {
  return (
    <>
      <span aria-hidden="true" className={cx('ml-30 block h-5 w-px', LINE)} />
      <ul className="flex items-start">
        {kids.map((kid, index) => (
          <li key={kid.principalId} className={cx('relative pt-5', index < kids.length - 1 && 'pr-8')}>
            <RowConnector index={index} count={kids.length} />
            <ChartBranch node={kid} render={render} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * One branch of the chart: the card, then its reports. Reports that have reports of their own go side by side;
 * when none of them has any, they stack under their manager, so a wide team stays narrow.
 */
function ChartBranch({ node, render }: { readonly node: OrgTreeNode; readonly render: Render }) {
  const kids = node.children;
  const stacked = kids.length > 0 && kids.every((kid) => kid.children.length === 0);
  return (
    <>
      <div className="w-60">{render(node)}</div>
      {stacked && <Stack kids={kids} item={(kid) => <div className="w-60">{render(kid)}</div>} />}
      {kids.length > 0 && !stacked && <Row kids={kids} render={render} />}
    </>
  );
}

/** One branch of the list: the card at full width, then its reports stacked under it, at every depth. */
function ListBranch({ node, render }: { readonly node: OrgTreeNode; readonly render: Render }) {
  return (
    <>
      {render(node)}
      {node.children.length > 0 && (
        <Stack kids={node.children} item={(kid) => <ListBranch node={kid} render={render} />} />
      )}
    </>
  );
}

/**
 * The org chart as a tree of cards joined by lines: a chart from top to bottom on wide screens (scrolling sideways
 * when it is wider than the page), an indented list with the same cards on phones (`layout` forces one). Several
 * tops (two owners, or a principal whose manager is missing) stand side by side. Nested lists, so a screen reader
 * hears the levels.
 */
export function OrgTree({
  tree,
  renderNode,
  layout = 'auto',
  label = 'Org chart',
  className,
}: {
  readonly tree: readonly OrgTreeNode[];
  /** The card of one principal. */
  readonly renderNode: Render;
  readonly layout?: 'auto' | 'chart' | 'list';
  readonly label?: string;
  readonly className?: string;
}) {
  const wide = useSyncExternalStore(subscribeWide, isWide);
  if (layout === 'chart' || (layout === 'auto' && wide)) {
    return (
      <div className={cx('scroll-quiet overflow-x-auto', className)}>
        <ul aria-label={label} className="flex w-max items-start gap-12 p-1 pb-3">
          {tree.map((node) => (
            <li key={node.principalId}>
              <ChartBranch node={node} render={renderNode} />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <ul aria-label={label} className={cx('flex flex-col gap-3', className)}>
      {tree.map((node) => (
        <li key={node.principalId}>
          <ListBranch node={node} render={renderNode} />
        </li>
      ))}
    </ul>
  );
}
