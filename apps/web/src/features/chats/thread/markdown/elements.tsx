import { isValidElement, type ReactNode } from 'react';
import type { Components } from 'react-markdown';
import { CodeBlock } from './CodeBlock.tsx';

/**
 * How each Markdown element looks in the thread (S5.2), on the app's type scale: compact headings, lists with their
 * markers, tables that scroll sideways, task lists, quiet quotes, inline code, links that open in a new tab, and
 * fenced code as a `CodeBlock`. `node` is react-markdown's own prop, never passed on to the page.
 */

/** The text of a code element's children (react-markdown gives the code as one string). */
function textOf(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(textOf).join('');
  return '';
}

export const ELEMENTS: Components = {
  p: ({ node: _node, ...props }) => <p className="break-words" {...props} />,
  a: ({ node: _node, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-blue underline decoration-blue/30 underline-offset-2 hover:decoration-blue"
    />
  ),
  h1: ({ node: _node, ...props }) => <h3 className="mt-2 text-lg font-bold text-ink" {...props} />,
  h2: ({ node: _node, ...props }) => <h4 className="mt-2 text-md font-bold text-ink" {...props} />,
  h3: ({ node: _node, ...props }) => <h5 className="mt-1.5 text-base font-bold text-ink" {...props} />,
  h4: ({ node: _node, ...props }) => <h6 className="mt-1 text-sm font-bold text-ink" {...props} />,
  h5: ({ node: _node, ...props }) => <h6 className="text-sm font-semibold text-ink-2" {...props} />,
  h6: ({ node: _node, ...props }) => <h6 className="text-sm font-semibold text-dim" {...props} />,
  ul: ({ node: _node, className, ...props }) => (
    <ul
      className={
        className?.includes('contains-task-list')
          ? 'grid gap-1 pl-1'
          : 'grid list-disc gap-1 pl-5 marker:text-faint'
      }
      {...props}
    />
  ),
  ol: ({ node: _node, ...props }) => (
    <ol className="grid list-decimal gap-1 pl-5 marker:text-dim" {...props} />
  ),
  li: ({ node: _node, className, ...props }) => (
    <li
      className={className?.includes('task-list-item') ? 'flex items-start gap-2 [&>p]:inline' : 'pl-0.5'}
      {...props}
    />
  ),
  input: ({ node: _node, ...props }) => (
    <input {...props} disabled className="mt-1 size-3.5 shrink-0 accent-[var(--blue)]" />
  ),
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="border-l-2 border-line-2 pl-3 text-dim" {...props} />
  ),
  hr: () => <hr className="my-1 border-line" />,
  table: ({ node: _node, ...props }) => (
    <div className="scroll-quiet max-w-full overflow-x-auto rounded-lg ring-1 ring-line ring-inset">
      <table className="w-full border-collapse text-xs" {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead className="bg-surface-2 text-ink-2" {...props} />,
  th: ({ node: _node, ...props }) => (
    <th className="border-b border-line px-2.5 py-1.5 text-left font-semibold whitespace-nowrap" {...props} />
  ),
  td: ({ node: _node, ...props }) => (
    <td className="border-t border-line px-2.5 py-1.5 align-top" {...props} />
  ),
  code: ({ node: _node, className: _className, ...props }) => (
    <code className="rounded-xs bg-surface-3 px-1 py-px font-mono text-[0.86em] text-ink" {...props} />
  ),
  pre: ({ children }) => {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children)
      ? children.props
      : undefined;
    const lang = /language-([\w+#.-]+)/.exec(code?.className ?? '')?.[1];
    return <CodeBlock lang={lang} code={textOf(code?.children).replace(/\n$/, '')} />;
  },
};
