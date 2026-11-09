/**
 * `mwc machine enroll-token [--company <slug>] [--server <url>]`: a one-time enrollment token from the company's API (as
 * an admin or owner) and the commands that install a runner with it on This Mac, the Airia devbox and a container
 * (`render.ts`). 0 when printed, 1 when not logged in or refused, 2 for a usage error.
 */
import { type CompanyCommandDeps, connect, fail, usageError } from '../account/connect.ts';
import { createEnrollmentToken, getPublicConfig } from '../api/machines.ts';
import { refusal } from '../api/session.ts';
import type { ParsedArgs } from '../args.ts';
import type { MainIo } from '../io.ts';
import { enrollTokenText } from './render.ts';

export const MACHINE_USAGE = 'usage: mwc machine enroll-token [--company <slug>] [--server <url>]';

export async function machineCommand(
  args: ParsedArgs,
  io: MainIo,
  deps: CompanyCommandDeps,
): Promise<number> {
  const usage = usageError(args, 'enroll-token', ['company', 'server']);
  if (usage !== undefined) return fail(io, 'mwc machine', `${usage}\n${MACHINE_USAGE}`, 2);
  const command = 'mwc machine enroll-token';
  const session = await connect(command, args, io, deps);
  if (typeof session === 'number') return session;
  const { server, key, company } = session;
  const made = await createEnrollmentToken(deps.fetch, server, key, company.companyId);
  if (!made.ok) return fail(io, command, refusal(server, made));
  const config = await getPublicConfig(deps.fetch, server, key);
  const apiUrl = config.ok ? config.body.apiUrl : null;
  const localPower = config.ok && config.body.localPower;
  const { token, expiresAt } = made.body;
  io.stdout(enrollTokenText({ company, token, expiresAt, server, apiUrl, localPower }));
  return 0;
}
