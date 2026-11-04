import { KeyRound } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { CreatedApiKey } from '../../api/types.ts';
import { CopyButton } from '../forms/CopyButton.tsx';
import { Badge } from '../ui/Badge.tsx';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';

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
    <Card as="section" aria-labelledby="new-key-title" className="ring-2 ring-input/50">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="new-key-title" className="text-md font-bold tracking-[-0.01em] text-ink">
          Your new key “{apiKey.name}”
        </h2>
        <Badge tone="input" icon={KeyRound}>
          Shown once
        </Badge>
      </div>
      <p className="mt-1 text-sm text-dim">
        Copy it now. You won’t see this key again: the server keeps only its first characters.
      </p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
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
          className="h-10 w-full min-w-0 rounded-md bg-surface-2 px-3.5 font-mono text-sm text-ink ring-1 ring-line-2 ring-inset focus:ring-blue focus:outline-none"
        />
        <CopyButton text={apiKey.secret} label="Copy key" tone="primary" size="md" />
      </div>
      <div className="mt-4">
        <Button onClick={onDone}>I have copied it</Button>
      </div>
    </Card>
  );
}
