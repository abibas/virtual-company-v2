export interface ParsedArgs {
  readonly command: string | undefined;
  readonly positionals: readonly string[];
  readonly flags: ReadonlySet<string>;
  readonly options: Readonly<Record<string, string>>;
}

/**
 * Minimal argv parsing for `mwc`: the first bare word is the command, `--name value` and
 * `--name=value` are options, a lone `--name` is a flag, anything else is a positional.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  let command: string | undefined;
  const positionals: string[] = [];
  const flags = new Set<string>();
  const options: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg.startsWith('--')) {
      const body = arg.slice(2);
      const eq = body.indexOf('=');
      if (eq >= 0) {
        options[body.slice(0, eq)] = body.slice(eq + 1);
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        options[body] = next;
        i++;
      } else {
        flags.add(body);
      }
      continue;
    }
    if (command === undefined) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }

  return { command, positionals, flags, options };
}
