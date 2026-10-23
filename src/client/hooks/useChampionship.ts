import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChampionshipStartRequest, ChampionshipState } from '../../shared/protocol';
import {
  fetchChampionshipState,
  postChampionshipResume,
  postChampionshipStart,
  postChampionshipStop,
} from '../api';

export type ChampionshipAction = 'start' | 'stop' | 'resume';

export type ChampionshipConnectionStatus = 'connecting' | 'open' | 'reconnecting';

export interface ChampionshipController {
  state: ChampionshipState | null;
  connection: ChampionshipConnectionStatus;
  loadError: string | null;
  pending: ChampionshipAction | null;
  actionError: string | null;
  reload: () => Promise<void>;
  dismissActionError: () => void;
  start: (request: ChampionshipStartRequest) => Promise<boolean>;
  stop: () => Promise<boolean>;
  resume: () => Promise<boolean>;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '锦标赛服务暂时无法响应，请稍后重试。';
}

function isChampionshipState(value: ChampionshipState | null | undefined): boolean {
  return Boolean(
    value &&
      typeof value.revision === 'number' &&
      typeof value.phase === 'string' &&
      Array.isArray(value.entrants) &&
      Array.isArray(value.groups) &&
      Array.isArray(value.series) &&
      Array.isArray(value.games),
  );
}

/**
 * Championship state store: initial GET, `/api/championship/events` SSE stream
 * and guarded start/stop actions. Mirrors `useTournament` and keeps its own
 * revision guard so the arena and tournament streams can never overwrite it.
 */
export function useChampionship(): ChampionshipController {
  const [state, setState] = useState<ChampionshipState | null>(null);
  const [connection, setConnection] = useState<ChampionshipConnectionStatus>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<ChampionshipAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const revisionRef = useRef(-1);
  const pendingRef = useRef<ChampionshipAction | null>(null);

  const applyState = useCallback((next: ChampionshipState | null | undefined) => {
    if (!isChampionshipState(next) || !next || next.revision < revisionRef.current) {
      return;
    }

    revisionRef.current = next.revision;
    setState(next);
    setLoadError(null);
  }, []);

  const loadState = useCallback(async () => {
    setLoadError(null);
    try {
      applyState(await fetchChampionshipState());
    } catch (error) {
      setLoadError(messageOf(error));
    }
  }, [applyState]);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  useEffect(() => {
    if (typeof EventSource === 'undefined') {
      setConnection('reconnecting');
      return;
    }

    let disposed = false;
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let retryDelay = 1000;
    let opened = false;
    let attempts = 0;

    const clearRetry = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer !== null) {
        return;
      }
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        retryDelay = Math.min(Math.round(retryDelay * 1.6), 8000);
        connect();
      }, retryDelay);
    };

    const connect = () => {
      if (disposed) {
        return;
      }

      source?.close();
      opened = false;
      attempts += 1;
      setConnection(attempts === 1 ? 'connecting' : 'reconnecting');
      const nextSource = new EventSource('/api/championship/events');
      source = nextSource;

      const handleStateFrame = (event: Event) => {
        const message = event as MessageEvent<string>;
        if (typeof message.data !== 'string' || message.data.length === 0) {
          return;
        }
        try {
          const next: unknown = JSON.parse(message.data);
          applyState(next as ChampionshipState);
        } catch {
          // Ignore malformed frames; the next full snapshot wins.
        }
      };

      const handleOpen = () => {
        if (disposed) {
          return;
        }
        opened = true;
        attempts = 1;
        retryDelay = 1000;
        setConnection('open');
        // A restarted server starts a new revision sequence (often from the
        // checkpoint's boot revision). Drop the old tab's high-water mark so
        // the resumed state is accepted instead of being treated as stale.
        revisionRef.current = -1;
        void loadState();
      };

      const handleError = () => {
        if (disposed) {
          return;
        }
        opened = false;
        setConnection('reconnecting');
        // Rebuild the EventSource ourselves after a backoff: some network
        // stacks leave a failed stream permanently closed.
        nextSource.close();
        if (source === nextSource) {
          source = null;
        }
        scheduleRetry();
        void loadState();
      };

      nextSource.addEventListener('state', handleStateFrame);
      nextSource.addEventListener('message', handleStateFrame);
      nextSource.addEventListener('open', handleOpen);
      nextSource.addEventListener('error', handleError);
    };

    const handleOnline = () => {
      if (disposed) {
        return;
      }
      if (!opened) {
        clearRetry();
        retryDelay = 1000;
        connect();
      }
      void loadState();
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !opened) {
        clearRetry();
        retryDelay = 1000;
        connect();
        void loadState();
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibility);
    connect();

    return () => {
      disposed = true;
      clearRetry();
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibility);
      source?.close();
    };
  }, [applyState, loadState]);

  const runAction = useCallback(
    async (
      name: ChampionshipAction,
      request: () => Promise<ChampionshipState>,
    ): Promise<boolean> => {
      if (pendingRef.current) {
        return false;
      }

      pendingRef.current = name;
      setPending(name);
      setActionError(null);

      try {
        applyState(await request());
        return true;
      } catch (error) {
        setActionError(messageOf(error));
        return false;
      } finally {
        pendingRef.current = null;
        setPending(null);
      }
    },
    [applyState],
  );

  const start = useCallback(
    (request: ChampionshipStartRequest) =>
      runAction('start', () => postChampionshipStart(request)),
    [runAction],
  );

  const stop = useCallback(
    () => runAction('stop', () => postChampionshipStop()),
    [runAction],
  );

  const resume = useCallback(
    () => runAction('resume', () => postChampionshipResume()),
    [runAction],
  );

  const dismissActionError = useCallback(() => setActionError(null), []);

  const reload = useCallback(async () => {
    revisionRef.current = -1;
    await loadState();
  }, [loadState]);

  return {
    state,
    connection,
    loadError,
    pending,
    actionError,
    reload,
    dismissActionError,
    start,
    stop,
    resume,
  };
}
