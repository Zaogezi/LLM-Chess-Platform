import { useCallback, useEffect, useRef, useState } from 'react';
import type { QualifierStartRequest, QualifierState } from '../../shared/protocol';
import {
  fetchQualifierState,
  postQualifierResume,
  postQualifierStart,
  postQualifierStop,
} from '../api';

export type QualifierAction = 'start' | 'stop' | 'resume';

export type QualifierConnectionStatus = 'connecting' | 'open' | 'reconnecting';

export interface QualifierController {
  state: QualifierState | null;
  connection: QualifierConnectionStatus;
  loadError: string | null;
  pending: QualifierAction | null;
  actionError: string | null;
  reload: () => Promise<void>;
  dismissActionError: () => void;
  start: (request: QualifierStartRequest) => Promise<boolean>;
  stop: () => Promise<boolean>;
  resume: () => Promise<boolean>;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '入围赛服务暂时无法响应，请稍后重试。';
}

function isQualifierState(value: QualifierState | null | undefined): boolean {
  return Boolean(
    value &&
      typeof value.revision === 'number' &&
      typeof value.phase === 'string' &&
      Array.isArray(value.entrants) &&
      Array.isArray(value.groups) &&
      Array.isArray(value.games),
  );
}

/**
 * Qualifying-round state store: initial GET, SSE stream and guarded
 * start/stop/resume actions. Mirrors `useChampionship`; the qualifying round
 * runs independently from the main championship.
 */
export function useQualifier(): QualifierController {
  const [state, setState] = useState<QualifierState | null>(null);
  const [connection, setConnection] = useState<QualifierConnectionStatus>('connecting');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<QualifierAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const revisionRef = useRef(-1);
  const pendingRef = useRef<QualifierAction | null>(null);

  const applyState = useCallback((next: QualifierState | null | undefined) => {
    if (!isQualifierState(next) || !next || next.revision < revisionRef.current) {
      return;
    }

    revisionRef.current = next.revision;
    setState(next);
    setLoadError(null);
  }, []);

  const loadState = useCallback(async () => {
    setLoadError(null);
    try {
      applyState(await fetchQualifierState());
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
      const nextSource = new EventSource('/api/championship/qualifier/events');
      source = nextSource;

      const handleStateFrame = (event: Event) => {
        const message = event as MessageEvent<string>;
        if (typeof message.data !== 'string' || message.data.length === 0) {
          return;
        }
        try {
          const next: unknown = JSON.parse(message.data);
          applyState(next as QualifierState);
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
        // A restarted server starts a new revision sequence; drop the old
        // high-water mark so the restored state is accepted.
        revisionRef.current = -1;
        void loadState();
      };

      const handleError = () => {
        if (disposed) {
          return;
        }
        opened = false;
        setConnection('reconnecting');
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
      name: QualifierAction,
      request: () => Promise<QualifierState>,
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
    (request: QualifierStartRequest) =>
      runAction('start', () => postQualifierStart(request)),
    [runAction],
  );

  const stop = useCallback(
    () => runAction('stop', () => postQualifierStop()),
    [runAction],
  );

  const resume = useCallback(
    () => runAction('resume', () => postQualifierResume()),
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
