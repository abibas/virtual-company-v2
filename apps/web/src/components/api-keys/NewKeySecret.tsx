import { useEffect, useRef } from 'react';
import type { CreatedApiKey } from '../../api/types.ts';
import { Button } from '../ui/Button.tsx';
import { CopyButton } from '../ui/CopyButton.tsx';

/**
 * The new key, shown this once: the server keeps only its hash and first characters. It lives in the page's memory
 * only (never in storage) and is gone when the person closes this or leaves the page.
 */
export function NewKeySecret({
  apiKey,
  onDone,
}: {
  readonly apiKey: CreatedApiKey;
  readonly onDone: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  return (
    <section
      aria-labelledby="new-key-title"
      className="rounded-md border border-dashed border-amber bg-amber-soft p-4 md:p-5"
    >
      <h2 id="new-key-title" className="text-[15px] font-semibold text-ink">
        Your new key “{apiKey.name}”
      </h2>
      <p className="mt-1 text-[13.5px] text-ink-2">
        Copy it now. You won’t see this key again: the server keeps only its first characters.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <label htmlFor="new-key-secret" className="sr-only">
          The new API key
        </label>
        <input
          ref={field}
          id="new-key-secret"
          readOnly
          value={apiKey.secret}
          spellCheck={false}
          autoComplete="off"
          onFocus={(event) => event.currentTarget.select()}
          className="w-full min-w-0 rounded-sm border border-line-2 bg-ground px-3 py-2 font-mono text-[13px] text-ink"
        />
        <CopyButton text={apiKey.secret} label="Copy key" />
      </div>
      <div className="mt-4">
        <Button onClick={onDone}>I have copied it</Button>
      </div>
    </section>
  );
}
