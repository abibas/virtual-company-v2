import { WrapText } from 'lucide-react';
import { useState } from 'react';
import { cx } from '../../../../components/cx.ts';
import { CopyAction } from './CopyAction.tsx';

/** A fenced code block (S5.2): its language, a wrap toggle and Copy above it, the code scrolling sideways or wrapped. */
export function CodeBlock({ lang, code }: { readonly lang: string | undefined; readonly code: string }) {
  const [wrap, setWrap] = useState(false);
  return (
    <figure className="my-0.5 min-w-0 overflow-hidden rounded-xl bg-surface-2 ring-1 ring-line ring-inset">
      <figcaption className="flex h-8 items-center gap-1 border-b border-line pr-1.5 pl-3">
        <span className="min-w-0 flex-1 truncate font-mono text-2xs text-dim">{lang || 'text'}</span>
        <button
          type="button"
          onClick={() => setWrap(!wrap)}
          aria-pressed={wrap}
          aria-label="Wrap long lines"
          title="Wrap long lines"
          className={cx(
            'inline-flex size-6 cursor-pointer items-center justify-center rounded-sm transition-colors hover:bg-surface-3 hover:text-ink',
            wrap ? 'bg-blue-soft text-blue' : 'text-dim',
          )}
        >
          <WrapText size={13} aria-hidden="true" />
        </button>
        <CopyAction text={code} label="Copy code" showText />
      </figcaption>
      <pre
        className={cx(
          'scroll-quiet overflow-x-auto px-3.5 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink',
          wrap && 'break-words whitespace-pre-wrap',
        )}
      >
        <code>{code}</code>
      </pre>
    </figure>
  );
}
