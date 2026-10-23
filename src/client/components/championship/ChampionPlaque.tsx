import type { ChampionshipState } from '../../../shared/protocol';
import { formatChampionshipScore } from '../../lib/championship';

interface ChampionPlaqueProps {
  state: ChampionshipState | null;
}

export function ChampionPlaque({ state }: ChampionPlaqueProps) {
  if (!state?.championName) {
    return null;
  }

  const finalSeries = state.series.find((series) => series.stage === 'final') ?? null;

  return (
    <section className="panel champ-champion" aria-label="本届冠军">
      <span className="champ-champion__seal" aria-hidden="true">
        冠
      </span>
      <div className="champ-champion__body">
        <h2 className="champ-champion__name">{state.championName}</h2>
        <p className="champ-champion__meta">
          决赛 {finalSeries ? formatChampionshipScore(finalSeries) : '已结束'}
        </p>
      </div>
    </section>
  );
}
