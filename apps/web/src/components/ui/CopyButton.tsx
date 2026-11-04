import { useEffect, useState } from 'react';
import { Button } from './Button.tsx';

/** Copies `text` to the clipboard and says so for two seconds; when the browser refuses, it asks for a manual copy. */
export function CopyButton({ text, label = 'Copy' }: { readonly text: string; readonly label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <Button size="sm" onClick={() => void copy()}>
        {state === 'copied' ? 'Copied' : label}
      </Button>
      <span role="status" className="text-[12.5px] text-dim">
        {state === 'failed' ? 'Select the text and copy it by hand' : ''}
      </span>
    </span>
  );
}
