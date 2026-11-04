import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, type ButtonSize, type ButtonTone } from '../ui/Button.tsx';

/** Copies `text` to the clipboard and says so for two seconds; when the browser refuses, it asks for a manual copy. */
export function CopyButton({
  text,
  label = 'Copy',
  tone = 'secondary',
  size = 'sm',
}: {
  readonly text: string;
  readonly label?: string;
  readonly tone?: ButtonTone;
  readonly size?: ButtonSize;
}) {
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
      <Button size={size} tone={tone} icon={state === 'copied' ? Check : Copy} onClick={() => void copy()}>
        {state === 'copied' ? 'Copied' : label}
      </Button>
      <span role="status" className="text-xs text-dim">
        {state === 'failed' ? 'Select the text and copy it by hand' : ''}
      </span>
    </span>
  );
}
