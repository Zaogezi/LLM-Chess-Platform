import { useEffect, useRef, useState } from 'react';

export interface GameSnapshotController<T> {
  snapshot: T | null;
  loading: boolean;
  error: string | null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '对局画面暂时无法读取，请稍后重试。';
}

/**
 * Fetch one game's board snapshot and refresh it whenever the scheduler emits a
 * new revision (every move). The request is keyed by `refreshKey`, so callers
 * pass the live state revision and stale responses can never overwrite a newer
 * one.
 */
export function useGameSnapshot<T>(
  gameId: string | null,
  fetcher: (id: string) => Promise<T>,
  refreshKey: number,
): GameSnapshotController<T> {
  const [snapshot, setSnapshot] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gameIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (gameIdRef.current !== gameId) {
      gameIdRef.current = gameId;
      setSnapshot(null);
      setError(null);
    }

    if (!gameId) {
      setSnapshot(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void fetcher(gameId)
      .then((next) => {
        if (cancelled) return;
        setSnapshot(next);
        setError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(messageOf(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetcher, gameId, refreshKey]);

  return { snapshot, loading, error };
}
