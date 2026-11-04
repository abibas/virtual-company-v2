import { type ReactNode, useId } from 'react';

interface PanelProps {
  readonly title: string;
  readonly description?: ReactNode;
  /** Controls on the right of the title (a toggle, a button). */
  readonly actions?: ReactNode;
  /** `danger` frames an irreversible action. */
  readonly tone?: 'default' | 'danger';
  readonly children: ReactNode;
}

/** A titled section of a page. */
export function Panel({ title, description, actions, tone = 'default', children }: PanelProps) {
  const id = useId();
  const frame = tone === 'danger' ? 'border-alarm/45' : 'border-line';
  return (
    <section aria-labelledby={id} className={`rounded-md border bg-panel-solid ${frame}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 md:px-5">
        <div className="min-w-0 max-w-prose">
          <h2
            id={id}
            className={`text-[15px] font-semibold ${tone === 'danger' ? 'text-alarm' : 'text-ink'}`}
          >
            {title}
          </h2>
          {description && <p className="mt-1 text-[13.5px] text-dim">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      <div className="px-4 pt-3 pb-4 md:px-5 md:pb-5">{children}</div>
    </section>
  );
}
