import { type DbHandle, type DbSession, reserveSession } from '@mwc/db/system';

/**
 * The jobs lock: one process per database runs the jobs loop. It is a Postgres session-level advisory lock,
 * `pg_try_advisory_lock(class, id)`, taken on a session of its own (`reserveSession`: a connection reserved from the
 * pool), so it is held exactly as long as that session lives: a process that dies, or loses its connection, frees it
 * for the others, which try again every so often. PGlite has advisory locks too, and this is the same code, but one
 * PGlite database is one session, so two holders in one process would both get it; a PGlite database belongs to one
 * process anyway (tests, the in-memory demo server), which is the only runner by construction.
 */

/** The lock's two keys: `mwc` in ASCII, then the jobs loop. Advisory locks are per database. */
export const JOBS_LOCK_KEY = [0x6d_77_63, 1] as const;

export interface JobsLock {
  /** Takes the lock if it is free; true when this process holds it now. */
  tryAcquire(): Promise<boolean>;
  /** True while this process holds the lock: its session is alive and still has it. */
  isHeld(): Promise<boolean>;
  /** Gives the lock up (when held) and the session back. */
  release(): Promise<void>;
}

const HELD = `select count(*)::int as held from pg_locks
  where locktype = 'advisory' and pid = pg_backend_pid() and classid = $1 and objid = $2 and objsubid = 2 and granted`;

/** The advisory jobs lock on `db`'s database; `key` only differs in tests. */
export function advisoryJobsLock(db: DbHandle, key: readonly [number, number] = JOBS_LOCK_KEY): JobsLock {
  /** The session that holds the lock; none while it is not held (a try that fails gives its session back). */
  let holder: DbSession | undefined;
  return {
    async tryAcquire() {
      if (holder !== undefined) return true;
      const session = await reserveSession(db);
      let locked = false;
      try {
        const rows = await session.query<{ locked: boolean }>(
          'select pg_try_advisory_lock($1, $2) as locked',
          key,
        );
        locked = (rows as [{ locked: boolean }])[0].locked;
      } finally {
        if (locked) holder = session;
        else session.release();
      }
      return locked;
    },
    async isHeld() {
      const session = holder;
      if (session === undefined) return false;
      try {
        const rows = await session.query<{ held: number }>(HELD, key);
        if ((rows as [{ held: number }])[0].held > 0) return true;
      } catch {
        // The session is gone, and the lock with it.
      }
      holder = undefined;
      session.release();
      return false;
    },
    async release() {
      const session = holder;
      if (session === undefined) return;
      holder = undefined;
      try {
        await session.query('select pg_advisory_unlock($1, $2)', key);
      } finally {
        session.release();
      }
    },
  };
}
