import { ASK_LIMITS, ASK_SERVER, ASK_TOOL, type AskQuestions } from '@mwc/shared/harness';
import { z } from 'zod';

/**
 * The runner's one MCP tool (docs/harness.md, "Asking the person"): `ask_user_question`, in the shape of Claude Code's
 * own AskUserQuestion (1–4 questions, each with a header and 2–8 options, one pick or several). Its description says
 * when to use it and that the answer comes as the person's next message; its reply tells the agent to end its turn.
 * And the line protocol of the turn's private socket, between the MCP server (`runner.mjs mcp`) and the runner.
 */

/** The MCP server's name in its `initialize` answer (the harnesses name its tools after it: `mcp__mwc__…`). */
export const MCP_SERVER_NAME = ASK_SERVER;

/** What the tool answers once the runner showed the question: the agent ends its turn and waits. */
export const ASK_REPLY =
  'Your question is shown to the person. End your turn now; their answer comes as their next message.';

const DESCRIPTION =
  'Ask the person one to four multiple-choice questions when they must choose between options (an approach, a ' +
  'library, what to do next) and you cannot decide for them. Each question has a short header, 2–8 options with ' +
  'a one-line description each, and allows one pick or several (multiSelect); the person can also write their own ' +
  'answer. The questions show in the chat; after calling it, end your turn: the answers come as the next message.';

const text = (maxLength: number, description: string) => ({
  type: 'string',
  minLength: 1,
  maxLength,
  description,
});

/** The tool as `tools/list` gives it: its input is `{ questions }`, the limits those of `@mwc/shared`'s `AskInput`. */
export const ASK_TOOL_DEFINITION = {
  name: ASK_TOOL,
  title: 'Ask the person',
  description: DESCRIPTION,
  inputSchema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: ASK_LIMITS.questions.min,
        maxItems: ASK_LIMITS.questions.max,
        description: 'The questions, each asked once',
        items: {
          type: 'object',
          properties: {
            question: text(ASK_LIMITS.question, 'The question, ending with a question mark'),
            header: text(ASK_LIMITS.header, 'A very short label shown above it, e.g. "Database"'),
            options: {
              type: 'array',
              minItems: ASK_LIMITS.options.min,
              maxItems: ASK_LIMITS.options.max,
              items: {
                type: 'object',
                properties: {
                  label: text(ASK_LIMITS.label, 'The choice, short; each option has its own'),
                  description: {
                    type: 'string',
                    maxLength: ASK_LIMITS.description,
                    description: 'One line on what it means or implies',
                  },
                },
                required: ['label', 'description'],
              },
            },
            multiSelect: { type: 'boolean', description: 'True when the person may pick several' },
          },
          required: ['question', 'header', 'options', 'multiSelect'],
        },
      },
    },
    required: ['questions'],
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
} as const;

/** The name of the socket in a turn's folder. */
export const ASK_SOCKET_FILE = 'ask.sock';

/** The longest line either side of the socket sends; a longer request is refused. */
export const ASK_LINE_MAX = 64 * 1024;

/** The MCP server's request to the runner: the token of the turn's socket and the questions. */
export const AskRequest = z.object({ token: z.string().min(1).max(200), questions: z.unknown() });

/** The runner's answer: the text the tool returns, or why the questions were not shown. */
export const AskReply = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), text: z.string() }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type AskReply = z.infer<typeof AskReply>;

/** What the runner does with a turn's questions (`turns/turn.ts`): shows them, or says why not. */
export type AskHandler = (questions: AskQuestions) => AskReply;
