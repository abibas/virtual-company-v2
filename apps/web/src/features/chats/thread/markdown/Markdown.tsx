import { lazy, Suspense } from 'react';
import { RichText } from '../RichText.tsx';

/** The Markdown renderer and its parser load on first use, in their own chunk. */
const MarkdownBody = lazy(() => import('./MarkdownBody.tsx'));

/**
 * An agent's text as Markdown (S5.2). Until the renderer has loaded, the plain renderer shows the same text (code
 * fences and inline code already as code), so nothing jumps empty.
 */
export function Markdown({ text, className }: { readonly text: string; readonly className?: string }) {
  return (
    <Suspense fallback={<RichText text={text} {...(className ? { className } : {})} />}>
      <MarkdownBody text={text} {...(className ? { className } : {})} />
    </Suspense>
  );
}
