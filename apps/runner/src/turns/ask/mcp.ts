import { type AgentTool, checkToolInput, type InputIssue, issueLines } from '@mwc/shared/flows';
import { ASK_TOOL, AskInput, type AskQuestions, type ServerToolDef } from '@mwc/shared/harness';
import { agentToolDefinition } from './agent-tools.ts';
import { serverToolDefinition, serverToolInput } from './server-tools.ts';
import { ASK_TOOL_DEFINITION, type AskReply, MCP_SERVER_NAME } from './tool.ts';

/**
 * The runner's MCP server, by hand (docs/harness.md, "Asking the person" and "Agents' tools"): JSON-RPC 2.0 messages,
 * one per line, as the stdio transport carries them. It answers `initialize` (tools only), `ping`, `tools/list` (the
 * question tool, then the turn's agents' tools, S6a, then the server's own, S7.1c) and `tools/call` of one of them: the
 * input is checked first (a bad one is a tool error the model reads and corrects; a server tool's only for being an
 * object, since the server checks it), then relayed to the runner (`ask`, `call`), whose text is the tool's result. A tool this turn does not offer is -32602. Notifications (`notifications/initialized`) get no answer;
 * an unknown method is -32601, a line that is no JSON -32700, anything else that is no request -32600.
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

/** Relays a call of an agents' tool (S6a) or a server tool (S7.1c), its input checked, to the turn's runner. */
export type ToolRelay = (call: {
  readonly tool: string;
  readonly input: Record<string, unknown>;
}) => Promise<AskReply>;

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

/** What a bad question input's issues say, one per line, with where (`questions.0.options`). */
const issuesText = (issues: readonly InputIssue[]) =>
  `The questions were not shown; fix them and call ${ASK_TOOL} again:\n${issueLines(issues)}`;

/** A relay's answer as the tool's result: its text, or its error (a thrown one too) as a tool error. */
async function relayed(relay: () => Promise<AskReply>) {
  let reply: AskReply;
  try {
    reply = await relay();
  } catch (error) {
    reply = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return reply.ok ? toolText(reply.text) : toolText(reply.error, true);
}

export interface McpServerOptions {
  readonly version: string;
  readonly ask: AskRelay;
  /** The agents' tools this turn offers (S6a); none: the question tool alone. */
  readonly tools?: readonly AgentTool[];
  /** The server's own tools this turn offers (S7.1c), after the agents' tools. */
  readonly serverTools?: readonly ServerToolDef[];
  /** Where their calls go; required with `tools`. */
  readonly call?: ToolRelay;
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
        return result(id, {
          tools: [
            ASK_TOOL_DEFINITION,
            ...this.#tools.map(agentToolDefinition),
            ...this.#serverTools.map(serverToolDefinition),
          ],
        });
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

  get #tools(): readonly AgentTool[] {
    return this.#options.call === undefined ? [] : (this.#options.tools ?? []);
  }

  get #serverTools(): readonly ServerToolDef[] {
    return this.#options.call === undefined ? [] : (this.#options.serverTools ?? []);
  }

  async #call(id: Id, params: Message) {
    const agentTool = this.#tools.find((tool) => tool === params.name);
    if (agentTool !== undefined) return this.#agentTool(id, agentTool, params.arguments);
    const serverTool = this.#serverTools.find((tool) => tool.name === params.name);
    if (serverTool !== undefined) return this.#serverTool(id, serverTool.name, params.arguments);
    if (params.name !== ASK_TOOL) {
      return failure(id, JSON_RPC.invalidParams, `Unknown tool: ${String(params.name)}`);
    }
    const input = AskInput.safeParse(params.arguments ?? {});
    if (!input.success) return result(id, toolText(issuesText(input.error.issues), true));
    return result(id, await relayed(() => this.#options.ask(input.data.questions)));
  }

  /** An agents' tool's call: its input checked, then relayed; the runner's text is the result. */
  async #agentTool(id: Id, tool: AgentTool, args: unknown) {
    const checked = checkToolInput(tool, args);
    if (!checked.ok) return result(id, toolText(checked.error, true));
    const call = this.#options.call as ToolRelay;
    return result(id, await relayed(() => call({ tool, input: checked.input })));
  }

  /** A server tool's call (S7.1c): its input an object, relayed as it is; the server checks it and answers. */
  async #serverTool(id: Id, tool: string, args: unknown) {
    const input = serverToolInput(tool, args);
    if (!input.ok) return result(id, toolText(input.error, true));
    const call = this.#options.call as ToolRelay;
    return result(id, await relayed(() => call({ tool, input: input.input })));
  }
}
