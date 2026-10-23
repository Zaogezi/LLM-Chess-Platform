import type { ChampionshipGameView, ChampionshipSeriesView } from '../../../shared/protocol';
import {
  CHAMPIONSHIP_SERIES_STATUS_LABELS,
  championshipSeriesLabel,
  championshipSeriesStageFlag,
  championshipSeriesStatusTone,
  formatChampionshipScore,
  formatSeriesProgress,
  seriesSeedPlaceholder,
  seriesWinnerName,
} from '../../lib/championship';
import { ChampionshipGameList } from './ChampionshipGames';

interface ChampionshipSeriesCardProps {
  series: ChampionshipSeriesView;
  games: readonly ChampionshipGameView[];
  current: boolean;
  currentGameIds?: readonly string[];
}

export function ChampionshipSeriesCard({
  series,
  games,
  current,
  currentGameIds = [],
}: ChampionshipSeriesCardProps) {
  const tone = championshipSeriesStatusTone(series.status);
  const winnerName = seriesWinnerName(series);
  const stageFlag = championshipSeriesStageFlag(series);
  const leftWinner = Boolean(series.winnerModelId && series.left?.modelId === series.winnerModelId);
  const rightWinner = Boolean(
    series.winnerModelId && series.right?.modelId === series.winnerModelId,
  );
  const played = series.playedGames;
  const leftName = series.left?.name ?? seriesSeedPlaceholder(series, 'left');
  const rightName = series.right?.name ?? seriesSeedPlaceholder(series, 'right');

  let liveText = `进行中 · 第 ${played + 1} 局`;
  if (series.overtime) {
    liveText = '同时 3 分 · 加时下一局决胜';
  } else if (series.extra) {
    liveText = `小组排名相同 · 加赛第 ${played + 1} 局`;
  } else if (played >= series.maxGames) {
    liveText = '6 局已满 · 等待判定';
  }

  return (
    <article
      className={`champ-series champ-series--${series.stage}${
        current ? ' is-current' : ''
      }${series.status === 'finished' ? ' is-finished' : ''}`}
      aria-label={`${championshipSeriesLabel(series)}，${CHAMPIONSHIP_SERIES_STATUS_LABELS[series.status]}`}
    >
      <header className="champ-series__head">
        <span className="champ-series__label">{championshipSeriesLabel(series)}</span>
        {stageFlag && (
          <span className={`champ-series__flag${series.extra ? ' is-extra' : ''}`}>
            {stageFlag}
          </span>
        )}
        <span className={`tourney-status tourney-status--${tone}`}>
          {CHAMPIONSHIP_SERIES_STATUS_LABELS[series.status]}
        </span>
      </header>

      <div className="champ-series__board">
        <div className={`champ-series__row${leftWinner ? ' is-winner' : ''}`}>
          <span className="champ-series__side">
            {leftWinner && (
              <span className="mini-seal mini-seal--red" aria-hidden="true">
                胜
              </span>
            )}
            <span
              className={`champ-series__name${series.left ? '' : ' is-placeholder'}`}
              title={leftName}
            >
              {leftName}
            </span>
          </span>
          <span
            className="champ-series__points"
            title={`系列赛积分 ${formatChampionshipScore(series)}`}
          >
            {series.leftPoints}
          </span>
        </div>
        <div className={`champ-series__row${rightWinner ? ' is-winner' : ''}`}>
          <span className="champ-series__side">
            {rightWinner && (
              <span className="mini-seal mini-seal--black" aria-hidden="true">
                胜
              </span>
            )}
            <span
              className={`champ-series__name${series.right ? '' : ' is-placeholder'}`}
              title={rightName}
            >
              {rightName}
            </span>
          </span>
          <span
            className="champ-series__points"
            title={`系列赛积分 ${formatChampionshipScore(series)}`}
          >
            {series.rightPoints}
          </span>
        </div>
      </div>

      {current && series.status === 'running' && (
        <p className="champ-series__live">
          <span className="tourney-live-dot" aria-hidden="true" />
          {liveText}
        </p>
      )}

      {winnerName && (
        <p className="champ-series__winner">
          <span>{series.stage === 'final' ? '冠军' : '晋级'}</span>
          {winnerName}
        </p>
      )}

      <details className="champ-group__games champ-series__games" open={current}>
        <summary className="champ-group__games-summary">
          <span>系列赛对局</span>
          <span className="champ-group__games-count">
            {games.length} 局 · {formatSeriesProgress(series)}
          </span>
          <span className="tourney-pair__chevron" aria-hidden="true" />
        </summary>
        <div className="champ-group__games-body">
          <ChampionshipGameList
            games={games}
            emptyLabel="暂无对局"
            currentGameIds={currentGameIds}
          />
        </div>
      </details>
    </article>
  );
}
