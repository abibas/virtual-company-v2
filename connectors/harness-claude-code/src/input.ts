import { clipHead, isRecord, type JsonRecord, stringOf } from '@mwc/harness-core';
import { CHAT_PROMPT } from '@mwc/shared/chats';
import type { TurnEventOf } from '@mwc/shared/harness';
import { bodyOf } from './state.ts';

/**
 * Claude Code's stream-json input (S5.2 step 6, docs/harness.md "Delivery while a turn runs"; verified against
 * `claude --help` 2.1.321): a turn runs with `--input-format stream-json` and `--replay-user-messages`, so it reads one
 * user message per stdin line while it works, folds one sent mid-turn into the turn at its next step (one that comes as
 * the turn ends runs as one more turn in the same process), and echoes each message it takes as a `user` message with
 * `isReplay: true` and the message's `uuid`: the receipt the runner waits for.
 */

/** The arguments that make a print-mode turn read user messages from stdin and echo each one it takes. */
export const INPUT_ARGS = ['--input-format', 'stream-json', '--replay-user-messages'] as const;

/** One stdin line: a user message with `text`, its `uuid` the id its echo carries back. */
export function userLine(text: string, uuid: string): string {
  const message = { role: 'user', content: [{ type: 'text', text }] };
  return `${JSON.stringify({ type: 'user', uuid, session_id: '', parent_tool_use_id: null, message })}\n`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for Claude Code's echo of a message it took from stdin. */
export const isReplay = (message: JsonRecord): boolean =>
  message.type === 'user' && message.isReplay === true;

/** The text of a user message: its string content, or its text blocks joined. */
function textOf(message: JsonRecord): string {
  const content = bodyOf(message).content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(isRecord)
    .map((block) => (block.type === 'text' ? (stringOf(block.text) ?? '') : ''))
    .join('');
}

/**
 * The echo of a message as an `input` event (the runner keeps only those of the messages it wrote, with its own text);
 * nothing for an echo without a usable `uuid`.
 */
export function inputEvent(message: JsonRecord): TurnEventOf<'input'> | undefined {
  const inputId = stringOf(message.uuid);
  if (inputId === undefined || !UUID.test(inputId)) return undefined;
  const text = clipHead(textOf(message), CHAT_PROMPT.max) || '…';
  return { type: 'input', text, inputId: inputId.toLowerCase() };
}
