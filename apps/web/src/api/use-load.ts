import { useCallback, useEffect, useRef, useState } from 'react';

export interface Loaded<T> {
  /** The last answer for this key; kept while it reloads, so lists do not flash. */
  readonly data: T | undefined;
  /** The last failure, cleared by the next success. */
  readonly error: unknown;
  readonly loading: boolean;
  /** Loads again (after a change the page made). */
  reload(): void;
}

interface State<T> {
  readonly key: string;
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
}

/**
 * Loads `load()` for `key` (an id the answer depends on, such as a company id and a filter), again whenever the key
 * changes or `reload()` is called. An answer for an older key or call is dropped.
 */
export function useLoad<T>(key: string, load: () => Promise<T>): Loaded<T> {
  const loader = useRef(load);
  loader.current = load;
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<State<T>>({ key, data: undefined, error: undefined, loading: true });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the key and the tick are what restart the load.
  useEffect(() => {
    let current = true;
    setState((s) => ({ key, data: s.key === key ? s.data : undefined, error: undefined, loading: true }));
    loader.current().then(
      (data) => {
        if (current) setState({ key, data, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (current) setState((s) => ({ ...s, error, loading: false }));
      },
    );
    return () => {
      current = false;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  const fresh = state.key === key;
  return {
    data: fresh ? state.data : undefined,
    error: fresh ? state.error : undefined,
    loading: !fresh || state.loading,
    reload,
  };
}
