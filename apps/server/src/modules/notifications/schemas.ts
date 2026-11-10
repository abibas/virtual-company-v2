import { z } from '@hono/zod-openapi';
import { EmailMode } from '@mwc/shared/config';
import { NotificationKind } from '@mwc/shared/enums';

const companyId = z
  .string()
  .openapi({ param: { name: 'companyId', in: 'path' }, example: '019a4f0c-8c1e-7c4b-9a52-3d1f2b6e7a10' });

export const NotificationsParamsSchema = z.object({ companyId });

/** `?before=<id>&limit=<n>`: the page of notifications older than `before` (the last page's `nextBefore`). */
export const NotificationListQuerySchema = z.object({
  before: z
    .uuid()
    .optional()
    .openapi({ param: { name: 'before', in: 'query' }, example: '019a4f0c-b3c4-7d5e-8f60-718293a4b5c6' }),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .openapi({ param: { name: 'limit', in: 'query' }, example: 20 }),
});

/** Who made a change: a person or, later, an agent; null when the system did (the identity provider). */
const ActorSchema = z.object({ principalId: z.string(), name: z.string() }).nullable();

/** One notification as its recipient reads it. */
export const NotificationSchema = z
  .object({
    id: z.string(),
    kind: NotificationKind,
    text: z.string().openapi({ example: 'You now report to Anna Smith' }),
    actor: ActorSchema,
    /** Where it points inside the company (`/<slug>/<path>`), or null (a removal, a suspension). */
    path: z.string().nullable().openapi({ example: 'structure' }),
    createdAt: z.string(),
    readAt: z.string().nullable(),
  })
  .openapi('Notification');

export const NotificationListSchema = z
  .object({
    notifications: z.array(NotificationSchema),
    unreadCount: z.number().int().min(0),
    /** The `before` of the next page, or null on the last one. */
    nextBefore: z.string().nullable(),
  })
  .openapi('NotificationList');

/** Mark these notifications read, or all of them. */
export const MarkReadSchema = z
  .union([z.object({ ids: z.array(z.uuid()).min(1).max(100) }), z.object({ all: z.literal(true) })])
  .openapi('MarkNotificationsRead');

export const UnreadCountSchema = z.object({ unreadCount: z.number().int().min(0) }).openapi('UnreadCount');

/** The person's notification settings here, and how this server sends email (MWC_EMAIL). */
export const NotificationSettingsSchema = z
  .object({
    /** Email me my notifications (on by default). */
    email: z.boolean(),
    serverEmail: EmailMode,
  })
  .openapi('NotificationSettings');

export const UpdateNotificationSettingsSchema = z
  .object({ email: z.boolean() })
  .openapi('UpdateNotificationSettings');

export type NotificationList = z.infer<typeof NotificationListSchema>;
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;
