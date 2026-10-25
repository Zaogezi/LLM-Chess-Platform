import type { ChampionshipGameView, ChampionshipSeriesView } from '../../../shared/protocol';
import {
  CHAMPIONSHIP_KNOCKOUT_STAGES,
  buildChampionshipBracket,
  championshipStageLabel,
  gamesForSeries,
} from '../../lib/championship';
import { ChampionshipSeriesCard } from './ChampionshipSeriesCard';

interface ChampionshipBracketProps {
  series: readonly ChampionshipSeriesView[];
  games: readonly ChampionshipGameView[];
  currentSeriesId: string | null;
  currentGameIds?: readonly string[];
  /** Preview skeleton shown before the server starts the bracket. */
  preview: boolean;
}

export function ChampionshipBracket({
  series,
  games,
  currentSeriesId,
  currentGameIds = [],
  preview,
}: ChampionshipBracketProps) {
  const bracket = buildChampionshipBracket(series);

  return (
    <section
      className={`panel champ-bracket${preview ? ' is-preview' : ''}`}
      aria-label="淘汰赛对局图"
    >
      <div className="panel__head">
        <h2 className="panel__title">淘汰赛</h2>
      </div>

      {series.length === 0 ? (
        <div className="tourney-empty">
          <span className="tourney-empty__seal" aria-hidden="true">
            决
          </span>
          <p>尚无淘汰赛</p>
        </div>
      ) : (
        <div className="champ-bracket__grid">
          {CHAMPIONSHIP_KNOCKOUT_STAGES.map((stage) => {
            const key = stage as 'quarterfinal' | 'semifinal' | 'final';
            const items = bracket[key];
            return (
              <section
                key={stage}
                className={`champ-bracket__round champ-bracket__round--${stage}`}
                aria-label={championshipStageLabel(stage)}
              >
                <header className="champ-bracket__round-head">
                  <h3>{championshipStageLabel(stage)}</h3>
                </header>
                <div className="champ-bracket__list">
                  {items.length === 0 ? (
                    <p className="champ-bracket__placeholder">等待上一轮结果</p>
                  ) : (
                    items.map((item) => (
                      <ChampionshipSeriesCard
                        key={item.id}
                        series={item}
                        games={gamesForSeries(games, item.id)}
                        current={item.id === currentSeriesId}
                        currentGameIds={currentGameIds}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
