import type {
  ChampionshipPhase,
  ChampionshipState,
  QualifierState,
} from '../../../shared/protocol';
import type { ChampionshipAction } from '../../hooks/useChampionship';
import {
  championshipProgress,
  describeCurrentGame,
} from '../../lib/championship';
import {
  QUALIFIER_PHASE_LABELS,
  qualifierCurrentGames,
  qualifierProgress,
} from '../../lib/qualifier';
import { Spinner } from '../Icons';

interface ChampionshipHeroProps {
  phase: ChampionshipPhase;
  state: ChampionshipState | null;
  qualifierState: QualifierState | null;
  concurrency: number;
  pending: ChampionshipAction | null;
  loadError: string | null;
  actionError: string | null;
  canStart: boolean;
  startBlockedReason: string | null;
  startVisible: boolean;
  stopVisible: boolean;
  resumeVisible: boolean;
  reconfiguring: boolean;
  reconfigureVisible: boolean;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
  onReconfigure: () => void;
  onDismissError: () => void;
  onRetryLoad: () => void;
}

export function ChampionshipHero({
  phase,
  state,
  qualifierState,
  concurrency,
  pending,
  loadError,
  actionError,
  canStart,
  startBlockedReason,
  startVisible,
  stopVisible,
  resumeVisible,
  reconfiguring,
  reconfigureVisible,
  onStart,
  onStop,
  onResume,
  onReconfigure,
  onDismissError,
  onRetryLoad,
}: ChampionshipHeroProps) {
  const running = phase === 'running';
  const busy = pending !== null;
  const qualifierActive =
    phase === 'idle' &&
    qualifierState !== null &&
    qualifierState.phase !== 'idle';
  const qualifier = qualifierProgress(qualifierActive ? qualifierState : null);
  const championship = championshipProgress(state);
  const progress = qualifierActive
    ? {
        percent:
          qualifierState?.phase === 'finished'
            ? 100
            : Math.min(99, qualifier.percent),
        processedGames: qualifier.processedGames,
        groupGamesProcessed: qualifier.groupGamesProcessed,
        groupGamesTotal: qualifier.totalGames,
        seriesProcessed: 0,
        seriesTotal: 0,
      }
    : championship;
  const qualifierCurrent = qualifierActive ? qualifierCurrentGames(qualifierState) : [];
  const currentGameLabel = qualifierActive
    ? qualifierCurrent[0]?.label ?? null
    : describeCurrentGame(state);
  const currentWatchHref = qualifierActive
    ? qualifierCurrent[0]
      ? `/watch?mode=qualifier&gameId=${encodeURIComponent(
          qualifierCurrent[0].game.id,
        )}`
      : null
    : state?.currentGameId
      ? '/watch?mode=championship'
      : null;

  let startLabel = '开始锦标赛';
  if (pending === 'start') {
    startLabel = '启动中…';
  } else if (phase !== 'idle') {
    startLabel = '开始新一届';
  }

  return (
    <section className="panel tourney-hero tourney-hero--compact champ-hero" aria-label="锦标赛进度">
      <div className="tourney-progress">
        <div className="tourney-progress__head">
          <span>{qualifierActive ? '入围赛进度' : '进度'}</span>
          <strong>{progress.percent}%</strong>
        </div>
        <div
          className="tourney-progress__track"
          role="progressbar"
          aria-label={qualifierActive ? '入围赛进度' : '锦标赛进度'}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <span className="tourney-progress__fill" style={{ width: `${progress.percent}%` }} />
        </div>
        <dl className="tourney-progress__stats">
          <div>
            <dt>已处理</dt>
            <dd>
              {progress.processedGames}
              <span> 局</span>
            </dd>
          </div>
          <div>
            <dt>{qualifierActive ? '入围' : '小组'}</dt>
            <dd>
              {progress.groupGamesProcessed}
              <span> / {progress.groupGamesTotal}</span>
            </dd>
          </div>
          {!qualifierActive && (
            <div>
              <dt>系列</dt>
              <dd>
                {progress.seriesProcessed}
                <span> / {progress.seriesTotal}</span>
              </dd>
            </div>
          )}
          <div>
            <dt>并发</dt>
            <dd>{qualifierActive ? qualifierState?.concurrency ?? concurrency : concurrency}</dd>
          </div>
        </dl>
        {qualifierActive && qualifierState && (
          <p className="champ-hero__qualifier">
            {QUALIFIER_PHASE_LABELS[qualifierState.phase]}
            {qualifierState.phase === 'finished' ? ' · 可抽签' : ''}
          </p>
        )}
        {running && currentGameLabel && (
          <div className="tourney-current-row">
            <p className="tourney-current">{currentGameLabel}</p>
            {currentWatchHref && (
              <a className="watch-link watch-link--hero" href={currentWatchHref}>
                查看棋盘
              </a>
            )}
          </div>
        )}
      </div>

      <div className="tourney-actions">
        {startVisible && (
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={onStart}
            disabled={busy || !canStart}
            aria-busy={pending === 'start'}
            title="整届最多约 66 局真实模型调用，可随时停止"
          >
            {pending === 'start' && <Spinner />}
            {startLabel}
          </button>
        )}
        {resumeVisible && (
          <button
            type="button"
            className="btn btn--primary btn--lg"
            onClick={onResume}
            disabled={busy}
            aria-busy={pending === 'resume'}
          >
            {pending === 'resume' && <Spinner />}
            {pending === 'resume' ? '恢复中…' : '继续'}
          </button>
        )}
        {stopVisible && (
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
        {reconfigureVisible && (
          <button
            type="button"
            className="btn btn--secondary btn--lg"
            onClick={onReconfigure}
            disabled={busy}
            aria-pressed={reconfiguring}
          >
            {reconfiguring ? '收起' : '重新配置'}
          </button>
        )}
      </div>

      {startVisible && !canStart && !busy && (
        <p className="champ-hero__blocked">
          {startBlockedReason ?? '请先抽签'}
        </p>
      )}

      {resumeVisible && <p className="champ-hero__resume">断点已保存</p>}

      {state === null && (
        <p className="tourney-hint">
          {loadError ? '锦标赛服务未就绪' : '连接中…'}
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

      {phase === 'finished' && state?.championName && (
        <p className="champ-hero__decision">冠军 · {state.championName}</p>
      )}
    </section>
  );
}
