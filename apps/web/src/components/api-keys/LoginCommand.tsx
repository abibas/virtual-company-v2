import { CopyButton } from '../forms/CopyButton.tsx';

/**
 * The `mwc login` command for this server and company, to paste into a terminal. The key is not in it: `mwc` reads
 * it from the clipboard through a pipe (never as an argument, so it stays out of the shell history).
 */
export function LoginCommand({ apiUrl, companyId }: { readonly apiUrl: string; readonly companyId: string }) {
  const command = `pbpaste | pnpm mwc login --server ${apiUrl} --company ${companyId}`;
  return (
    <div className="flex flex-col gap-3">
      <pre className="overflow-x-auto rounded-sm border border-line bg-ground px-3 py-2.5 font-mono text-[12.5px] text-ink-2">
        <code>{command}</code>
      </pre>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-dim">
          Copy your key first, then run this in the repository. On Linux, pipe it from your clipboard tool, or
          set <code className="font-mono">MWC_API_KEY</code> for that one command.
        </p>
        <CopyButton text={command} label="Copy command" />
      </div>
    </div>
  );
}
