import { Spinner } from '../../../../components/ui/Button.tsx';
import type { ToolCall } from '../model/parts.ts';
import { addUp, toolIcon } from '../model/tool-kinds.ts';
import { ACTIVITY_ROW, Disclosure } from './Disclosure.tsx';
import { ToolCallRow } from './ToolCallRow.tsx';

/**
 * Consecutive tool calls as one quiet row (S5.2): "Ran 3 commands, read 2 files", a spinner while one runs and the
 * failures counted, opening to each call. A single call is its own row.
 */
export function ToolGroup({
  calls,
  running,
}: {
  readonly calls: readonly ToolCall[];
  readonly running: boolean;
}) {
  const [first] = calls;
  if (first === undefined) return null;
  if (calls.length === 1) return <ToolCallRow call={first} running={running} />;
  const Icon = toolIcon(first.name);
  const failures = calls.filter((call) => call.result?.ok === false).length;
  const busy = running && calls.some((call) => call.result === undefined);
  return (
    <Disclosure
      buttonClassName={ACTIVITY_ROW}
      summary={
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <Icon size={13} aria-hidden="true" className="shrink-0 text-faint" />
          <span className="min-w-0 truncate">{addUp(calls.map((call) => call.name))}</span>
          {failures > 0 && <span className="shrink-0 font-semibold text-failed">· {failures} failed</span>}
          {busy && (
            <span className="ml-auto flex shrink-0">
              <Spinner size={12} className="text-blue" />
            </span>
          )}
        </span>
      }
    >
      <ol className="ml-3.5 grid gap-px border-l border-line py-0.5 pl-1.5">
        {calls.map((call) => (
          <li key={call.id}>
            <ToolCallRow call={call} running={running} />
          </li>
        ))}
      </ol>
    </Disclosure>
  );
}
