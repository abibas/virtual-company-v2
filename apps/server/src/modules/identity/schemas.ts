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
