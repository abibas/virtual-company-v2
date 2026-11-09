import type { ReactNode } from 'react';
import { CopyButton } from '../../components/forms/CopyButton.tsx';

/** A command in a mono box, with Copy command on the right and an optional part (a countdown) on its left. */
export function CommandBox({ command, aside }: { readonly command: string; readonly aside?: ReactNode }) {
  return (
    <>
      <pre className="overflow-x-auto rounded-xl bg-surface-2 px-4 py-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-ink-2">
        <code>{command}</code>
      </pre>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {aside ?? <span />}
        <CopyButton text={command} label="Copy command" />
      </div>
    </>
  );
}
