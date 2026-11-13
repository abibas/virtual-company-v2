import { AtlassianError, type AtlassianProduct, type TextBody } from '@mwc/tools-core';
import { markdownToAdf } from './adf/from-markdown.ts';

/**
 * A body as each product takes it (S7.1c): Jira's v3 fields and comments take ADF only (Markdown is converted, ADF's
 * JSON text checked); Confluence's v2 pages take their HTML as the storage format, ADF as `atlas_doc_format`, and
 * Markdown converted to ADF.
 */

/** ADF's JSON text as a document, or a `bad_request` that says so. */
function adfOf(text: string, product: AtlassianProduct): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const doc = parsed as Record<string, unknown> | undefined;
  if (typeof doc !== 'object' || doc === null || doc.type !== 'doc')
    throw new AtlassianError('bad_request', product, {
      detail: 'ADF is a JSON document whose type is "doc".',
    });
  return doc;
}

/** A body for Jira: an ADF document. */
export function jiraBody(body: TextBody): unknown {
  if (body.format === 'adf') return adfOf(body.text, 'Jira');
  if (body.format === 'html')
    throw new AtlassianError('bad_request', 'Jira', { detail: 'Jira takes Markdown or ADF, not HTML.' });
  return markdownToAdf(body.text);
}

/** A body for a Confluence page: its representation and value. */
export function confluenceBody(body: TextBody): { readonly representation: string; readonly value: string } {
  if (body.format === 'html') return { representation: 'storage', value: body.text };
  const doc = body.format === 'adf' ? adfOf(body.text, 'Confluence') : markdownToAdf(body.text);
  return { representation: 'atlas_doc_format', value: JSON.stringify(doc) };
}
