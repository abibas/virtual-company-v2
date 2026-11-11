import { TOOL_RESULT_MAX } from '@mwc/shared/flows';
import type { TurnArtifact, TurnTool, TurnToolResult } from '@mwc/shared/runner-protocol';
import type { Logger } from 'pino';
import { artifactAssembler, type CollectedArtifact } from './artifacts.ts';

/**
 * The agents' tool calls of the hub's turns (S6a, docs/runner-protocol.md "Chat turns"): a `turn.tool` goes to the turn's
 * sink (the chats module, which asks the tasks module) and its answer goes back to the same connection as
 * `turn.tool.result`, by the call's id, on the connection that carries the turn when it is ready. A file `task_attach {path}` sends comes first as `turn.artifact` parts carrying
 * the call's id: they are put together and checked apart from the turn's collection, and handed over with the call.
 * The hub only relays: every rule is the sink's.
 */

/** A call as the sink gets it: the tool, its input as the runner sent it, and the file the call sent with it. */
export interface TurnToolCall {
  readonly callId: string;
  readonly tool: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** A file of the turn's outputs folder `task_attach {path}` sent, put together and checked; none for any other. */
  readonly file?: CollectedArtifact | undefined;
}

/** The answer the tool returns to the agent. */
export interface TurnToolReply {
  readonly ok: boolean;
  readonly text: string;
}

/** Who answers a turn's calls: its sink's `tool`, if it takes any. */
export type ToolAnswer = ((call: TurnToolCall) => Promise<TurnToolReply>) | undefined;

export const NO_TOOLS = 'This turn takes no tool calls: the server offers it no tools.';
export const TOOL_FAILED = 'The tool could not be carried out on the server; nothing was changed.';

/** The answer's text, cut to the frame's limit and never empty. */
export const replyText = (text: string): string => {
  const words = text.trim() === '' ? TOOL_FAILED : text;
  return words.length <= TOOL_RESULT_MAX ? words : `${words.slice(0, TOOL_RESULT_MAX - 1)}…`;
};

/** The hub's tool calls: the files on their way, by turn and call. */
export function toolCalls(options: { readonly logger?: Logger | undefined } = {}) {
  const { logger } = options;
  const files = new Map<string, Map<string, ReturnType<typeof artifactAssembler>>>();
  const ready = new Map<string, CollectedArtifact>();
  const key = (turnId: string, callId: string) => `${turnId}:${callId}`;
  return {
    /** A part of a file a call attaches; the file is kept once whole and checked, until its call comes. */
    part(frame: TurnArtifact & { readonly callId: string }): void {
      const calls = files.get(frame.turnId) ?? new Map<string, ReturnType<typeof artifactAssembler>>();
      files.set(frame.turnId, calls);
      const assembler = calls.get(frame.callId) ?? artifactAssembler();
      calls.set(frame.callId, assembler);
      const done = assembler.part(frame);
      if (done === undefined) return;
      calls.delete(frame.callId);
      if ('dropped' in done)
        logger?.warn(
          { turnId: frame.turnId, path: frame.path, why: done.dropped },
          'an attached file was dropped',
        );
      else ready.set(key(frame.turnId, frame.callId), done);
    },
    /** A call: its sink answers (with the file it sent), and `send` takes the answer back to the runner. */
    call(frame: TurnTool, answer: ToolAnswer, send: (result: TurnToolResult) => void): void {
      const { turnId, callId, tool, input } = frame;
      const file = ready.get(key(turnId, callId));
      ready.delete(key(turnId, callId));
      files.get(turnId)?.delete(callId);
      const reply = (result: TurnToolReply) =>
        send({ type: 'turn.tool.result', turnId, callId, ok: result.ok, text: replyText(result.text) });
      if (answer === undefined) {
        reply({ ok: false, text: NO_TOOLS });
        return;
      }
      void answer({ callId, tool, input, ...(file === undefined ? {} : { file }) }).then(
        reply,
        (error: unknown) => {
          logger?.error({ err: error, turnId, tool }, 'a tool call failed');
          reply({ ok: false, text: TOOL_FAILED });
        },
      );
    },
    /** The turn ended: its files on their way go. */
    drop(turnId: string): void {
      files.delete(turnId);
      for (const name of ready.keys()) if (name.startsWith(`${turnId}:`)) ready.delete(name);
    },
  };
}

export type ToolCalls = ReturnType<typeof toolCalls>;
