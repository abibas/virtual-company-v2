import type { ToolCall } from '../model/parts.ts';
import { familyOf, toolIcon, toolWords } from '../model/tool-kinds.ts';
import { ActionWords, CallMark } from './ActionWords.tsx';
import { ACTIVITY_ROW, Disclosure } from './Disclosure.tsx';
import { ToolOutput } from './ToolOutput.tsx';

/**
 * One tool call (S5.2): its icon, its words and its mark, opening to its input and its result: whole when the harness
 * gave them (2026-11-14, the full trace), else the one-line input and the start of the result.
 */
export function ToolCallRow({ call, running }: { readonly call: ToolCall; readonly running: boolean }) {
  const Icon = toolIcon(call.name);
  const done = call.result !== undefined;
  const failed = call.result?.ok === false;
  const inputLabel = familyOf(call.name) === 'command' ? 'Command' : `Input · ${call.name}`;
  return (
    <Disclosure
      buttonClassName={ACTIVITY_ROW}
      summary={
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Icon size={13} aria-hidden="true" className="shrink-0 text-faint" />
          <ActionWords words={toolWords(call.name, call.summary, done || !running)} />
          <span className="ml-auto flex shrink-0 items-center">
            <CallMark call={call} running={running} />
          </span>
        </span>
      }
    >
      <div className="grid gap-2 py-1.5 pr-1 pl-5">
        {(call.input ?? call.summary) && <ToolOutput label={inputLabel} text={call.input ?? call.summary} />}
        {call.result ? (
          <ToolOutput
            label={failed ? 'Error' : 'Output'}
            failed={failed}
            text={call.result.output ?? (call.result.summary || '(no output)')}
          />
        ) : (
          <p className="text-2xs text-faint">
            {running ? 'Still running…' : 'No result: the turn ended first.'}
          </p>
        )}
      </div>
    </Disclosure>
  );
}
