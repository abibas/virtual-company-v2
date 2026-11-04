# Module template

A server module is one business area in `apps/server/src/modules/<area>/`. The live example is
`modules/health/` (`routes.ts`, `service.ts`, `schemas.ts`, `index.ts`). Below, an area `notes` with every
role file; create only the files the area needs. The tenant layer (`tenant(db, companyId)`) and the
membership guard arrive with S1.3–S1.4; until then a repo takes the database handle from `AppDeps`.

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
import type { AppDeps } from '../../platform/env.ts';

/** Reaches tenant tables only through tenant(db, companyId) (S1.3); no business rules here. */
export function notesRepo(deps: Pick<AppDeps, 'db'>) {
  return {
    async insert(companyId: string, title: string) {
      // return tenant(deps.db, companyId).insert(notes).values({ title }).returning()
    },
  };
}
```

## service.ts: the logic, no HTTP

```ts
import type { AppDeps } from '../../platform/env.ts';
import { notesRepo } from './repo.ts';
import { normalizeTitle } from './rules.ts';

export function notesService(deps: AppDeps) {
  const repo = notesRepo(deps);
  return {
    async create(companyId: string, title: string) {
      const clean = normalizeTitle(title);
      if (!clean) return { ok: false as const, reason: 'empty_title' };
      return { ok: true as const, note: await repo.insert(companyId, clean) };
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
import type { AppDeps } from '../../platform/env.ts';
import { errorJson } from '../../platform/http/errors.ts';
import { newRouter } from '../../platform/http/router.ts';
import { CreateNoteSchema, NoteSchema } from './schemas.ts';
import { notesService } from './service.ts';

const createNoteRoute = createRoute({
  method: 'post',
  path: '/api/companies/{companyId}/notes',
  tags: ['notes'],
  request: { body: { content: { 'application/json': { schema: CreateNoteSchema } } } },
  responses: { 201: { description: 'Created', content: { 'application/json': { schema: NoteSchema } } } },
});

export function notesRoutes(deps: AppDeps) {
  const notes = notesService(deps);
  return newRouter().openapi(createNoteRoute, async (c) => {
    const result = await notes.create(c.req.param('companyId'), c.req.valid('json').title);
    if (!result.ok) return errorJson(c, 400, result.reason, 'The title is empty');
    return c.json(result.note, 201);
  });
}
```

## index.ts: the router factory, re-exported

```ts
// The notes module. createApp mounts its router.
export { notesRoutes } from './routes.ts';
```

Mount it in `apps/server/src/app.ts`: `app.route('/', healthRoutes(deps)).route('/', notesRoutes(deps))`
(chained, so `AppType` and the web's typed client see the routes).

## The tests: `apps/server/test/modules/notes/`

```ts
// routes.test.ts: the module through the app, on a real test database.
import { createTestApp, postJson, type TestApp } from '@mwc/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.close());

describe('POST /api/companies/:companyId/notes', () => {
  it('refuses an empty title in the common error shape', async () => {
    const res = await postJson(t.app, '/api/companies/c1/notes', { title: '  ' });
    expect(res).toMatchObject({ status: 400, body: { error: { code: 'empty_title' } } });
  });
});
```

`rules.test.ts` tests `rules.ts` directly (no app, no database); `service.test.ts` only when the service has
behaviour the routes cannot reach.
