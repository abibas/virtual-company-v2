import { z } from '@hono/zod-openapi';
import { CompanyStatus, MembershipRole, MembershipStatus } from '@mwc/shared/enums';
import { LogoRef } from '@mwc/shared/logos';

export const MeUserSchema = z
  .object({
    id: z.string().openapi({ example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10' }),
    email: z.string().openapi({ example: 'ihor@example.com' }),
    displayName: z.string().nullable().openapi({
      example: 'Ihor Herasko',
      description: "The person's first and last name; null until they give one (the web asks for it then)",
    }),
    imageUrl: z.string().nullable().openapi({
      description: 'Their photo at the identity provider; null for none (the web draws their initials)',
    }),
  })
  .openapi('MeUser');

/**
 * One company the user belongs to: their role and membership status there, the company's status, its organization
 * at the identity provider (null while provisioning; the web makes it Clerk's active organization), its logo's
 * version (for `GET /api/companies/{companyId}/logo?v=<version>`; null when it has none) and their default access
 * profile there.
 */
export const MeMembershipSchema = z
  .object({
    companyId: z.string(),
    slug: z.string().openapi({ example: 'most-wanted' }),
    name: z.string(),
    role: MembershipRole,
    status: MembershipStatus,
    companyStatus: CompanyStatus,
    identityOrgId: z.string().nullable().openapi({ example: 'org_2abc...' }),
    logo: LogoRef.nullable().openapi({ example: { version: '9f86d081884c7d65' } }),
    /** Your access profile for the agents you hire there (S3.4); null for none. */
    defaultProfileId: z.string().nullable(),
  })
  .openapi('MeMembership');

export const MeSchema = z
  .object({
    user: MeUserSchema,
    /** Not removed, in companies that are not deleted; an API key sees its own company only. */
    memberships: z.array(MeMembershipSchema),
    session: z.object({
      via: z.enum(['clerk', 'api_key']),
      /** The session still has a pending task (Clerk `sts=pending`): other routes refuse it until it is done. */
      pending: z.boolean(),
    }),
  })
  .openapi('Me');

export type Me = z.infer<typeof MeSchema>;

export const SyncParamsSchema = z.object({
  companyId: z
    .string()
    .openapi({ param: { name: 'companyId', in: 'path' }, example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10' }),
});

/** What a company sync did (`reconcileCompany`). */
export const CompanySyncSchema = z
  .object({
    organization: z.enum(['linked', 'pending']),
    members: z.number().int(),
    invitations: z.number().int(),
    removed: z.number().int(),
    changed: z.number().int(),
    providerRemovals: z.number().int(),
  })
  .openapi('CompanySync');

/** What `POST /api/webhooks/clerk` made of a verified delivery. */
export const WebhookReceiptSchema = z
  .object({
    status: z.enum(['processed', 'failed', 'duplicate', 'ignored']).openapi({
      description:
        '`processed`: projected; `failed`: recorded, processing failed and is retried here; `duplicate`: a delivery ' +
        'already received (nothing done); `ignored`: an event type this product does not project (recorded)',
    }),
  })
  .openapi('WebhookReceipt');
