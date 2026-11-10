import type { ReactNode } from 'react';
import { cx } from '../../../components/cx.ts';
import { Breadcrumbs, type Crumb } from '../../../components/layout/Breadcrumbs.tsx';

/**
 * Where each part of the chat page sits in its one frame (a grid): the header across the top, the chat list on the
 * left and the open chat on the right from `lg`; stacked header, list, chat below it. The page and the open chat share
 * these, so the open chat's header spans both columns while its thread stays in the right one.
 */
export const CHAT_AREA = {
  frame: 'grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)]',
  header: 'row-start-1 lg:col-span-2',
  list: 'row-start-2 lg:col-start-1',
  body: 'row-start-3 lg:row-start-2 lg:col-start-2',
} as const;

/** The header's controls, one look for all: 32px high, a full radius, a soft grey fill, small bold words. */
export const HEADER_CONTROL =
  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-surface-2 px-3 text-xs font-semibold text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink';

/**
 * The chat page's one header row: the path the person came through (it replaces a back link), the facts about where
 * the agent runs in small text under it, and the controls on the right, all one height. Nothing wraps from `lg` on;
 * the path shortens instead.
 */
export function ChatBar({
  crumbs,
  lead,
  facts,
  controls,
}: {
  readonly crumbs: readonly Crumb[];
  /** Before the path: the agent's face. */
  readonly lead?: ReactNode;
  /** Under the path: the harness, the machine and the folder. */
  readonly facts?: ReactNode;
  /** On the right: the profile, the CLI, Open in…, Chat or Terminal. */
  readonly controls?: ReactNode;
}) {
  return (
    <header
      className={cx(
        CHAT_AREA.header,
        'flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2.5 lg:flex-nowrap',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {lead}
        <div className="grid min-w-0 flex-1 gap-0.5">
          <Breadcrumbs items={crumbs} />
          {facts && <div className="flex min-w-0 items-center gap-x-3 text-xs text-dim">{facts}</div>}
        </div>
      </div>
      {controls && <div className="flex shrink-0 items-center gap-1.5">{controls}</div>}
    </header>
  );
}
