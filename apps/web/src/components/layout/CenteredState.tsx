import type { ReactNode } from 'react';

/** A page-sized centred column for boot, loading and problem states. */
export function CenteredState({ children }: { readonly children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      {children}
    </main>
  );
}
