import type { Loaded } from '../../../api/use-load.ts';
import { LoadState } from '../../../components/data/LoadState.tsx';
import { CopyButton } from '../../../components/forms/CopyButton.tsx';
import { Skeleton } from '../../../components/ui/Skeleton.tsx';

/** The flow's written form (`GET …/flows/:id/text`, what people and agents read), in monospace, with Copy. */
export function FlowText({ text }: { readonly text: Loaded<string> }) {
  return (
    <section aria-label="Written form" className="relative rounded-xl bg-surface-2 ring-1 ring-line">
      <LoadState loaded={text} label="Loading the written form…" skeleton={<Skeleton className="m-4 h-24" />}>
        {(written) => (
          <>
            <div className="absolute top-2 right-2">
              <CopyButton text={written} tone="quiet" />
            </div>
            <pre className="scroll-quiet overflow-x-auto p-4 pr-24 font-mono text-xs leading-relaxed text-ink-2">
              {written}
            </pre>
          </>
        )}
      </LoadState>
    </section>
  );
}
