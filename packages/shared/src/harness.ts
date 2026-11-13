/**
 * One chat turn of a harness, as the server and a runner exchange it (docs/harness.md): the turn the server asks for
 * and the terminal it opens (`harness/specs.ts`), the normalized events a runner sends back (`harness/events.ts`), the
 * models' context windows (`harness/context.ts`), a subscription's usage limits a reading carries (`harness/limits.ts`),
 * the questions an agent asks the person (`harness/questions.ts`) and the server's own tools a turn carries
 * (`harness/server-tools.ts`, S7.1c).
 * `@mwc/harness-core` builds on these; the server reads them from here, so it never imports a harness package.
 */
export * from './harness/context.ts';
export * from './harness/events.ts';
export * from './harness/limits.ts';
export * from './harness/questions.ts';
export * from './harness/server-tools.ts';
export * from './harness/specs.ts';
