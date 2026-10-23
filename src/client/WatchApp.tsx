import { useEffect, useMemo, useState } from 'react';
import type {
  ArenaState,
  ChampionshipGameView,
  TournamentGameView,
} from '../shared/protocol';
import type { TournamentConnectionStatus } from './hooks/useTournament';
import {
  fetchChampionshipGame,
  fetchQualifierGame,
  fetchTournamentGame,
} from './api';
import { useChampionship } from './hooks/useChampionship';
import { useGameSnapshot } from './hooks/useGameSnapshot';
import { useQualifier } from './hooks/useQualifier';
import { useTournament } from './hooks/useTournament';
import { Board, BoardLines } from './components/Board';
import { FixedNav } from './components/FixedNav';
import { MoveSheet } from './components/MoveSheet';
import { PlayerPlaque } from './components/PlayerPlaque';
import { StatusStrip } from './components/StatusStrip';
import { BrandMark, ConnectionBadge } from './components/TopBar';
import {
  CHAMPIONSHIP_STAGE_LABELS,
  championshipGroupLabel,
} from './lib/championship';
import {
  TOURNAMENT_GAME_STATUS_LABELS,
  describeFailedSide,
  describeTournamentGameResult,
  gameStatusTone,
} from './lib/tournament';
import type { ChampionshipState, QualifierState, TournamentState } from '../shared/protocol';

type WatchMode = 'tournament' | 'championship' | 'qualifier';

interface WatchQuery {
  mode: WatchMode;
  gameId: string | null;
}

function readQuery(): WatchQuery {
  const params = new URLSearchParams(window.location.search);
  const rawMode = params.get('mode');
  const mode: WatchMode =
    rawMode === 'championship'
      ? 'championship'
      : rawMode === 'qualifier'
        ? 'qualifier'
        : 'tournament';
  const rawId = params.get('gameId') ?? params.get('game');
  const gameId = rawId && rawId.trim().length > 0 ? rawId.trim() : null;
  return { mode, gameId };
}

function gameKicker(
  mode: WatchMode,
  game: TournamentGameView | ChampionshipGameView,
): string {
  if (mode === 'tournament') {
    return `自动评测 · 第 ${game.pairIndex} 组 第 ${game.gameIndex} 局`;
  }
  const championship = game as ChampionshipGameView;
  if (mode === 'qualifier' || championship.stage === 'qualifier') {
    return `${championshipGroupLabel(championship.groupId)}入围赛 · 第 ${championship.pairIndex} 对`;
  }
  if (championship.stage === 'group') {
    return `${championshipGroupLabel(championship.groupId)}小组赛 · 第 ${championship.pairIndex} 对 第 ${championship.gameIndex} 局`;
  }
  return `${CHAMPIONSHIP_STAGE_LABELS[championship.stage]} · 第 ${championship.gameIndex} 局`;
}

function phaseForGame(game: TournamentGameView | null, arena: ArenaState | null) {
  if (arena) return arena.phase;
  if (!game) return 'idle' as const;
  if (game.status === 'running') return 'running' as const;
  if (game.status === 'finished') return 'finished' as const;
  return 'idle' as const;
}

function WatchPlaceholder({
  game,
  loading,
  error,
}: {
  game: TournamentGameView | null;
  loading: boolean;
  error: string | null;
}) {
  let title = '等待对局';
  if (loading) {
    title = '读取棋局…';
  } else if (error) {
    title = '棋局读取失败';
  } else if (game?.status === 'finished') {
    title = '对局已结束';
  } else if (game?.status === 'failed' || game?.status === 'canceled') {
    title = '对局未完成';
  }

  return (
    <div className="board-frame">
      <div
        className={`board-stage board-stage--placeholder${loading ? ' is-loading' : ''}`}
        role="status"
        aria-live="polite"
      >
        <BoardLines />
        <div className="board-placeholder">
          <span className="board-placeholder__seal" aria-hidden="true">
            弈
          </span>
          <p className="board-placeholder__title">{title}</p>
          {error && <p className="board-placeholder__hint">{error}</p>}
        </div>
      </div>
    </div>
  );
}

interface WatchViewProps {
  mode: WatchMode;
  game: TournamentGameView | ChampionshipGameView | null;
  arena: ArenaState | null;
  live: boolean;
  loading: boolean;
  error: string | null;
  connection: TournamentConnectionStatus;
  onRetry: () => void;
}

function WatchView({
  mode,
  game,
  arena,
  live,
  loading,
  error,
  connection,
  onRetry,
}: WatchViewProps) {
  const phase = phaseForGame(game, arena);
  const backHref = mode === 'tournament' ? '/tournament' : '/championship';
  const backLabel = mode === 'tournament' ? '自动评测' : '锦标赛';  const statusLabel = game
    ? TOURNAMENT_GAME_STATUS_LABELS[game.status]
    : loading
      ? '读取中'
      : '等待对局';
  const tone = game ? gameStatusTone(game.status) : 'idle';
  const failedSide = game ? describeFailedSide(game) : null;
  const resultText = game && game.status === 'finished' ? describeTournamentGameResult(game) : null;

  return (
    <div className="app watch-app">
      <FixedNav current="arena" />

      <header className="topbar watch-topbar">
        <div className="topbar__main">
          <BrandMark />
          <h2 className="tournament-brand__title">棋盘观战</h2>
        </div>
        <div className="topbar__status">
          <span className={`status-chip status-chip--${tone}`}>
            <span className="status-chip__dot" aria-hidden="true" />
            {statusLabel}
          </span>
          <ConnectionBadge connection={connection} />
        </div>
      </header>

      <main className="tournament-main watch-main">
        <header className="watch-head">
          <a className="watch-back" href={backHref}>
            ← 返回{backLabel}
          </a>
          {game && (
            <>
              <p className="watch-kicker">{gameKicker(mode, game)}</p>
              <h1 className="watch-title">
                <span className="watch-title__side watch-title__side--red">{game.redName}</span>
                <span className="watch-title__vs">对</span>
                <span className="watch-title__side watch-title__side--black">{game.blackName}</span>
                {live && (
                  <span className="watch-title__live">
                    <span className="tourney-live-dot" aria-hidden="true" />
                    直播中
                  </span>
                )}
              </h1>
              <p className="watch-meta">
                <span>{game.plies} 手</span>
                {game.durationMs > 0 && <span>{Math.round(game.durationMs / 1000)} 秒</span>}
                {failedSide && <span className="watch-meta__bad">{failedSide}</span>}
              </p>
            </>
          )}
        </header>

        {!game ? (
          <section className="panel watch-empty">
            <p className="watch-empty__title">
              {loading ? '正在连接赛事…' : error ? '赛事画面读取失败' : '当前没有可观看的对局'}
            </p>
            {error && <p className="watch-empty__hint">{error}</p>}
            <div className="watch-empty__actions">
              <button type="button" className="btn btn--secondary btn--compact" onClick={onRetry}>
                重试
              </button>
              <a className="btn btn--secondary btn--compact" href={backHref}>
                返回{backLabel}
              </a>
            </div>
          </section>
        ) : (
          <div className="watch-grid">
            <section className="watch-board-column" aria-label="实时棋局">
              <PlayerPlaque
                side="black"
                phase={phase}
                model={arena?.models.black ?? null}
                fallbackName={game.blackName}
                nameOverride={game.blackName}
                isTurn={Boolean(arena && arena.phase === 'running' && arena.turn === 'black')}
                isWinner={game.result?.winner === 'black'}
                board={arena?.board ?? null}
              />

              {arena ? <Board state={arena} /> : <WatchPlaceholder game={game} loading={loading} error={error} />}

              <PlayerPlaque
                side="red"
                phase={phase}
                model={arena?.models.red ?? null}
                fallbackName={game.redName}
                nameOverride={game.redName}
                isTurn={Boolean(arena && arena.phase === 'running' && arena.turn === 'red')}
                isWinner={game.result?.winner === 'red'}
                board={arena?.board ?? null}
              />
            </section>

            <aside className="watch-side" aria-label="棋谱与状态">
              {arena && <StatusStrip state={arena} />}

              {resultText && (
                <div className={`watch-result${game.result?.winner ? ' is-decisive' : ''}`}>
                  <strong>{resultText}</strong>
                  {game.error && <span>{game.error}</span>}
                </div>
              )}

              {!arena && !resultText && (
                <div className="watch-result is-quiet">
                  <strong>{loading ? '读取棋局…' : '暂无棋盘画面'}</strong>
                  {!loading && (
                    <span>
                      {game.status === 'scheduled'
                        ? '该局尚未开始，开始后这里会自动刷新。'
                        : '棋局画面仅在当前对局或最近一局结束后保留。'}
                    </span>
                  )}
                </div>
              )}

              <MoveSheet state={arena} />

              {error && (
                <div className="watch-alert" role="alert">
                  <span>{error}</span>
                  <button type="button" className="watch-alert__action" onClick={onRetry}>
                    重试
                  </button>
                </div>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}

function TournamentWatch({ gameId }: { gameId: string | null }) {
  const controller = useTournament();
  const state: TournamentState | null = controller.state;
  const targetId = gameId ?? state?.currentGameId ?? null;
  const [retryTick, setRetryTick] = useState(0);
  const snapshot = useGameSnapshot(
    targetId,
    fetchTournamentGame,
    (state?.revision ?? 0) + retryTick,
  );

  const fallbackGame = useMemo(
    () => (targetId ? (state?.games.find((game) => game.id === targetId) ?? null) : null),
    [state, targetId],
  );

  return (
    <WatchView
      mode="tournament"
      game={snapshot.snapshot?.game ?? fallbackGame}
      arena={snapshot.snapshot?.arena ?? null}
      live={snapshot.snapshot?.live ?? false}
      loading={snapshot.loading || (controller.state === null && !controller.loadError)}
      error={snapshot.error ?? controller.loadError}
      connection={controller.connection}
      onRetry={() => {
        setRetryTick((tick) => tick + 1);
        void controller.reload();
      }}
    />
  );
}

function ChampionshipWatch({ gameId }: { gameId: string | null }) {
  const controller = useChampionship();
  const state: ChampionshipState | null = controller.state;
  const targetId = gameId ?? state?.currentGameId ?? null;
  const [retryTick, setRetryTick] = useState(0);
  const snapshot = useGameSnapshot(
    targetId,
    fetchChampionshipGame,
    (state?.revision ?? 0) + retryTick,
  );

  const fallbackGame = useMemo(
    () => (targetId ? (state?.games.find((game) => game.id === targetId) ?? null) : null),
    [state, targetId],
  );

  return (
    <WatchView
      mode="championship"
      game={snapshot.snapshot?.game ?? fallbackGame}
      arena={snapshot.snapshot?.arena ?? null}
      live={snapshot.snapshot?.live ?? false}
      loading={snapshot.loading || (controller.state === null && !controller.loadError)}
      error={snapshot.error ?? controller.loadError}
      connection={controller.connection}
      onRetry={() => {
        setRetryTick((tick) => tick + 1);
        void controller.reload();
      }}
    />
  );
}

function QualifierWatch({ gameId }: { gameId: string | null }) {
  const controller = useQualifier();
  const state: QualifierState | null = controller.state;
  const targetId = gameId ?? state?.currentGameIds[0] ?? null;
  const [retryTick, setRetryTick] = useState(0);
  const snapshot = useGameSnapshot(
    targetId,
    fetchQualifierGame,
    (state?.revision ?? 0) + retryTick,
  );

  const fallbackGame = useMemo(
    () => (targetId ? (state?.games.find((game) => game.id === targetId) ?? null) : null),
    [state, targetId],
  );

  return (
    <WatchView
      mode="qualifier"
      game={snapshot.snapshot?.game ?? fallbackGame}
      arena={snapshot.snapshot?.arena ?? null}
      live={snapshot.snapshot?.live ?? false}
      loading={snapshot.loading || (controller.state === null && !controller.loadError)}
      error={snapshot.error ?? controller.loadError}
      connection={controller.connection}
      onRetry={() => {
        setRetryTick((tick) => tick + 1);
        void controller.reload();
      }}
    />
  );
}

export default function WatchApp() {
  const query = useMemo(readQuery, []);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '棋盘观战 · 楚河论弈';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  if (query.mode === 'championship') {
    return <ChampionshipWatch gameId={query.gameId} />;
  }
  if (query.mode === 'qualifier') {
    return <QualifierWatch gameId={query.gameId} />;
  }
  return <TournamentWatch gameId={query.gameId} />;
}
