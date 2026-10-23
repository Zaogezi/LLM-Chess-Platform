import type { TournamentGameView, TournamentState } from '../../../shared/protocol';
import { formatDuration } from '../../lib/format';
import {
  TOURNAMENT_GAME_STATUS_LABELS,
  describeFailedSide,
  describeTournamentGameResult,
  gameStatusTone,
  groupGamesByPair,
} from '../../lib/tournament';

interface TournamentGamesProps {
  state: TournamentState | null;
}

function completedCount(games: readonly TournamentGameView[]): number {
  return games.filter(
    (game) =>
      game.status === 'finished' || game.status === 'failed' || game.status === 'canceled',
  ).length;
}

function formatGameDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '—';
  }
  if (milliseconds < 1000) {
    return '< 1 秒';
  }
  return formatDuration(milliseconds);
}

function TournamentGameRow({
  game,
  watchable,
}: {
  game: TournamentGameView;
  watchable: boolean;
}) {
  const tone = gameStatusTone(game.status);
  const failedSide = describeFailedSide(game);
  const showsPlies =
    game.status === 'running' || game.status === 'finished' || game.status === 'failed';
  const showsResult = game.status === 'finished';
  const showsDuration =
    (game.status === 'finished' || game.status === 'failed') && game.durationMs > 0;
  const resultText = describeTournamentGameResult(game);

  return (
    <li className={`tourney-game tourney-game--${game.status}`}>
      <div className="tourney-game__head">
        <span className="tourney-game__index">第 {game.gameIndex} 局</span>
        <span className={`tourney-status tourney-status--${tone}`}>
          {TOURNAMENT_GAME_STATUS_LABELS[game.status]}
        </span>
      </div>

      <div className="tourney-game__match">
        <span className="tourney-game__name">
          <span className="mini-seal mini-seal--red" aria-hidden="true">
            红
          </span>
          <span title={game.redName}>{game.redName}</span>
        </span>
        <span className="tourney-game__vs" aria-hidden="true">
          对
        </span>
        <span className="tourney-game__name">
          <span className="mini-seal mini-seal--black" aria-hidden="true">
            黑
          </span>
          <span title={game.blackName}>{game.blackName}</span>
        </span>
      </div>

      <div className="tourney-game__meta">
        {showsResult && (
          <span className="tourney-game__result" title={resultText}>
            {resultText}
          </span>
        )}
        {showsPlies && <span>{game.plies} 手</span>}
        {showsDuration && <span>{formatGameDuration(game.durationMs)}</span>}
        {failedSide && <span className="tourney-game__failure">{failedSide}</span>}
        {game.status === 'scheduled' && <span className="tourney-game__pending">等待开赛</span>}
        {watchable && (
          <a
            className="watch-link"
            href={`/watch?mode=tournament&gameId=${encodeURIComponent(game.id)}`}
          >
            查看棋盘
          </a>
        )}
      </div>

      {game.error && (
        <p className="tourney-game__error" title={game.error}>
          {game.error}
        </p>
      )}
    </li>
  );
}

export function TournamentGames({ state }: TournamentGamesProps) {
  const games = state?.games ?? [];
  const groups = groupGamesByPair(games);
  const currentGameId = state?.currentGameId ?? null;
  const completed = state?.completedGames ?? 0;

  return (
    <section className="panel tourney-games" aria-label="对局明细">
      <div className="panel__head">
        <h2 className="panel__title">对局明细</h2>
        <span className="panel__meta">
          {games.length} 局 · {completed} 完赛
        </span>
      </div>

      {groups.length === 0 ? (
        <div className="tourney-empty">
          <span className="tourney-empty__seal" aria-hidden="true">
            谱
          </span>
          <p>尚无对局</p>
        </div>
      ) : (
        <div className="tourney-pairs">
          {groups.map((group) => {
            const first = group.games[0];
            const done = completedCount(group.games);
            const containsCurrent = Boolean(
              currentGameId && group.games.some((game) => game.id === currentGameId),
            );
            const expandFirstPair = !currentGameId && group.pairIndex === 1;

            return (
              <details
                className="tourney-pair"
                key={group.pairIndex}
                open={containsCurrent || expandFirstPair}
              >
                <summary className="tourney-pair__summary">
                  <span className="tourney-pair__index">第 {group.pairIndex} 组</span>
                  <span className="tourney-pair__names" title={`${first.redName} 对 ${first.blackName}`}>
                    {first.redName}
                    <i aria-hidden="true">对</i>
                    {first.blackName}
                  </span>
                  <span className="tourney-pair__meta">
                    {done}/{group.games.length} 局
                  </span>
                  {containsCurrent && (
                    <span className="tourney-pair__live">
                      <span className="tourney-live-dot" aria-hidden="true" />
                      进行中
                    </span>
                  )}
                  <span className="tourney-pair__chevron" aria-hidden="true" />
                </summary>

                <div className="tourney-pair__body">
                  <ol className="tourney-game-list">
                    {group.games.map((game) => (
                      <TournamentGameRow
                        key={game.id}
                        game={game}
                        watchable={game.id === currentGameId}
                      />
                    ))}
                  </ol>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </section>
  );
}
