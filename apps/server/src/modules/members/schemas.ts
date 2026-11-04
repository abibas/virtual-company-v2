import { z } from '@hono/zod-openapi';
import { InvitationStatus, MembershipRole, MembershipStatus } from '@mwc/shared/enums';

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

export const InvitationParamsSchema = z.object({
  companyId,
  invitationId: z.string().openapi({
    param: { name: 'invitationId', in: 'path' },
    example: '019a4f0c-a1b2-7c3d-8e4f-5a6b7c8d9e0f',
  }),
});

/** Which invitations to list: those whose status as of now is this one (pending by default), or `all`. */
export const InvitationListQuerySchema = z.object({
  status: z
    .enum([...InvitationStatus.options, 'all'])
    .default('pending')
    .openapi({ param: { name: 'status', in: 'query' }, example: 'pending' }),
});

/**
 * An invitation to the company: who it is for, the role they get on accepting, its status as of now (a pending one
 * past `expiresAt` shows as `expired`), whether the identity provider has sent it yet, and who sent and accepted it.
 */
export const InvitationSchema = z
  .object({
    id: z.string(),
    email: z.string(),
    role: MembershipRole,
    status: InvitationStatus,
    expiresAt: z.string().openapi({ format: 'date-time' }),
    sent: z.boolean(),
    invitedByPrincipalId: z.string().nullable(),
    acceptedByUserId: z.string().nullable(),
    createdAt: z.string().openapi({ format: 'date-time' }),
  })
  .openapi('Invitation');

export const InvitationListSchema = z
  .object({ invitations: z.array(InvitationSchema) })
  .openapi('InvitationList');

/** Whom to invite and with which role; owners may invite with any role, admins with any but owner. */
export const CreateInvitationSchema = z
  .object({ email: z.email().max(320).openapi({ example: 'bob@example.com' }), role: MembershipRole })
  .openapi('CreateInvitation');

export type MemberView = z.infer<typeof MemberSchema>;
export type UpdateMember = z.infer<typeof UpdateMemberSchema>;
export type InvitationView = z.infer<typeof InvitationSchema>;
