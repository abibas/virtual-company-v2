import { answer } from '../rules/answer.ts';

/** A server tool's answer (S7.1c, shared by GitHub's since S7.1d): what it did or found, or why not, in words. */
export interface ToolReply {
  readonly ok: boolean;
  readonly text: string;
}

export const done = (value: unknown): ToolReply => ({ ok: true, text: answer(value) });
export const refused = (text: string): ToolReply => ({ ok: false, text });

/** What an audit row keeps of a long text: its start. */
export const excerpt = (text: string) => (text.length <= 500 ? text : `${text.slice(0, 499)}…`);

/** What a tool that failed on the server answers: nothing was changed. */
export const TOOL_FAILED = 'The tool could not be carried out on the server; nothing was changed.';
