import { Home } from '../pages/Home.tsx';

interface NavItem {
  readonly label: string;
  /** Short channel code shown next to the label, as in the shared UI library's rail. */
  readonly code: string;
  readonly href?: string;
}

/** Only Home exists in S0; the rest are placeholders for the stages that build them. */
const NAV: readonly NavItem[] = [
  { label: 'Home', code: 'HM', href: '/' },
  { label: 'Inbox', code: 'IN' },
  { label: 'Tasks', code: 'TK' },
  { label: 'Org', code: 'OR' },
  { label: 'Machines', code: 'MC' },
  { label: 'Settings', code: 'ST' },
];

const itemClass =
  'flex w-full items-center gap-2.5 rounded-sm border px-2.5 py-2 text-left text-[13.5px] font-medium';

function Code({ code, active }: { code: string; active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`min-w-[26px] rounded-xs border px-1 py-px text-center font-mono text-[9.5px] tracking-[0.06em] ${
        active ? 'border-amber text-amber' : 'border-line text-faint'
      }`}
    >
      {code}
    </span>
  );
}

export function App() {
  return (
    <div className="grid min-h-screen grid-cols-1 grid-rows-[auto_1fr] md:grid-cols-[var(--spacing-rail)_minmax(0,1fr)] md:grid-rows-1">
      <a
        href="#main"
        className="sr-only rounded-sm bg-panel-solid px-3 py-2 text-ink focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-10"
      >
        Skip to content
      </a>
      <header className="flex flex-col border-line px-3.5 py-6 max-md:border-b md:sticky md:top-0 md:h-screen md:border-r">
        <div className="px-2.5">
          <p className="font-display text-2xl font-[550] tracking-[0.01em] text-ink">Most Wanted Corp</p>
          <p className="mt-1 mb-6 font-mono text-[10px] uppercase tracking-label text-dim">
            v2 · humans and agents
          </p>
        </div>
        <nav aria-label="Main">
          <ul className="flex flex-col gap-0.5 max-md:flex-row max-md:flex-wrap">
            {NAV.map((item) =>
              item.href ? (
                <li key={item.label}>
                  <a
                    href={item.href}
                    aria-current="page"
                    className={`${itemClass} border-line-2 bg-panel-2 text-ink`}
                  >
                    <Code code={item.code} active />
                    {item.label}
                  </a>
                </li>
              ) : (
                <li key={item.label}>
                  <button
                    type="button"
                    disabled
                    title="Arrives in a later stage"
                    className={`${itemClass} cursor-not-allowed border-transparent bg-transparent text-faint`}
                  >
                    <Code code={item.code} active={false} />
                    {item.label}
                  </button>
                </li>
              ),
            )}
          </ul>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="min-w-0 outline-none">
        <Home />
      </main>
    </div>
  );
}
