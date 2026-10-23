import type { ChampionshipGameView } from '../../../shared/protocol';
import { formatDuration } from '../../lib/format';
import {
  TOURNAMENT_GAME_STATUS_LABELS,
  describeFailedSide,
  gameStatusTone,
} from '../../lib/tournament';
import { formatChampionshipGameResult } from '../../lib/championship';

function formatGameDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return '—';
  }
  if (milliseconds < 1000) {
    return '< 1 秒';
  }
  return formatDuration(milliseconds);
}

export function ChampionshipGameRow({
  game,
  watchable = false,
  watchMode = 'championship',
}: {
  game: ChampionshipGameView;
  watchable?: boolean;
  watchMode?: 'championship' | 'qualifier';
}) {
  const tone = gameStatusTone(game.status);
  const failedSide = describeFailedSide(game);
  const showsPlies =
    game.status === 'running' || game.status === 'finished' || game.status === 'failed';
  const showsResult = game.status === 'finished';
  const showsDuration =
    (game.status === 'finished' || game.status === 'failed') && game.durationMs > 0;
  const resultText = formatChampionshipGameResult(game);
  const pairingLabel =
    game.stage === 'group' || game.stage === 'qualifier'
      ? `第 ${game.pairIndex} 对`
      : `第 ${game.gameIndex} 局`;

  return (
    <li className={`tourney-game tourney-game--${game.status} champ-game`}>
      <div className="tourney-game__head">
        <span className="tourney-game__index">{pairingLabel}</span>
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
            href={`/watch?mode=${watchMode}&gameId=${encodeURIComponent(game.id)}`}
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

interface ChampionshipGameListProps {
  games: readonly ChampionshipGameView[];
  emptyLabel?: string;
  /** Every game currently being played; all of them get a watch entry. */
  currentGameIds?: readonly string[];
  watchMode?: 'championship' | 'qualifier';
}

export function ChampionshipGameList({
  games,
  emptyLabel = '尚无对局',
  currentGameIds = [],
  watchMode = 'championship',
}: ChampionshipGameListProps) {
  if (games.length === 0) {
    return <p className="champ-games__empty">{emptyLabel}</p>;
  }

  return (
    <ol className="tourney-game-list champ-games__list">
      {games.map((game) => (
        <ChampionshipGameRow
          key={game.id}
          game={game}
          watchable={currentGameIds.includes(game.id)}
          watchMode={watchMode}
        />
      ))}
    </ol>
  );
}
