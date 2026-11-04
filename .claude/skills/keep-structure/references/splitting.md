# Splitting a file

Split by responsibility, keep behaviour and public import paths, and move the tests along the same seams.

## A service that outgrew 300 lines

Before:

```
modules/members/
  routes.ts        imports { invite, changeRole, remove } from './service.ts'
  service.ts       340 lines: invite, resend, revoke, changeRole, remove, the last-owner guard
  repo.ts
```

After:

```
modules/members/
  routes.ts        imports from './service/invite.ts', './service/roles.ts', './service/remove.ts'
  service/
    invite.ts      invite, resend, revoke
    roles.ts       changeRole and the last-owner guard
    remove.ts      remove (re-parents direct reports, revokes keys)
  rules.ts         the last-owner guard as a pure function, if it has no I/O
  repo.ts
```

- The folder takes the role's name (`service/`), so the structure step accepts it.
- Shared helpers of the parts go in the file that owns them; a pure rule moves to `rules.ts`.
- No `service/index.ts` with logic. A barrel is fine only when many callers need one import path.
- Tests: `test/modules/members/routes.test.ts` stays (through `app.request()`); unit tests of a part go
  to `test/modules/members/service/<part>.test.ts`.

## A package file: keep the entry

Done in S1.0b, for reference:

| File (lines)                                 | Now                                                                                       |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `identity-core/src/projector.ts` (528)       | the dispatch (`project`, `replayDeferred`) stays; handlers in `projector/` (users, memberships, membership-link, invitations) and the shapes in `projector/changes.ts` |
| `identity-core/src/fake.ts` (456)            | the provider class stays; its state and dashboard actions in `fake/world.ts`, tokens in `fake/tokens.ts`, webhook signing in `fake/webhooks.ts` |
| `db/src/diagram.ts` (418)                    | the page (`renderSchemaDiagram`) stays; `diagram/describe.ts`, `diagram/mermaid.ts`, `diagram/markdown.ts` |
| `cli/src/main.ts` (344)                      | dispatch stays; the check lanes in `check.ts`, the shared io in `io.ts`                    |

- The entry file keeps the public functions, so `@mwc/identity-core` and other importers change nothing.
- A part that needs the entry back (the user handler replays parked events through `project`) gets a
  callback (`replay`) instead of an import, so there is no cycle.
- A class whose private state several parts need hands it to an internal object (`FakeWorld`) that the
  class holds; the class's public members stay the same.

## The tests

`projector.test.ts` (791 lines) became `test/projector.test.ts` plus `test/projector/{users,
membership-link,memberships,invitations}.test.ts`, one file per `describe` group, with the helpers in
`test/fixtures/events.ts`. Every `it` kept its body; only the imports differ. Check after a split:

```sh
pnpm mwc structure     # the limits
pnpm mwc check         # the same number of tests, green, coverage floors held
```
