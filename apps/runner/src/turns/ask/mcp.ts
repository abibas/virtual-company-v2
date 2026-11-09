import { ASK_TOOL, AskInput, type AskQuestions } from '@mwc/shared/harness';
import { ASK_TOOL_DEFINITION, type AskReply, MCP_SERVER_NAME } from './tool.ts';

/**
 * The runner's MCP server, by hand (docs/harness.md, "Asking the person"): JSON-RPC 2.0 messages, one per line, as the
 * stdio transport carries them. It answers `initialize` (tools only), `ping`, `tools/list` (one tool) and `tools/call`
 * of `ask_user_question`: the input is checked first (a bad one is a tool error the model reads and corrects), then
 * relayed to the runner (`ask`), whose text is the tool's result. Notifications (`notifications/initialized`) get no
 * answer; an unknown method is -32601, a line that is no JSON -32700, anything else that is no request -32600.
 */

/** The protocol versions it speaks, newest first; a client asking for another gets the newest. */
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const;

export const JSON_RPC = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
};

/** Relays a tool call's questions to the runner that started the turn. */
export type AskRelay = (questions: AskQuestions) => Promise<AskReply>;

type Id = string | number | null;
type Message = Record<string, unknown>;

const isRecord = (value: unknown): value is Message =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isId = (value: unknown): value is Id =>
  typeof value === 'string' || (typeof value === 'number' && Number.isInteger(value)) || value === null;

const result = (id: Id, value: unknown) => ({ jsonrpc: '2.0', id, result: value });
const failure = (id: Id, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
const toolText = (text: string, isError = false) => ({
  content: [{ type: 'text', text }],
  ...(isError ? { isError: true } : {}),
});

/** What a bad input's issues say, one per line, with where (`questions.0.options`). */
function issuesText(issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[]) {
  const lines = issues.slice(0, 10).map((issue) => {
    const where = issue.path.map(String).join('.');
    return where === '' ? issue.message : `${where}: ${issue.message}`;
  });
  return `The questions were not shown; fix them and call ${ASK_TOOL} again:\n${lines.join('\n')}`;
}

export interface McpServerOptions {
  readonly version: string;
  readonly ask: AskRelay;
}

export class McpServer {
  readonly #options: McpServerOptions;

  constructor(options: McpServerOptions) {
    this.#options = options;
  }

  /** The answer to one line, as a line of JSON; undefined for a notification. */
  async line(text: string): Promise<string | undefined> {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return JSON.stringify(failure(null, JSON_RPC.parseError, 'Parse error'));
    }
    const answer = await this.handle(message);
    return answer === undefined ? undefined : JSON.stringify(answer);
  }

  /** The answer to one message; undefined for a notification (or a response, which a server never waits for). */
  async handle(message: unknown): Promise<object | undefined> {
    if (!isRecord(message) || message.jsonrpc !== '2.0') {
      const id = isRecord(message) && isId(message.id) ? message.id : null;
      return failure(id, JSON_RPC.invalidRequest, 'Invalid Request');
    }
    if (!('id' in message)) return undefined;
    const { id } = message;
    if (!isId(id) || typeof message.method !== 'string') {
      return 'result' in message || 'error' in message
        ? undefined
        : failure(isId(id) ? id : null, JSON_RPC.invalidRequest, 'Invalid Request');
    }
    const params = isRecord(message.params) ? message.params : {};
    switch (message.method) {
      case 'initialize':
        return result(id, this.#initialize(params));
      case 'ping':
        return result(id, {});
      case 'tools/list':
        return result(id, { tools: [ASK_TOOL_DEFINITION] });
      case 'tools/call':
        return this.#call(id, params);
      default:
        return failure(id, JSON_RPC.methodNotFound, `Method not found: ${message.method}`);
    }
  }

  #initialize(params: Message) {
    const asked = params.protocolVersion;
    const known = MCP_PROTOCOL_VERSIONS.find((version) => version === asked);
    return {
      protocolVersion: known ?? MCP_PROTOCOL_VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: MCP_SERVER_NAME, title: 'Most Wanted Corp', version: this.#options.version },
    };
  }

  async #call(id: Id, params: Message) {
    if (params.name !== ASK_TOOL) {
      return failure(id, JSON_RPC.invalidParams, `Unknown tool: ${String(params.name)}`);
    }
    const input = AskInput.safeParse(params.arguments ?? {});
    if (!input.success) return result(id, toolText(issuesText(input.error.issues), true));
    let reply: AskReply;
    try {
      reply = await this.#options.ask(input.data.questions);
    } catch (error) {
      reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return result(id, reply.ok ? toolText(reply.text) : toolText(reply.error, true));
  }
}
