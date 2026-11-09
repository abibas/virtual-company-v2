/**
 * One chat turn of a harness, as the server and a runner exchange it (docs/harness.md): the turn the server asks for
 * and the terminal it opens (`harness/specs.ts`), the normalized events a runner sends back (`harness/events.ts`), and
 * the models' context windows (`harness/context.ts`). `@mwc/harness-core` builds on these; the server reads them from
 * here, so it never imports a harness package.
 */
export * from './harness/context.ts';
export * from './harness/events.ts';
export * from './harness/specs.ts';
