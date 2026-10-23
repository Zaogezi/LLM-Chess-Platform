import type { TournamentPhase, TournamentState } from '../../../shared/protocol';
import type { TournamentAction } from '../../hooks/useTournament';
import { findCurrentGame, type TournamentPlan } from '../../lib/tournament';
import { Spinner } from '../Icons';

interface TournamentHeroProps {
  phase: TournamentPhase;
  state: TournamentState | null;
  plan: TournamentPlan;
  pending: TournamentAction | null;
  loadError: string | null;
  actionError: string | null;
  onStart: () => void;
  onStop: () => void;
  onDismissError: () => void;
  onRetryLoad: () => void;
}

export function TournamentHero({
  phase,
  state,
  plan,
  pending,
  loadError,
  actionError,
  onStart,
  onStop,
  onDismissError,
  onRetryLoad,
}: TournamentHeroProps) {
  const running = phase === 'running';
  const totalGames = state && state.totalGames > 0 ? state.totalGames : plan.totalGames;
  const processed = state?.processedGames ?? 0;
  const completed = state?.completedGames ?? 0;
  const percent =
    totalGames > 0 ? Math.min(100, Math.max(0, Math.round((processed / totalGames) * 100))) : 0;
  const currentGame = findCurrentGame(state);
  const busy = pending !== null;
  const startDisabled = busy || running || state === null;

  let startLabel = '开始评测';
  if (pending === 'start') {
    startLabel = '启动中…';
  } else if (running) {
    startLabel = '评测中';
  } else if (phase !== 'idle') {
    startLabel = '再次评测';
  }

  return (
    <section className="panel tourney-hero tourney-hero--compact" aria-label="赛事进度">
      <div className="tourney-progress">
        <div className="tourney-progress__head">
          <span>进度</span>
          <strong>{percent}%</strong>
        </div>
        <div
          className="tourney-progress__track"
          role="progressbar"
          aria-label="赛事进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="tourney-progress__fill" style={{ width: `${percent}%` }} />
        </div>
        <dl className="tourney-progress__stats">
          <div>
            <dt>已处理</dt>
            <dd>
              {processed}
              <span> / {totalGames}</span>
            </dd>
          </div>
          <div>
            <dt>已完赛</dt>
            <dd>{completed}</dd>
          </div>
          <div>
            <dt>参赛</dt>
            <dd>{state?.models.length ?? plan.modelCount}</dd>
          </div>
        </dl>
        {running && currentGame && (
          <div className="tourney-current-row">
            <p className="tourney-current">
              {currentGame.redName} 对 {currentGame.blackName}
              <span>第 {currentGame.plies} 手</span>
            </p>
            <a className="watch-link watch-link--hero" href="/watch?mode=tournament">
              查看棋盘
            </a>
          </div>
        )}
      </div>

      <div className="tourney-actions">
        <button
          type="button"
          className="btn btn--primary btn--lg"
          onClick={onStart}
          disabled={startDisabled}
          aria-busy={pending === 'start'}
          title="每局均为真实模型调用，可随时停止"
        >
          {pending === 'start' && <Spinner />}
          {startLabel}
        </button>
        {running && (
          <button
            type="button"
            className="btn btn--danger btn--lg"
            onClick={onStop}
            disabled={busy}
            aria-busy={pending === 'stop'}
          >
            {pending === 'stop' && <Spinner />}
            {pending === 'stop' ? '停止中…' : '停止'}
          </button>
        )}
      </div>

      {state === null && (
        <p className="tourney-hint">
          {loadError ? '赛事服务未就绪' : '连接中…'}
        </p>
      )}

      {loadError && (
        <div className="tourney-alert" role="alert">
          <span>{loadError}</span>
          <button type="button" className="tourney-alert__action" onClick={onRetryLoad}>
            重连
          </button>
        </div>
      )}

      {state?.error && (
        <div className="tourney-alert tourney-alert--warning" role="status">
          <span>{state.error}</span>
        </div>
      )}

      {actionError && (
        <div className="tourney-alert" role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className="tourney-alert__dismiss"
            onClick={onDismissError}
            aria-label="关闭错误提示"
          >
            ×
          </button>
        </div>
      )}
    </section>
  );
}
