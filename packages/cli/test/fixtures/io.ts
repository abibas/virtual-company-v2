import type { MainIo } from '../../src/io.ts';

/** A MainIo that keeps what a command prints (cwd /repo unless given). */
export function capture(extra: Partial<Pick<MainIo, 'cwd' | 'env'>> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: MainIo = {
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    cwd: extra.cwd ?? '/repo',
    ...(extra.env ? { env: extra.env } : {}),
  };
  return { io, out: () => out.join(''), err: () => err.join('') };
}
