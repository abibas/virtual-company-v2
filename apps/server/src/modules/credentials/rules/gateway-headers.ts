import type { FieldChange } from '@mwc/db';
import type { GatewayHeaderPreview } from '@mwc/shared/credentials';
import type { KindSecret } from '../schemas/secrets.ts';

/**
 * A gateway's headers as its page shows them and changes them (2026-11-13, docs/subscriptions.md "Gateways"). The
 * previews are made from the values when they are sealed and stored beside them (`credentials.header_previews`), so a
 * list never opens a secret; no preview holds a whole value. An edit names the headers the gateway keeps, each new,
 * renamed, given a new value or kept as it is, and is audited by names only.
 */

/** What stands for the hidden middle of a value, and for a short value as a whole. */
export const PREVIEW_MASK = '••••';

/** The authorization schemes kept in front of a preview ("Bearer eyJhbGci••••abcd"), matched in any case. */
const SCHEME = /^(Bearer|Basic|Token|Bot|Digest|ApiKey|Key|DPoP) +(.*)$/i;

/** 16 characters or more: the first 8 and the last 4; 8 to 15: the first 2 and the last 2; fewer: the mask alone. */
function masked(value: string): string {
  const chars = Array.from(value);
  const ends = chars.length >= 16 ? [8, 4] : chars.length >= 8 ? [2, 2] : undefined;
  if (ends === undefined) return PREVIEW_MASK;
  const [head, tail] = ends as [number, number];
  return `${chars.slice(0, head).join('')}${PREVIEW_MASK}${chars.slice(-tail).join('')}`;
}

/** A header value's preview: `agk-NTE5••••MHx8`, `ab••••yz`, `••••`; a scheme word stays in front of its token's. */
export function headerPreview(value: string): string {
  const scheme = SCHEME.exec(value);
  return scheme === null ? masked(value) : `${scheme[1]} ${masked(scheme[2] ?? '')}`;
}

/** Each header's name and preview, in the gateway's order. */
export const previewsOf = (headers: Readonly<Record<string, string>>): GatewayHeaderPreview[] =>
  Object.entries(headers).map(([name, value]) => ({ name, preview: headerPreview(value) }));

/** The preview column a sealed secret writes: a gateway's previews, nothing for the other kinds. */
export const previewColumns = (sealed: KindSecret): { headerPreviews?: GatewayHeaderPreview[] } =>
  sealed.kind === 'gateway' ? { headerPreviews: previewsOf(sealed.secret.headers) } : {};

/**
 * One header a gateway keeps after an edit: its name; `from`, the stored header it continues when that has another name
 * (a rename); and a new value, or none to keep the stored one. A stored header no entry continues is removed.
 */
export interface HeaderEdit {
  readonly name: string;
  readonly from?: string | undefined;
  readonly value?: string | undefined;
}

type HeaderRefusal = {
  readonly ok: false;
  readonly status: 422;
  readonly code: 'header_not_found' | 'header_value_required';
  readonly message: string;
};

/** The headers after an edit, and its audit changes (names only); or why it cannot be made. */
export type EditedHeaders =
  | { readonly ok: true; readonly headers: Record<string, string>; readonly changes: FieldChange[] }
  | HeaderRefusal;

const refusal = (code: HeaderRefusal['code'], message: string): HeaderRefusal => ({
  ok: false,
  status: 422,
  code,
  message,
});

/** The changes one kept header makes: added, renamed, given a new value; never a value in them. */
function changesOf(edit: HeaderEdit, source: string | undefined, stored: Readonly<Record<string, string>>) {
  if (source === undefined) return [{ field: 'header', old: null, new: edit.name }];
  const changes: FieldChange[] = [];
  if (source !== edit.name) changes.push({ field: 'header', old: source, new: edit.name });
  if (edit.value !== undefined && edit.value !== stored[source]) {
    changes.push({ field: 'header_value', old: source, new: edit.name });
  }
  return changes;
}

/**
 * Applies an edit to a gateway's stored headers: each entry continues `from`, else the stored header of its own name,
 * else it is new. A `from` that is not stored is 422 `header_not_found`, a new header without a value 422
 * `header_value_required`. No changes means the headers stay as they are (their order too).
 */
export function editHeaders(
  stored: Readonly<Record<string, string>>,
  edits: readonly HeaderEdit[],
): EditedHeaders {
  const headers: Record<string, string> = {};
  const changes: FieldChange[] = [];
  const kept = new Set<string>();
  for (const edit of edits) {
    if (edit.from !== undefined && !Object.hasOwn(stored, edit.from)) {
      return refusal('header_not_found', `This gateway has no header ${edit.from}`);
    }
    const source = edit.from ?? (Object.hasOwn(stored, edit.name) ? edit.name : undefined);
    const value = edit.value ?? (source === undefined ? undefined : stored[source]);
    if (value === undefined) {
      return refusal('header_value_required', `${edit.name} is a new header: give it a value`);
    }
    headers[edit.name] = value;
    if (source !== undefined) kept.add(source);
    changes.push(...changesOf(edit, source, stored));
  }
  for (const name of Object.keys(stored)) {
    if (!kept.has(name)) changes.push({ field: 'header', old: name, new: null });
  }
  return { ok: true, headers: changes.length === 0 ? { ...stored } : headers, changes };
}
