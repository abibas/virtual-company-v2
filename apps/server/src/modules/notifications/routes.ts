import { createRoute } from '@hono/zod-openapi';
import { type CompanyPath, companyRoute } from '../../platform/auth/membership.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { jsonBody, jsonResponse } from '../../platform/http/docs.ts';
import { errorResponse } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import {
  MarkReadSchema,
  NotificationListQuerySchema,
  NotificationListSchema,
  NotificationSettingsSchema,
  NotificationsParamsSchema,
  UnreadCountSchema,
  UpdateNotificationSettingsSchema,
} from './schemas.ts';
import { notificationsService } from './service.ts';

/**
 * `/api/companies/{companyId}/notifications` (S2.9): the caller's own notifications in a company, newest first with
 * their unread count, marking them read, and their email setting. Every active member (viewer and above) reads only
 * their own; nobody reads another's.
 */

const route = <P extends CompanyPath>(deps: ServerDeps, path: P) =>
  companyRoute(deps, { role: 'viewer', path, tag: 'notifications' });

const BASE = '/api/companies/{companyId}/notifications' as const;
const INVALID = errorResponse('The request does not match the schema (`invalid_request`)');

const listRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, BASE);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'Your notifications here, newest first, a page at a time, with how many are unread',
    request: { params: NotificationsParamsSchema, query: NotificationListQuerySchema },
    responses: {
      200: jsonResponse('A page of your notifications', NotificationListSchema),
      400: INVALID,
      401: refusals[401],
      404: refusals[404],
    },
  });
};

const readRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, `${BASE}/read`);
  return createRoute({
    ...base,
    method: 'post',
    summary: 'Mark your notifications read: these ids, or all of them',
    description: "Ids that are not yours, or read already, change nothing; nobody marks another's.",
    request: { params: NotificationsParamsSchema, body: jsonBody(MarkReadSchema) },
    responses: {
      200: jsonResponse('Your unread count after', UnreadCountSchema),
      400: INVALID,
      401: refusals[401],
      404: refusals[404],
    },
  });
};

const settingsRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, `${BASE}/settings`);
  return createRoute({
    ...base,
    method: 'get',
    summary: 'Your notification settings here',
    request: { params: NotificationsParamsSchema },
    responses: {
      200: jsonResponse('Your settings, and how this server sends email', NotificationSettingsSchema),
      401: refusals[401],
      404: refusals[404],
    },
  });
};

const saveSettingsRoute = (deps: ServerDeps) => {
  const { base, refusals } = route(deps, `${BASE}/settings`);
  return createRoute({
    ...base,
    method: 'put',
    summary: 'Turn your notification emails here on or off',
    request: { params: NotificationsParamsSchema, body: jsonBody(UpdateNotificationSettingsSchema) },
    responses: {
      200: jsonResponse('Your settings, and how this server sends email', NotificationSettingsSchema),
      400: INVALID,
      401: refusals[401],
      404: refusals[404],
    },
  });
};

export function notificationsRoutes(deps: ServerDeps) {
  const service = notificationsService({ db: deps.db, email: deps.config.MWC_EMAIL });
  return newRouter()
    .openapi(listRoute(deps), async (c) => {
      const query = c.req.valid('query');
      return c.json(await service.list(c.var.tenant, c.var.membership.principalId, query), 200);
    })
    .openapi(readRoute(deps), async (c) => {
      const body = c.req.valid('json');
      const ids = 'all' in body ? 'all' : body.ids;
      return c.json(
        await service.markRead(c.var.tenant, c.var.membership.principalId, ids, c.var.clock()),
        200,
      );
    })
    .openapi(settingsRoute(deps), async (c) =>
      c.json(await service.settings(c.var.tenant, c.var.membership.principalId), 200),
    )
    .openapi(saveSettingsRoute(deps), async (c) => {
      const { email } = c.req.valid('json');
      return c.json(await service.saveSettings(c.var.tenant, c.var.membership.principalId, email), 200);
    });
}
