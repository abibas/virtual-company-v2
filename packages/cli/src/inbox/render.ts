/** The inbox as plain text for `mwc inbox list` (S6b): an aligned table, the most urgent first. */
import type { InboxItem } from '../api/inbox.ts';
import { alignRows } from '../org/render.ts';

/** Each kind's word, as the web's chips say it. */
export const KIND_WORDS: Readonly<Record<string, string>> = {
  signoff: 'Sign-off',
  step: 'Your step',
  escalated: 'Escalated',
  blocked: 'Blocked',
  turn_ended: 'Turn ended',
  question: 'Question',
};

/** `2026-11-11 10:02` of an ISO time. */
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

/**
 * The items as a table: kind, the task's key (or `-` for a question), the title, where it is, who moved it last or asked,
 * since when, and what the caller may do; with the company when the items are across companies (`company` undefined).
 * None: one sentence.
 */
export function inboxText(items: readonly InboxItem[], company: string | undefined): string {
  if (items.length === 0) return `Nothing needs you${company === undefined ? '' : ` in ${company}`}.\n`;
  const across = company === undefined;
  const headers = [
    'KIND',
    'KEY',
    'TITLE',
    'WHERE',
    'FROM',
    'SINCE',
    'YOU MAY',
    ...(across ? ['COMPANY'] : []),
  ];
  return alignRows([
    headers,
    ...items.map((item) => [
      KIND_WORDS[item.kind] ?? item.kind,
      item.task?.key ?? '-',
      item.title,
      item.subtitle,
      item.from?.name ?? '-',
      when(item.at),
      item.actions.join(', ') || '-',
      ...(across ? [item.company.slug] : []),
    ]),
  ]);
}
