/**
 * The org chart canvas's layout: where each card sits and how the lines join them, top down. Pure; the canvas draws
 * what this computes. A manager is centred over its reports, which stand side by side with their own teams below
 * them; a manager whose reports have no reports of their own, four or more of them, hangs them in two columns on both
 * sides of one spine (a comb), so a wide team grows down rather than sideways.
 */

/** One place of the tree to lay out: its id and its reports, in order. */
export interface LayoutNode {
  readonly id: string;
  readonly children: readonly LayoutNode[];
}

/** A card's top left corner on the chart. */
export interface PlacedCard {
  readonly id: string;
  readonly x: number;
  readonly y: number;
}

/** A line from a manager to one of its reports, as the corners it turns (an elbow), from the manager down. */
export interface ChartEdge {
  readonly from: string;
  readonly to: string;
  readonly points: readonly (readonly [number, number])[];
}

export interface ChartLayout {
  readonly cards: readonly PlacedCard[];
  readonly edges: readonly ChartEdge[];
  readonly width: number;
  readonly height: number;
}

/** Every card's size, in chart pixels. */
export const CARD = { width: 232, height: 112 } as const;

/** The space between levels (`y`), between teams side by side (`x`), between a comb's rows and from its spine. */
export const GAP = { x: 24, y: 64, row: 16, spine: 24 } as const;

/** From this many reports that have none of their own, a team hangs as a comb. */
export const COMB_FROM = 4;

/** A laid out subtree, relative to its own top left corner; `anchor` is the x of its top card's middle. */
interface Block {
  readonly width: number;
  readonly height: number;
  readonly anchor: number;
  readonly cards: PlacedCard[];
  readonly edges: ChartEdge[];
}

const shiftCard = (card: PlacedCard, dx: number, dy: number): PlacedCard => ({
  id: card.id,
  x: card.x + dx,
  y: card.y + dy,
});

const shiftEdge = (edge: ChartEdge, dx: number, dy: number): ChartEdge => ({
  ...edge,
  points: edge.points.map(([x, y]) => [x + dx, y + dy] as const),
});

/** A card with nobody under it. */
const leaf = (id: string): Block => ({
  width: CARD.width,
  height: CARD.height,
  anchor: CARD.width / 2,
  cards: [{ id, x: 0, y: 0 }],
  edges: [],
});

/** The elbow from a manager's bottom middle down to a report's top middle, turning halfway between the levels. */
function elbow(
  from: string,
  to: string,
  [x1, y1]: readonly [number, number],
  [x2, y2]: readonly [number, number],
) {
  const mid = y1 + GAP.y / 2;
  const points: (readonly [number, number])[] =
    x1 === x2
      ? [
          [x1, y1],
          [x2, y2],
        ]
      : [
          [x1, y1],
          [x1, mid],
          [x2, mid],
          [x2, y2],
        ];
  return { from, to, points };
}

/** Reports side by side under the manager, each with its own team below it; the manager centred over them. */
function row(node: LayoutNode): Block {
  const kids = node.children.map(block);
  const span = kids.reduce((sum, kid) => sum + kid.width, 0) + GAP.x * (kids.length - 1);
  const width = Math.max(CARD.width, span);
  const top = CARD.height + GAP.y;
  let x = (width - span) / 2;
  const at = kids.map((kid) => {
    const left = x;
    x += kid.width + GAP.x;
    return left;
  });
  const first = (at[0] ?? 0) + (kids[0]?.anchor ?? 0);
  const last = (at[kids.length - 1] ?? 0) + (kids[kids.length - 1]?.anchor ?? 0);
  const anchor = (first + last) / 2;
  const cards = [{ id: node.id, x: anchor - CARD.width / 2, y: 0 }];
  const edges: ChartEdge[] = [];
  kids.forEach((kid, index) => {
    const left = at[index] ?? 0;
    const to = node.children[index]?.id ?? '';
    cards.push(...kid.cards.map((card) => shiftCard(card, left, top)));
    edges.push(elbow(node.id, to, [anchor, CARD.height], [left + kid.anchor, top]));
    edges.push(...kid.edges.map((edge) => shiftEdge(edge, left, top)));
  });
  const height = top + Math.max(...kids.map((kid) => kid.height));
  return { width, height, anchor, cards, edges };
}

/** Reports without reports of their own in two columns, left then right, on both sides of a spine from the manager. */
function comb(node: LayoutNode): Block {
  const width = 2 * CARD.width + 2 * GAP.spine;
  const spine = width / 2;
  const rows = Math.ceil(node.children.length / 2);
  const cards: PlacedCard[] = [{ id: node.id, x: spine - CARD.width / 2, y: 0 }];
  const edges = node.children.map((kid, index) => {
    const y = CARD.height + GAP.y + Math.floor(index / 2) * (CARD.height + GAP.row);
    const right = index % 2 === 1;
    cards.push({ id: kid.id, x: right ? width - CARD.width : 0, y });
    const middle = y + CARD.height / 2;
    const side = right ? width - CARD.width : CARD.width;
    const points: (readonly [number, number])[] = [
      [spine, CARD.height],
      [spine, middle],
      [side, middle],
    ];
    return { from: node.id, to: kid.id, points };
  });
  const height = CARD.height + GAP.y + rows * CARD.height + (rows - 1) * GAP.row;
  return { width, height, anchor: spine, cards, edges };
}

function block(node: LayoutNode): Block {
  if (node.children.length === 0) return leaf(node.id);
  const leaves = node.children.every((kid) => kid.children.length === 0);
  return leaves && node.children.length >= COMB_FROM ? comb(node) : row(node);
}

/** The whole chart from its root (the company), in chart pixels from the top left corner. */
export function layoutChart(root: LayoutNode): ChartLayout {
  const { width, height, cards, edges } = block(root);
  return { width, height, cards, edges };
}

/** The SVG path of an edge, its corners rounded by up to `radius` (less where a leg is shorter). */
export function edgePath(points: ChartEdge['points'], radius = 10): string {
  const [start, ...rest] = points;
  if (!start) return '';
  let d = `M ${start[0]} ${start[1]}`;
  rest.forEach((point, index) => {
    const prev = points[index] ?? point;
    const next = rest[index + 1];
    if (!next) {
      d += ` L ${point[0]} ${point[1]}`;
      return;
    }
    const r = Math.min(radius, legOf(prev, point) / 2, legOf(point, next) / 2);
    const [ax, ay] = toward(point, prev, r);
    const [bx, by] = toward(point, next, r);
    d += ` L ${ax} ${ay} Q ${point[0]} ${point[1]} ${bx} ${by}`;
  });
  return d;
}

const legOf = (a: readonly [number, number], b: readonly [number, number]) =>
  Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);

/** The point `r` from `corner` toward `other` along a straight leg. */
function toward(corner: readonly [number, number], other: readonly [number, number], r: number) {
  const length = legOf(corner, other) || 1;
  return [
    corner[0] + ((other[0] - corner[0]) / length) * r,
    corner[1] + ((other[1] - corner[1]) / length) * r,
  ] as const;
}
