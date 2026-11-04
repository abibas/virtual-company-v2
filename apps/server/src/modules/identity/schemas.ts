import { z } from '@hono/zod-openapi';
import { CompanyStatus, MembershipRole, MembershipStatus } from '@mwc/shared/enums';

export const MeUserSchema = z
  .object({
    id: z.string().openapi({ example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10' }),
    email: z.string().openapi({ example: 'ihor@example.com' }),
    displayName: z.string(),
    imageUrl: z.string().nullable(),
  })
  .openapi('MeUser');

/** One company the user belongs to: their role and membership status there, and the company's status. */
export const MeMembershipSchema = z
  .object({
    companyId: z.string(),
    slug: z.string().openapi({ example: 'most-wanted' }),
    name: z.string(),
    role: MembershipRole,
    status: MembershipStatus,
    companyStatus: CompanyStatus,
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
