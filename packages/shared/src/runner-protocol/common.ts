import { z } from 'zod';

/** The building blocks every frame uses: objects that let unknown fields through, ids, versions, error texts. */

/**
 * A protocol object. At runtime it is a `z.looseObject`, so fields a newer peer adds pass through parsing untouched;
 * its TypeScript type lists only the known fields, so code on both sides is checked against the contract.
 */
export function protocolObject<S extends z.ZodRawShape>(shape: S): z.ZodObject<S, z.core.$strip> {
  return z.looseObject(shape) as unknown as z.ZodObject<S, z.core.$strip>;
}

/** A frame's schema: a protocol object with its `type`. */
export function frame<T extends string, S extends z.ZodRawShape>(type: T, shape: S) {
  return protocolObject({ type: z.literal(type), ...shape });
}

/** Every id in a frame is a UUID: the server's rows (v7, `newId()`) and what a runner makes (attention items). */
export const Uuid = z.uuid();

/** A semantic version: `1.2.3`, an optional `-prerelease` and an optional `+build`. */
export const RUNNER_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

/** A runner's version (`runner.hello`) or the lowest one the server takes (`server.hello`). */
export const RunnerVersion = z.string().max(64).regex(RUNNER_VERSION_PATTERN, 'a version such as 1.2.3');

/** Why something failed, in words for the log and the machine's page. */
export const ErrorText = z.string().min(1).max(2000);

/** Free-form JSON fields (event data, provider metadata): an object, its values unchecked. */
export const JsonObject = z.record(z.string(), z.unknown());

/**
 * Semantic version order: -1 when `a` is lower than `b`, 1 when higher, 0 when equal (the build part is ignored, a
 * prerelease is below its release). Throws a TypeError for a string that is not a version.
 */
export function compareRunnerVersions(a: string, b: string): -1 | 0 | 1 {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const order = Math.sign((left.core[i] as number) - (right.core[i] as number));
    if (order !== 0) return order as -1 | 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

function parseVersion(version: string): { core: number[]; prerelease: string | undefined } {
  const match = RUNNER_VERSION_PATTERN.exec(version);
  if (!match) throw new TypeError(`Not a version: ${JSON.stringify(version)}`);
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] };
}

/** Semver's prerelease order: numeric identifiers as numbers and before alphanumeric ones, a shorter list first. */
function comparePrerelease(a: string | undefined, b: string | undefined): -1 | 0 | 1 {
  if (a === b) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const order = compareIdentifier(left[i], right[i]);
    if (order !== 0) return order;
  }
  return 0;
}

function compareIdentifier(a: string | undefined, b: string | undefined): -1 | 0 | 1 {
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  const aNumeric = /^\d+$/.test(a);
  const bNumeric = /^\d+$/.test(b);
  if (aNumeric && bNumeric) return Math.sign(Number(a) - Number(b)) as -1 | 0 | 1;
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a === b ? 0 : a < b ? -1 : 1;
}
