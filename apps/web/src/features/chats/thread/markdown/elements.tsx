import { isValidElement, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { CodeBlock } from './CodeBlock.tsx';
import { INLINE_CODE } from './reading.ts';

/**
 * How each Markdown element looks in the thread (S5.2), on the reading scale (`reading.ts`): semibold lead-ins and
 * headings, lists indented with quiet markers, tables with light rules that scroll sideways, task lists, quiet quotes,
 * inline code chips, links that open in a new tab, and fenced code as a `CodeBlock`. `node` is react-markdown's own
 * prop, never passed on to the page.
 */

/** The text of a code element's children (react-markdown gives the code as one string). */
function textOf(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(textOf).join('');
  return '';
}

export const ELEMENTS: Components = {
  p: ({ node: _node, ...props }) => <p className="break-words" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-ink" {...props} />,
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-blue underline decoration-blue/30 underline-offset-2 hover:decoration-blue"
    />
  ),
  h1: ({ node: _node, ...props }) => (
    <h3 className="mt-3 text-xl leading-snug font-semibold tracking-[-0.015em] text-ink" {...props} />
  ),
  h2: ({ node: _node, ...props }) => (
    <h4 className="mt-3 text-lg leading-snug font-semibold tracking-[-0.01em] text-ink" {...props} />
  ),
  h3: ({ node: _node, ...props }) => <h5 className="mt-2 text-[1rem] font-semibold text-ink" {...props} />,
  h4: ({ node: _node, ...props }) => (
    <h6 className="mt-1 text-[0.9375rem] font-semibold text-ink" {...props} />
  ),
  h5: ({ node: _node, ...props }) => <h6 className="text-[0.9375rem] font-semibold text-ink-2" {...props} />,
  h6: ({ node: _node, ...props }) => <h6 className="text-sm font-semibold text-dim" {...props} />,
  ul: ({ node: _node, className, ...props }) => (
    <ul
      className={
        className?.includes('contains-task-list')
          ? 'grid gap-1.5 pl-0.5'
          : 'grid list-disc gap-1.5 pl-6 marker:text-faint [&_ol]:mt-1.5 [&_ul]:mt-1.5'
      }
      {...props}
    />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol
      className="grid list-decimal gap-1.5 pl-6 marker:font-medium marker:text-dim [&_ol]:mt-1.5 [&_ul]:mt-1.5"
      {...props}
    />
  ),
  li: ({ node: _node, className, ...props }) => (
    <li
      className={
        className?.includes('task-list-item') ? 'flex items-start gap-2 [&>p]:inline' : 'pl-1 [&>p+p]:mt-1.5'
      }
      {...props}
    />
  ),
  input: ({ node: _node, ...props }) => (
    <input {...props} disabled className="mt-1.5 size-3.5 shrink-0 accent-[var(--blue)]" />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="grid gap-2 border-l-[3px] border-line-2 pl-3.5 text-ink-2" {...props} />
  ),
  hr: () => <hr className="my-2 border-line" />,
  table: ({ node: _node, ...props }) => (
    <div className="scroll-quiet max-w-full overflow-x-auto">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="text-ink" {...props} />,
  th: ({ node: _node, ...props }) => (
    <th
      className="border-b border-line-2 px-3 py-2 text-left font-semibold whitespace-nowrap first:pl-0"
      {...props}
    />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border-b border-line px-3 py-2 align-top text-ink-2 first:pl-0" {...props} />
  ),
  code: ({ node: _node, className: _className, ...props }) => <code className={INLINE_CODE} {...props} />,
  pre: ({ children }) => {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children)
      ? children.props
      : undefined;
    const lang = /language-([\w+#.-]+)/.exec(code?.className ?? '')?.[1];
    return <CodeBlock lang={lang} code={textOf(code?.children).replace(/\n$/, '')} />;
  },
};
