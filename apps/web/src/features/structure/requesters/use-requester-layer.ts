import { type RefObject, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasHandle } from '../../../components/org/ChartCanvas.tsx';
import type { ChartLayout } from '../../../components/org/layout.ts';
import type { ChartBox, FlowFocus } from '../flow/flow-focus.ts';
import {
  layoutRequesters,
  litBy,
  REQUESTER,
  type RequesterHover,
  type RequestersLayout,
  type RequestersLit,
} from './requesters-layout.ts';
import type { ChartRequesters } from './use-requesters.ts';

export interface RequesterLayer {
  /** The column and its links, or undefined when hidden or nobody talked to an agent in the window. */
  readonly layout: RequestersLayout | undefined;
  /** The whole chart with the column, for the canvas, its fit and its framing. */
  readonly width: number;
  readonly height: number;
  /** What a hover or the highlighted flow lights in the column and its links. */
  readonly lit: RequestersLit | undefined;
  /** The chart's people and agents a hover lights (the rest fade), or undefined when nothing is hovered. */
  readonly hovered: ReadonlySet<string> | undefined;
  readonly setHover: (hover: RequesterHover | undefined) => void;
  /** The requester cards that talked to a highlighted flow's members, to frame with them. */
  around(focus: FlowFocus): readonly ChartBox[];
}

/**
 * The Requesters on the org chart's canvas: their column beside `tree` (the tree's layout), the hover (a contact, or an
 * agent with requesters; none while a card is dragged) and what it lights, else what the highlighted flow lights.
 */
export function useRequesterLayer(
  input: ChartRequesters | undefined,
  tree: ChartLayout,
  focus: FlowFocus | undefined,
  dragging: boolean,
): RequesterLayer {
  const contacts = input?.contacts;
  const layout = useMemo(() => (contacts ? layoutRequesters(tree, contacts) : undefined), [tree, contacts]);
  const [rawHover, setHover] = useState<RequesterHover>();
  const hover = dragging ? undefined : rawHover;
  const lit = useMemo(
    () => (layout ? litBy(layout, hover, focus?.members) : undefined),
    [layout, hover, focus],
  );
  const hovering = hover !== undefined && lit !== undefined;
  return {
    layout,
    width: layout?.width ?? tree.width,
    height: layout?.height ?? tree.height,
    lit,
    hovered: hovering ? lit.principals : undefined,
    setHover,
    around: (flow) => {
      if (!layout) return [];
      const linked = litBy(layout, undefined, flow.members);
      return layout.cards
        .filter((card) => linked?.contacts.has(card.contact.contact.id))
        .map((card) => ({ x: card.x, y: card.y, width: REQUESTER.width, height: REQUESTER.height }));
    },
  };
}

/**
 * The whole canvas fitted again once the Requesters are switched on (and read) or off, so the column is seen at once;
 * not on the first view, nor when the live data moves the column.
 */
export function useFitOnToggle(
  input: ChartRequesters | undefined,
  canvas: RefObject<CanvasHandle | null>,
  size: { readonly width: number; readonly height: number },
): void {
  const shown = input !== undefined;
  const last = useRef(shown);
  const wanted = useRef(false);
  if (last.current !== shown) {
    last.current = shown;
    wanted.current = true;
  }
  const settled = !shown || input.contacts !== undefined;
  const { width, height } = size;
  useEffect(() => {
    if (!wanted.current || !settled) return;
    wanted.current = false;
    canvas.current?.fitTo({ x: 0, y: 0, width, height });
  }, [settled, canvas, width, height]);
}
