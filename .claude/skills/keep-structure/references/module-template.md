# Module template

A server module is one business area in `apps/server/src/modules/<area>/`. The live example is
`modules/health/` (`routes.ts`, `service.ts`, `schemas.ts`, `index.ts`). Below, an area `notes` with every
role file; create only the files the area needs. A company route sits behind `authn()` and `requireMembership(role)`
(`platform/auth/`, S1.4), which put the company's `TenantDb` on `c.var.tenant`; a repo reaches tenant tables only
through it (or through `tenant(db, companyId)` of `@mwc/db`). The live examples of authenticated routes are
`modules/identity/routes.ts` (`GET /api/me`), `modules/companies/` (S1.5: company routes, a service split into
named functions, outbox handlers in `service/`) and `modules/members/` (S1.6: routes on `companyRoute`, a service
split by use case in `service/`, decisions under the company's lock). A new company and its first tenant rows go through
`withNewCompany` of `@mwc/db`, never `@mwc/db/system`.

## schemas.ts: the shapes, nothing else

```ts
import { z } from '@hono/zod-openapi';

export const NoteSchema = z.object({ id: z.string(), title: z.string().min(1).max(200) }).openapi('Note');
export const CreateNoteSchema = NoteSchema.pick({ title: true }).openapi('CreateNote');
export type Note = z.infer<typeof NoteSchema>;
```

## rules.ts: pure decisions, no I/O

```ts
/** A title is trimmed and must stay non-empty. */
export function normalizeTitle(title: string): string | undefined {
  const trimmed = title.trim();
  return trimmed === '' ? undefined : trimmed;
}
```

## repo.ts: database access only

```ts
import { notes, type TenantDb } from '@mwc/db';

/** Tenant tables only through the company's TenantDb (`c.var.tenant`); no business rules here. */
export function notesRepo() {
  return {
    insert: (t: TenantDb, title: string) => t.insert(notes, { title }).returning(),
  };
}
```

## service.ts: the logic, no HTTP

```ts
import type { TenantDb } from '@mwc/db';
import { notesRepo } from './repo.ts';
import { normalizeTitle } from './rules.ts';

export function notesService() {
  const repo = notesRepo();
  return {
    async create(t: TenantDb, title: string) {
      const clean = normalizeTitle(title);
      if (!clean) return { ok: false as const, reason: 'empty_title' };
      return { ok: true as const, note: (await repo.insert(t, clean))[0] };
    },
  };
}
```

A service that grows past 300 lines becomes `service/create.ts`, `service/archive.ts`, ... and `routes.ts`
imports from those files (`references/splitting.md`). Another module's data is reached through that
module's service, never its `repo.ts`.

## routes.ts: HTTP only

```ts
import { createRoute } from '@hono/zod-openapi';
import { companyMember } from '../../platform/auth/membership.ts';
import type { ServerDeps } from '../../platform/env.ts';
import { BEARER_SCHEME, jsonBody, jsonResponse } from '../../platform/http/docs.ts';
import { errorJson, errorResponse } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import { CreateNoteSchema, NoteSchema } from './schemas.ts';
import { notesService } from './service.ts';

// One factory per route, outside the router function, so that function stays short as routes are added.
// companyMember(deps, role) is authn() then requireMembership(role) as a tuple: zod-openapi types the handler's
// c.var.actor, c.var.tenant and c.var.membership only from a tuple (a plain array literal loses them).
const createNoteRoute = (deps: ServerDeps) =>
  createRoute({
    method: 'post',
    path: '/api/companies/{companyId}/notes',
    tags: ['notes'],
    security: [{ [BEARER_SCHEME]: [] }],
    middleware: companyMember(deps, 'member'),
    request: { body: jsonBody(CreateNoteSchema) },
    responses: {
      201: jsonResponse('Created', NoteSchema),
      400: errorResponse('The title is empty (`empty_title`)'),
    },
  });

export function notesRoutes(deps: ServerDeps) {
  const notes = notesService();
  return newRouter().openapi(createNoteRoute(deps), async (c) => {
    const result = await notes.create(c.var.tenant, c.req.valid('json').title);
    if (!result.ok) return errorJson(c, 400, result.reason, 'The title is empty');
    return c.json(result.note, 201);
  });
}
```

Routes under one company share a base: `companyRoute(deps, { role, path, tag })` (`platform/auth/membership.ts`) gives
`base` (the path as a literal type, the tag, the bearer credential, `companyMember(deps, role)`) and `refusals` (the
guard's 401, 403 and 404) to spread into `createRoute` and its responses; override a refusal the service adds to (live
example: `modules/members/routes/members.ts`). A path in a shared route base needs `as const` (`path: '/api/companies/{companyId}' as const`): typed as a plain
`string` it collapses the web's typed client (`AppType`). When the routes outgrow one file, group them by path in
`routes/<group>.ts`, each returning its own `newRouter()`, and let `routes.ts` mount them with `.route('/', ...)`
(the live example: `modules/companies/routes.ts`, `routes/collection.ts` and `routes/company.ts`).

## index.ts: the router factory, re-exported

```ts
// The notes module. createApp mounts its router.
export { notesRoutes } from './routes.ts';
```

Mount it in `apps/server/src/app.ts`: `app.route('/', healthRoutes(deps)).route('/', notesRoutes(deps))`
(chained, so `AppType` and the web's typed client see the routes).

## The tests: `apps/server/test/modules/notes/`

```ts
// routes.test.ts: the module through the app, on a real test database, signed in with the fake provider.
import { createTestApp, FakeIdentityProvider, postJson, seedCompany, type TestApp } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let t: TestApp;
let companyId: string;
const fake = new FakeIdentityProvider();
beforeAll(async () => {
  t = await createTestApp({ identity: fake });
  // The owner's identity is the fake's issuer and this subject; the fake must know them for the token.
  companyId = (await seedCompany(t.db, { owner: { subject: 'olga' } })).company.id;
  fake.createUser({ subject: 'olga', email: 'olga@example.test' });
});
afterAll(() => t.close());

describe('POST /api/companies/:companyId/notes', () => {
  it('refuses an empty title in the common error shape', async () => {
    const res = await postJson(t.app, `/api/companies/${companyId}/notes`, { title: '  ' }, {
      authorization: 'Bearer fake:olga',
    });
    expect(res).toMatchObject({ status: 400, body: { error: { code: 'empty_title' } } });
  });
});
```

Every company route also gets the auth cases: no token (401), a non-member (404), a role too low (403); the
auth tests' helpers are in `apps/server/test/fixtures/auth.ts`.

`rules.test.ts` tests `rules.ts` directly (no app, no database); `service.test.ts` only when the service has
behaviour the routes cannot reach.
