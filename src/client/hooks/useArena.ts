import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArenaState, StartGameRequest } from '../../shared/protocol';
import { fetchArenaState, postArenaAction } from '../api';

export type ActionName = 'start' | 'pause' | 'resume' | 'retry' | 'reset';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting';

export interface ArenaController {
  state: ArenaState | null;
  connection: ConnectionStatus;
  loadError: string | null;
  pending: ActionName | null;
  actionError: string | null;
  reload: () => Promise<void>;
  dismissActionError: () => void;
  start: (request: StartGameRequest) => Promise<boolean>;
  pause: () => Promise<boolean>;
  resume: () => Promise<boolean>;
  retry: () => Promise<boolean>;
  reset: () => Promise<boolean>;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '棋局服务暂时无法响应，请稍后重试。';
}

/**
 * Owns the single shared arena: initial GET, live SSE stream, and guarded POST
 * actions. Snapshots are ref-guarded by revision so a slow response can never
 * overwrite a newer SSE frame.
 */
export function useArena(): ArenaController {
  const [state, setState] = useState<ArenaState | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<ActionName | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const revisionRef = useRef(-1);
  const pendingRef = useRef<ActionName | null>(null);

  const applyState = useCallback((next: ArenaState | null | undefined) => {
    if (
      !next ||
      typeof next.revision !== 'number' ||
      !Array.isArray(next.board) ||
      next.revision < revisionRef.current
    ) {
      return;
    }

    revisionRef.current = next.revision;
    setState(next);
    setLoadError(null);
  }, []);

  const loadState = useCallback(async () => {
    setLoadError(null);
    try {
      applyState(await fetchArenaState());
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
      const nextSource = new EventSource('/api/events');
      source = nextSource;

      const handleStateFrame = (event: Event) => {
        const message = event as MessageEvent<string>;
        if (typeof message.data !== 'string' || message.data.length === 0) {
          return;
        }
        try {
          const next: unknown = JSON.parse(message.data);
          applyState(next as ArenaState);
        } catch {
          // A malformed or non-state frame is ignored; the next full snapshot wins.
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
        // Resynchronise after any reconnect in case a snapshot was missed.
        void loadState();
      };

      const handleError = () => {
        if (disposed) {
          return;
        }
        opened = false;
        setConnection('reconnecting');
        // Stop the browser's own retry loop: some network stacks leave the
        // EventSource permanently closed after a failed attempt. We rebuild it
        // ourselves, and resync state with a plain GET in the meantime.
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
    async (name: ActionName, request: () => Promise<ArenaState>): Promise<boolean> => {
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
    (request: StartGameRequest) =>
      runAction('start', () => postArenaAction('/api/game/start', request)),
    [runAction],
  );

  const pause = useCallback(
    () => runAction('pause', () => postArenaAction('/api/game/pause')),
    [runAction],
  );

  const resume = useCallback(
    () => runAction('resume', () => postArenaAction('/api/game/resume')),
    [runAction],
  );

  const retry = useCallback(
    () => runAction('retry', () => postArenaAction('/api/game/retry')),
    [runAction],
  );

  const reset = useCallback(
    () => runAction('reset', () => postArenaAction('/api/game/reset')),
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
    pause,
    resume,
    retry,
    reset,
  };
}
