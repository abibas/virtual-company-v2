/**
 * Codex's `-c key=value` config overrides (docs/harness.md, "Codex"): the value is parsed as TOML, so each writer gives
 * one TOML value. A JSON string is a TOML basic string for what goes here (ids, paths, URLs, header names).
 */

/** A `-c key=value` override; the value is a TOML string. */
export function configArg(key: string, value: string): string[] {
  return ['-c', `${key}=${JSON.stringify(value)}`];
}

/** A `-c key=value` override whose value is a TOML array of strings. */
export function configListArg(key: string, values: readonly string[]): string[] {
  return ['-c', `${key}=${JSON.stringify(values)}`];
}

/** A `-c key=value` override whose value is a TOML boolean. */
export function configFlagArg(key: string, value: boolean): string[] {
  return ['-c', `${key}=${value}`];
}

/** A `-c key=value` override whose value is a TOML inline table of strings: `{ "a" = "1", "b" = "2" }`. */
export function configTableArg(key: string, table: Readonly<Record<string, string>>): string[] {
  const pairs = Object.entries(table).map(
    ([name, value]) => `${JSON.stringify(name)} = ${JSON.stringify(value)}`,
  );
  return ['-c', `${key}={ ${pairs.join(', ')} }`];
}
