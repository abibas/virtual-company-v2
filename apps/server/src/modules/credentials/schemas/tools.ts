import { z } from '@hono/zod-openapi';
import { atlassianSite, CREDENTIAL_LABEL } from '@mwc/shared/credentials';
import { AtlassianToken, GitHubToken } from './secrets.ts';

/**
 * The tool sign-ins API's shapes (`/api/me/subscriptions/tools`, S7.1a): a pasted GitHub token, or an Atlassian site,
 * account email and API token, each checked with its provider before it is stored. Sign in with GitHub is the sign-in
 * API's (`schemas/sign-in.ts`). A response is the stored sign-in's metadata, never its secret.
 */

const label = z
  .string()
  .trim()
  .min(CREDENTIAL_LABEL.min, 'A name is required')
  .max(CREDENTIAL_LABEL.max, `A name is at most ${CREDENTIAL_LABEL.max} characters`)
  .optional()
  .openapi({ description: 'By default "GitHub · <login>" or "Atlassian · <site>"', example: 'Work GitHub' });

const credentialId = z
  .string()
  .optional()
  .openapi({
    description:
      'Sign in again: your own sign-in of this kind, whose secret the new one replaces in place (same id and name); ' +
      '`label` is then ignored',
    example: '019a5a10-3c4d-7e5f-8a6b-7c8d9e0f1a2b',
  });

/** A site as typed (`https://airia.atlassian.net/`, `airia.atlassian.net`, `airia`), kept as its host. */
const AtlassianSiteInput = z
  .string()
  .max(300)
  .transform((value, ctx) => {
    const site = atlassianSite(value);
    if (site === undefined) {
      ctx.addIssue({ code: 'custom', message: 'A site is <name>.atlassian.net' });
      return z.NEVER;
    }
    return site;
  })
  .openapi({ type: 'string', example: 'airia.atlassian.net' });

/** A pasted tool sign-in, or (with `credentialId`) a new secret for one of yours. */
export const AddToolSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('github_token'), label, credentialId, token: GitHubToken }),
    z.object({
      kind: z.literal('atlassian_api_token'),
      label,
      credentialId,
      site: AtlassianSiteInput,
      email: z
        .string()
        .trim()
        .max(320)
        .pipe(z.email('An email address is required'))
        .openapi({ example: 'ihor@example.com' }),
      token: AtlassianToken,
    }),
  ])
  .openapi('AddToolSignIn');

export type AddTool = z.infer<typeof AddToolSchema>;
