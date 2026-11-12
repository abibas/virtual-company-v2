import { useCallback, useState } from 'react';
import { refusalText } from './chat-text.ts';

export interface Action {
  readonly busy: boolean;
  /** The last refusal in plain words, cleared by the next try. */
  readonly error: string | undefined;
  /** The last refusal itself (its code and fields), cleared by the next try. */
  readonly failure: unknown;
  /** Runs `action`, busy meanwhile; resolves true when it succeeded. Never throws. */
  run(action: () => Promise<unknown>): Promise<boolean>;
}

/** One chat action at a time (send, stop, a new chat, a profile change), with its refusal in plain words. */
export function useAction(): Action {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [failure, setFailure] = useState<unknown>();
  const run = useCallback(async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(undefined);
    setFailure(undefined);
    try {
      await action();
      return true;
    } catch (refused) {
      setError(refusalText(refused));
      setFailure(refused);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, failure, run };
}
