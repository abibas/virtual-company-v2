/**
 * The Postgres error behind a rejected Drizzle query. Drizzle wraps driver errors in a
 * DrizzleQueryError whose `cause` is the driver's error with the SQLSTATE `code` and `constraint`.
 */
export async function pgError(query: PromiseLike<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause ?? error;
    return cause as { code?: string; constraint?: string };
  }
  throw new Error('expected the query to fail');
}
