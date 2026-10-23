import type { ArenaError } from '../../shared/protocol';
import type { ActionName } from '../hooks/useArena';
import { SIDE_LABEL, SIDE_SEAL } from '../lib/chess';
import { RetryIcon, Spinner } from './Icons';

interface ErrorBannerProps {
  error: ArenaError;
  pending: ActionName | null;
  onRetry: () => void;
  onReset: () => void;
}

export function ErrorBanner({ error, pending, onRetry, onReset }: ErrorBannerProps) {
  const busy = pending !== null;

  return (
    <section className="error-banner" role="alert" aria-label="对局异常">
      <div className="error-banner__head">
        <span className={`side-seal side-seal--${error.side}`} aria-hidden="true">
          {SIDE_SEAL[error.side]}
        </span>
        <div className="error-banner__copy">
          <h2 className="error-banner__title">{SIDE_LABEL[error.side]}调用异常</h2>
          <p className="error-banner__message">{error.message}</p>
        </div>
      </div>

      <div className="error-banner__actions">
        <button
          type="button"
          className="btn btn--primary btn--compact"
          onClick={onRetry}
          disabled={busy}
          aria-busy={pending === 'retry'}
        >
          {pending === 'retry' ? <Spinner /> : <RetryIcon />}
          <span>{pending === 'retry' ? '重试中…' : '重试本回合'}</span>
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--compact"
          onClick={onReset}
          disabled={busy}
          aria-busy={pending === 'reset'}
        >
          <span>{pending === 'reset' ? '重置中…' : '重置棋局'}</span>
        </button>
      </div>
    </section>
  );
}
