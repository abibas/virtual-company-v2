import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '../../../../components/cx.ts';
import { ELEMENTS } from './elements.tsx';
import { READING } from './reading.ts';

/**
 * GitHub-flavoured Markdown (S5.2), loaded on its own by `Markdown.tsx`. Raw HTML in the text shows as text, never as
 * markup, and unsafe link addresses (`javascript:`) are dropped by react-markdown's default URL check.
 */
export default function MarkdownBody({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}) {
  return (
    <div className={cx(READING, className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={ELEMENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
