import { Check, X } from 'lucide-react';
import { Spinner } from '../../../../components/ui/Button.tsx';
import type { ToolCall } from '../model/parts.ts';
import type { ToolWords } from '../model/tool-kinds.ts';

/** The small pieces every activity row shares (S5.2): an action's words, and a call's state as a mark. */

/** "Running `pnpm test`": the verb, then what it acts on as code, cut to the row. */
export function ActionWords({ words }: { readonly words: ToolWords }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="shrink-0">{words.verb}</span>
      {words.target !== undefined && (
        <code className="min-w-0 truncate rounded-xs bg-surface-3/70 px-1 font-mono text-[0.92em] text-ink-2">
          {words.target}
        </code>
      )}
    </span>
  );
}

/** A spinner while the call runs (or `running` says so), a check once it worked, a cross when it failed. */
export function CallMark({ call, running }: { readonly call: ToolCall; readonly running: boolean }) {
  if (call.result === undefined) {
    return running ? (
      <Spinner size={12} className="text-blue" />
    ) : (
      <span aria-hidden="true" className="size-3 shrink-0 rounded-full border border-line-2" />
    );
  }
  return call.result.ok ? (
    <Check size={13} strokeWidth={2.5} aria-label="done" className="shrink-0 text-done" />
  ) : (
    <X size={13} strokeWidth={2.5} aria-label="failed" className="shrink-0 text-failed" />
  );
}
