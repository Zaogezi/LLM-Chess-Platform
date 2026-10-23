import { useEffect, useState } from 'react';

/**
 * Returns a timestamp that refreshes on an interval while `active` is true.
 * Used for the live thinking-clock without ticking React elsewhere.
 */
export function useNow(intervalMs: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) {
      return;
    }

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);

    return () => window.clearInterval(timer);
  }, [active, intervalMs]);

  return now;
}
