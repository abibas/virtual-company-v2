/**
 * `mwc task artifact <key> <name> [--step <step>] [--round <n>] [--out <path>]` (S5.3b): one of a task's artifacts, the
 * latest of that name (`--step`, by its name or id, and `--round` pick another), printed when it is text, or saved to
 * `--out` (a file, or a folder it goes into under its own name). 0 when done, 1 when refused (with the server's or its
 * own words), 2 for a usage error (the caller's shape check).
 */
import { statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { type CompanyCommandDeps, fail } from '../account/connect.ts';
import { refusal, type Session } from '../api/session.ts';
import { downloadArtifact, listArtifacts, type TaskArtifact } from '../api/tasks.ts';
import type { ParsedArgs } from '../args.ts';
import type { MainIo } from '../io.ts';
import { companyJson } from '../org/render.ts';
import { sizeText } from './render.ts';

const COMMAND = 'mwc task artifact';

/** The artifact the words name (see above), or why none. */
export function findArtifact(
  artifacts: readonly TaskArtifact[],
  name: string,
  options: { readonly step?: string | undefined; readonly round?: string | undefined },
): TaskArtifact | string {
  const step = options.step?.trim().toLowerCase();
  const named = artifacts.filter(
    (a) =>
      a.name === name &&
      (step === undefined || a.step.id === options.step || a.step.name.toLowerCase() === step) &&
      (options.round === undefined || String(a.round) === options.round),
  );
  const found = named.at(-1);
  if (found !== undefined) return found;
  const names = [...new Set(artifacts.map((a) => a.name))];
  return `no artifact "${name}"${step ? ` at ${options.step}` : ''}${options.round ? ` in round ${options.round}` : ''}; it has ${names.join(', ') || 'none'}`;
}

/** Where `--out` puts the file: the path as given (from where mwc was started), or inside it when it is a folder. */
function outPath(io: MainIo, out: string, artifact: TaskArtifact): string {
  const path = resolve(io.env?.INIT_CWD ?? io.cwd, out);
  try {
    if (statSync(path).isDirectory())
      return join(path, basename(artifact.name === 'hand-off note' ? 'hand-off-note.md' : artifact.name));
  } catch {
    // Not there yet: a new file.
  }
  return path;
}

const isText = (contentType: string) =>
  contentType.startsWith('text/') || contentType.startsWith('application/json');

/** `mwc task artifact …` in the session's company (see above). */
export async function artifactCommand(
  io: MainIo,
  args: ParsedArgs,
  deps: CompanyCommandDeps,
  session: Session,
): Promise<number> {
  const [, key = '', name = ''] = args.positionals;
  const { step, round, out } = args.options;
  if (round !== undefined && !/^[1-9]\d{0,3}$/.test(round))
    return fail(io, COMMAND, '--round must be a round number', 2);
  const { server, company } = session;
  const listed = await listArtifacts(deps.fetch, server, session.key, company.companyId, key);
  if (!listed.ok) return fail(io, COMMAND, refusal(server, listed));
  const artifact = findArtifact(listed.body, name, { step, round });
  if (typeof artifact === 'string') return fail(io, COMMAND, artifact);
  if (artifact.contentType === null)
    return fail(io, COMMAND, `${artifact.name} has no content (${artifact.note ?? artifact.kind})`);
  const got = await downloadArtifact(deps.fetch, server, session.key, company.companyId, key, artifact.id);
  if (!got.ok) return fail(io, COMMAND, refusal(server, got));
  const where = `${artifact.name} (${artifact.step.name}, round ${artifact.round})`;
  if (out === undefined && !isText(got.body.contentType)) {
    return fail(io, COMMAND, `${where} is ${got.body.contentType}: save it with --out <file>`);
  }
  const saved = out === undefined ? null : outPath(io, out, artifact);
  if (saved !== null) writeFileSync(saved, got.body.bytes);
  const text = saved === null ? new TextDecoder().decode(got.body.bytes) : null;
  if (args.flags.has('json')) {
    const result = { artifact, out: saved, ...(text === null ? {} : { text }) };
    io.stdout(`${JSON.stringify({ company: companyJson(company), result }, null, 2)}\n`);
  } else if (text !== null) {
    io.stdout(text.endsWith('\n') ? text : `${text}\n`);
  } else {
    io.stdout(`${key.toUpperCase()} ${where} saved to ${saved} (${sizeText(got.body.bytes.length)})\n`);
  }
  return 0;
}
