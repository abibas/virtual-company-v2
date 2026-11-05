/**
 * The CLIs' logins expect a terminal. The server starts them with pipes (never `docker run -t` from a parent that has
 * no terminal), so a sandbox runs them behind a pseudo-terminal of its own: util-linux's `script`, quiet (`-q`),
 * flushing every write (`-f`), returning the CLI's exit code (`-e`), with its typescript thrown away (`/dev/null`).
 * The terminal is very wide so no sign-in address is wrapped.
 */

/** The pseudo-terminal's size. */
export const TERMINAL = { cols: 2000, rows: 50 } as const;

/** One argument for `sh -c`: as it is when it is plain, else single-quoted. */
export function shellQuote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** The argv that runs `argv` behind `script`'s pseudo-terminal: `script -qfec "stty …; exec <argv>" /dev/null`. */
export function ttyArgv(argv: readonly string[]): string[] {
  if (argv.length === 0) throw new RangeError('A login names its command');
  const command = `stty cols ${TERMINAL.cols} rows ${TERMINAL.rows}; exec ${argv.map(shellQuote).join(' ')}`;
  return ['script', '-qfec', command, '/dev/null'];
}
