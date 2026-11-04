import { z } from '@hono/zod-openapi';
import { MembershipRole, MembershipStatus } from '@mwc/shared/enums';

const companyId = z
  .string()
  .openapi({ param: { name: 'companyId', in: 'path' }, example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10' });

export const MembersParamsSchema = z.object({ companyId });

export const MemberParamsSchema = z.object({
  companyId,
  membershipId: z.string().openapi({
    param: { name: 'membershipId', in: 'path' },
    example: '019a4f0c-9d2f-7a3b-8c41-5e2f3a7b8c90',
  }),
});

/** A person in the company: their membership (`id`), who they are, their role and status, and when they joined. */
export const MemberSchema = z
  .object({
    id: z.string(),
    userId: z.string(),
    principalId: z.string(),
    displayName: z.string(),
    email: z.string(),
    imageUrl: z.string().nullable(),
    role: MembershipRole,
    status: MembershipStatus,
    joinedAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('Member');

export const MemberListSchema = z.object({ members: z.array(MemberSchema) }).openapi('MemberList');

/** The role to give; owners may give any, admins admin, member or viewer to anyone but an owner. */
export const UpdateMemberSchema = z.object({ role: MembershipRole }).openapi('UpdateMember');

export type MemberView = z.infer<typeof MemberSchema>;
export type UpdateMember = z.infer<typeof UpdateMemberSchema>;
