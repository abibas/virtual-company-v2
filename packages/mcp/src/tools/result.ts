/** What every tool answers with, and the path from the login to the company a tool acts in. */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Fetch } from '@mwc/cli/api/client';
import { openSession, type Session } from '@mwc/cli/api/session';
import { type Env, resolveAuth } from '../auth.ts';

/** What the tools reach: the environment (the login, read on every call) and the mwc API, through fetch. */
export interface ToolDeps {
  readonly env: Env;
  readonly fetch: Fetch;
}

/** A tool's answer: a readable text, then the same as compact JSON. */
export function answer(text: string, json: unknown): CallToolResult {
  return {
    content: [
      { type: 'text', text },
      { type: 'text', text: JSON.stringify(json) },
    ],
  };
}

/** A refusal as an MCP tool error carrying the message (the server's own, when it refused), never a crash. */
export function toolError(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** How a refusal tells Claude to name another company. */
const COMPANY_HINT = 'the company argument (a slug)';

/** Runs `work` in the company the login acts in (`company`, else its own), or answers why it cannot. */
export async function inCompany(
  deps: ToolDeps,
  company: string | undefined,
  work: (session: Session) => Promise<CallToolResult>,
): Promise<CallToolResult> {
  const auth = resolveAuth(deps.env);
  if (!auth.ok) return toolError(auth.message);
  const opened = await openSession(deps.fetch, auth.value, { company, hint: COMPANY_HINT });
  return opened.ok ? work(opened.value) : toolError(opened.message);
}
