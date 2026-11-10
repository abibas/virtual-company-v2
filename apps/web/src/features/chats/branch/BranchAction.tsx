import { GitBranch } from 'lucide-react';
import { cx } from '../../../components/cx.ts';
import { useAction } from '../use-action.ts';
import type { BranchState } from './branch-state.ts';

/**
 * Branch under an agent's reply (the `more` slot of `MessageActions`): starts a new chat that continues the
 * conversation from this reply and opens it; disabled with its reason as the tooltip where the reply cannot branch.
 */
export function BranchAction({
  state,
  onBranch,
}: {
  readonly state: Exclude<BranchState, { kind: 'hidden' }>;
  readonly onBranch: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const disabled = state.kind === 'disabled';
  const tip = disabled ? state.why : 'Branch: continue in a new chat from here';
  return (
    <>
      <button
        type="button"
        aria-label="Branch conversation from this reply"
        title={tip}
        aria-disabled={disabled || busy || undefined}
        onClick={() => {
          if (!disabled && !busy) void run(onBranch);
        }}
        className={cx(
          'inline-flex h-7 shrink-0 items-center gap-1 rounded-sm px-2 text-xs font-semibold text-dim transition-colors',
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-surface-3 hover:text-ink',
          busy && 'cursor-progress opacity-70',
        )}
      >
        <GitBranch size={14} aria-hidden="true" />
        <span>Branch</span>
      </button>
      {error && (
        <span role="alert" className="max-w-64 truncate text-2xs font-medium text-failed" title={error}>
          {error}
        </span>
      )}
    </>
  );
}
