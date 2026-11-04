# New package or connector

Folders: `packages/<name>` (a library), `apps/<name>` (deployed), `connectors/<name>` (an adapter to an
outside system, implementing a port of a `packages/*-core` package). The name is always `@mwc/<name>`.

## package.json

```json
{
  "name": "@mwc/<name>",
  "version": "0.0.0",
  "private": true,
  "description": "One sentence: what it offers.",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@mwc/shared": "workspace:*"
  }
}
```

Exact versions only (no `^` or `~`), and respect pnpm's release-age gate. Packages export TypeScript
sources directly; `src/index.ts` only re-exports. Add `"@mwc/testkit": "workspace:*"` to
`devDependencies` when the tests need it (never to `dependencies`).

## tsconfig.json

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test", "vitest.config.ts"]
}
```

Add `"scripts"` to `include` when the package has `scripts/`.

## vitest.config.ts

```ts
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: '<name>',
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

## Then

1. At least one test in `test/` (the structure step fails without it), mirroring `src/`.
2. `pnpm install` (links the workspace package), then `pnpm mwc check`: the new package is typechecked,
   tested and measured without further wiring.
3. A connector: the port and its fake live in the core package (`IdentityProvider` and
   `FakeIdentityProvider` in `@mwc/identity-core`); the connector maps the outside system's errors to the
   core's error type, has unit tests against recorded or faked responses, and an opt-in contract test
   against the real system that runs only on request. It is wired in `apps/server/src/app.ts`; modules
   never import it.
4. Docs: `docs/structure.md` (the map), `README.md` (Layout), `docs/roadmap.md` (the step), and the
   package's own `README.md` when it has rules worth writing down.
