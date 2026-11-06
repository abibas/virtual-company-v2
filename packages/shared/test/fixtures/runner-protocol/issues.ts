import type { z } from 'zod';

/** The paths of a schema's issues for a value (`a.b.0`, '' for the value itself); none when it is accepted. */
export function issuesOf(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

/** A copy of an object without one of its fields. */
export function without<T extends object>(value: T, key: keyof T): Partial<T> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}
