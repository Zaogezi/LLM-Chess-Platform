import { useCallback, useEffect, useRef, useState } from 'react';
import type { TournamentStartRequest, TournamentState } from '../../shared/protocol';
import {
  fetchTournamentState,
  postTournamentStart,
  postTournamentStop,
} from '../api';

export type TournamentAction = 'start' | 'stop';

export type TournamentConnectionStatus = 'connecting' | 'open' | 'reconnecting';

export interface TournamentController {
  state: TournamentState | null;
  connection: TournamentConnectionStatus;
  loadError: string | null;
  pending: TournamentAction | null;
  actionError: string | null;
  reload: () => Promise<void>;
  dismissActionError: () => void;
  start: (request: TournamentStartRequest) => Promise<boolean>;
  stop: () => Promise<boolean>;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '评测服务暂时无法响应，请稍后重试。';
}

function isTournamentState(value: TournamentState | null | undefined): boolean {
  return Boolean(
    value &&
      typeof value.revision === 'number' &&
      typeof value.phase === 'string' &&
      Array.isArray(value.models) &&
      Array.isArray(value.games) &&
      Array.isArray(value.standings),
  );
}

/**
 * Tournament state store: initial GET, `/api/tournament/events` SSE stream and
 * guarded start/stop actions. Independent from the arena page: it never touches
 * `/api/events` and keeps its own revision guard.
 */
export function useTournament(): TournamentController {
  const [state, setState] = useState<TournamentState | null>(null);
  const [connection, setConnection] = useState<TournamentConnectionStatus>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<TournamentAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const revisionRef = useRef(-1);
  const pendingRef = useRef<TournamentAction | null>(null);

  const applyState = useCallback((next: TournamentState | null | undefined) => {
    if (!isTournamentState(next) || !next || next.revision < revisionRef.current) {
      return;
    }

    revisionRef.current = next.revision;
    setState(next);
    setLoadError(null);
  }, []);

  const loadState = useCallback(async () => {
    setLoadError(null);
    try {
      applyState(await fetchTournamentState());
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
      const nextSource = new EventSource('/api/tournament/events');
      source = nextSource;

      const handleStateFrame = (event: Event) => {
        const message = event as MessageEvent<string>;
        if (typeof message.data !== 'string' || message.data.length === 0) {
          return;
        }
        try {
          const next: unknown = JSON.parse(message.data);
          applyState(next as TournamentState);
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
      name: TournamentAction,
      request: () => Promise<TournamentState>,
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
    (request: TournamentStartRequest) =>
      runAction('start', () => postTournamentStart(request)),
    [runAction],
  );

  const stop = useCallback(
    () => runAction('stop', () => postTournamentStop()),
    [runAction],
  );

  const dismissActionError = useCallback(() => setActionError(null), []);

  return {
    state,
    connection,
    loadError,
    pending,
    actionError,
    reload: loadState,
    dismissActionError,
    start,
    stop,
  };
}
