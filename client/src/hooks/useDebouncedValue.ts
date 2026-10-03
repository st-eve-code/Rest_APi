import { useEffect, useState } from 'react';

/**
 * Returns `value` only after it has stopped changing for `delayMs`.
 *
 * Used for the search box: without it, every keystroke fires a request and the
 * list flickers. This is a UI concern, so it lives here rather than in the API
 * layer — the server has no idea a debounce exists.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    // Even the first render gets delayed, which is what we want: it collapses
    // the initial empty search box and the default value into one request.
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}