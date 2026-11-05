import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { checkLogin } from '@mwc/cli/api/session';
import { apiKeyPrefix } from '@mwc/shared/api-keys';
import { resolveAuth } from '../auth.ts';
import { answer, type ToolDeps, toolError } from './result.ts';

export const ME_DESCRIPTION =
  'Who you are in Most Wanted Corp, the organization of people and AI agents this MCP server reads. Returns a short ' +
  'text, then JSON {server, user: {id, email, displayName}, key: {prefix, source}, companies: [{id, slug, name, ' +
  'role, status}]}: the server it talks to, your user, the personal API key in use (its prefix only; source "env" ' +
  'for MWC_API_KEY, "mwc login" for the saved login) and the companies that key reaches with your role (owner, ' +
  'admin, member, viewer) and membership status in each. A personal key reaches exactly one company, which the ' +
  'other tools use by default. Call it first when unsure who or where you are.';

/** `me`: the user behind the key and the companies it reaches, from `GET /api/me`. */
export async function me(deps: ToolDeps): Promise<CallToolResult> {
  const auth = resolveAuth(deps.env);
  if (!auth.ok) return toolError(auth.message);
  const login = auth.value;
  const checked = await checkLogin(deps.fetch, login);
  if (!checked.ok) return toolError(checked.message);
  const { user, memberships } = checked.value;
  const key = { prefix: apiKeyPrefix(login.key), source: login.source === 'env' ? 'env' : 'mwc login' };
  const companies = memberships.map((m) => ({
    id: m.companyId,
    slug: m.slug,
    name: m.name,
    role: m.role,
    status: m.status,
  }));
  const text = [
    `You are ${user.displayName || user.email} <${user.email}> on ${login.server}, ` +
      `with the key ${key.prefix}... (${key.source}).`,
    ...(companies.length === 0
      ? ["The key's company is not available any more (deleted, or you are no longer a member)."]
      : companies.map((c) => `Company: ${c.name} (${c.slug}), your role ${c.role}, membership ${c.status}.`)),
  ].join('\n');
  const { id, email, displayName } = user;
  return answer(text, { server: login.server, user: { id, email, displayName }, key, companies });
}
