/**
 * Atlassian Document Format to Markdown (S7.1c): how an issue's description, a comment or a page's body reads for an
 * agent. Paragraphs, headings, lists (task and decision lists too), code, quotes, panels, rules and tables become their
 * Markdown; text keeps its bold, italics, code, strike-through and links; a mention is "@name", a card its address, a
 * date its day, a status its word, an attachment "[attachment: name]" and a macro "[macro: key]". Anything else gives
 * the text inside it. A body that is no ADF gives nothing; a string is taken as it is.
 */

/** An ADF node as Atlassian sends it: only what the rendering reads. */
export interface AdfNode {
  readonly type: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly marks?: readonly { readonly type: string; readonly attrs?: Readonly<Record<string, unknown>> }[];
  readonly content?: readonly unknown[];
}

const isNode = (value: unknown): value is AdfNode =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

const childrenOf = (node: AdfNode): AdfNode[] => (node.content ?? []).filter(isNode);

const attr = (node: AdfNode, name: string): string | undefined => {
  const value = node.attrs?.[name];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
};

/** A text's marks as Markdown: code innermost, then bold, italics, strike-through and a link around it. */
function marked(text: string, marks: AdfNode['marks']): string {
  let out = text;
  const has = (type: string) => marks?.some((mark) => mark.type === type) === true;
  if (has('code')) out = `\`${out}\``;
  if (has('strong')) out = `**${out}**`;
  if (has('em')) out = `_${out}_`;
  if (has('strike')) out = `~~${out}~~`;
  const link = marks?.find((mark) => mark.type === 'link');
  const href = link?.attrs?.href;
  if (typeof href === 'string') out = `[${out}](${href})`;
  return out;
}

/** A date node's day (its `timestamp` is epoch milliseconds, as a string). */
function dateOf(node: AdfNode): string {
  const at = Number(attr(node, 'timestamp'));
  return Number.isFinite(at) ? new Date(at).toISOString().slice(0, 10) : '';
}

/** One inline node as Markdown. */
function inlineNode(node: AdfNode): string {
  switch (node.type) {
    case 'text':
      return marked(node.text ?? '', node.marks);
    case 'hardBreak':
      return '\n';
    case 'mention': {
      const name = attr(node, 'text') ?? attr(node, 'id') ?? '';
      return name.startsWith('@') ? name : `@${name}`;
    }
    case 'emoji':
      return attr(node, 'text') ?? attr(node, 'shortName') ?? '';
    case 'inlineCard':
      return attr(node, 'url') ?? '';
    case 'date':
      return dateOf(node);
    case 'status':
      return `[${attr(node, 'text') ?? ''}]`;
    default:
      return inline(childrenOf(node));
  }
}

const inline = (nodes: readonly AdfNode[]): string => nodes.map(inlineNode).join('');

/** Lines indented by `pad` after the first, which gets `first`. */
function prefixed(text: string, first: string, pad: string): string {
  return text
    .split('\n')
    .map((line, index) => (index === 0 ? first : line === '' ? '' : pad) + line)
    .join('\n');
}

/** A list's items, each marked by `marker(index, item)`. */
function list(node: AdfNode, marker: (index: number, item: AdfNode) => string): string {
  return childrenOf(node)
    .map((item, index) => {
      const mark = marker(index, item);
      const body = item.type === 'listItem' ? blocks(childrenOf(item), '\n') : block(item);
      return prefixed(body, mark, ' '.repeat(mark.length));
    })
    .join('\n');
}

/** A table: its rows as Markdown's, a separator after the first. */
function table(node: AdfNode): string {
  const rows = childrenOf(node).map((row) =>
    childrenOf(row).map((cell) => blocks(childrenOf(cell), ' ').replace(/\n/g, ' ').replace(/\|/g, '\\|')),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: readonly string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const [head, ...rest] = rows as [string[], ...string[][]];
  return [line(head), line(Array.from({ length: width }, () => '---')), ...rest.map(line)].join('\n');
}

const quoted = (text: string) =>
  text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');

/** One block node as Markdown. */
function block(node: AdfNode): string {
  const children = childrenOf(node);
  switch (node.type) {
    case 'paragraph':
      return inline(children);
    case 'heading':
      return `${'#'.repeat(Math.min(Math.max(Number(attr(node, 'level') ?? 1), 1), 6))} ${inline(children)}`;
    case 'bulletList':
    case 'decisionList':
      return list(node, () => '- ');
    case 'orderedList': {
      const start = Number(attr(node, 'order') ?? 1);
      return list(node, (index) => `${(Number.isFinite(start) ? start : 1) + index}. `);
    }
    case 'taskList':
      return list(node, (_, item) => (attr(item, 'state') === 'DONE' ? '- [x] ' : '- [ ] '));
    case 'taskItem':
    case 'decisionItem':
      return inline(children);
    case 'codeBlock':
      return `\`\`\`${attr(node, 'language') ?? ''}\n${inline(children)}\n\`\`\``;
    case 'blockquote':
      return quoted(blocks(children));
    case 'panel':
      return quoted(`**${attr(node, 'panelType') ?? 'note'}:** ${blocks(children)}`);
    case 'rule':
      return '---';
    case 'table':
      return table(node);
    case 'media':
      return `[attachment: ${attr(node, 'alt') ?? attr(node, 'id') ?? 'file'}]`;
    case 'expand':
    case 'nestedExpand':
      return [`**${attr(node, 'title') ?? 'Details'}**`, blocks(children)].join('\n\n');
    case 'blockCard':
    case 'embedCard':
      return attr(node, 'url') ?? '';
    case 'extension':
    case 'bodiedExtension':
    case 'inlineExtension':
      return `[macro: ${attr(node, 'extensionKey') ?? 'unknown'}]`;
    default:
      return children.some((child) => child.type === 'text') ? inline(children) : blocks(children);
  }
}

/** Blocks joined by `separator` (a blank line), the empty ones left out. */
function blocks(nodes: readonly AdfNode[], separator = '\n\n'): string {
  return nodes
    .map(block)
    .filter((text) => text.trim() !== '')
    .join(separator);
}

/** A body as Markdown (see above). */
export function adfToMarkdown(body: unknown): string {
  if (typeof body === 'string') return body;
  if (!isNode(body)) return '';
  const text = body.type === 'doc' ? blocks(childrenOf(body)) : block(body);
  return text.replace(/\n{3,}/g, '\n\n').trim();
}
