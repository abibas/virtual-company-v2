/**
 * The Postgres error behind a rejected Drizzle query. Drizzle wraps driver errors in a
 * DrizzleQueryError whose `cause` is the driver's error with the SQLSTATE `code` and the constraint
 * name, which PGlite calls `constraint` and postgres.js `constraint_name`.
 */
export async function pgError(query: PromiseLike<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await query;
  } catch (error) {
    const cause = ((error as { cause?: unknown }).cause ?? error) as {
      code?: string;
      constraint?: string;
      constraint_name?: string;
    };
    const constraint = cause.constraint ?? cause.constraint_name;
    return {
      ...(cause.code === undefined ? {} : { code: cause.code }),
      ...(constraint === undefined ? {} : { constraint }),
    };
  }
  throw new Error('expected the query to fail');
}
