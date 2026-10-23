import type { TournamentModelView, TournamentStanding } from '../../../shared/protocol';
import { modelThinkingLabel } from '../../lib/tournament';

interface TournamentStandingsProps {
  models: TournamentModelView[];
  standings: TournamentStanding[];
}

function rankTone(rank: number): string {
  if (rank === 1) {
    return 'gold';
  }
  if (rank === 2) {
    return 'silver';
  }
  if (rank === 3) {
    return 'bronze';
  }
  return 'plain';
}

export function TournamentStandings({ models, standings }: TournamentStandingsProps) {
  const modelById = new Map(models.map((model) => [model.id, model]));

  return (
    <section className="panel tourney-standings" aria-label="积分排名">
      <div className="panel__head">
        <h2 className="panel__title">排名</h2>
      </div>

      {standings.length === 0 ? (
        <div className="tourney-empty">
          <span className="tourney-empty__seal" aria-hidden="true">
            榜
          </span>
          <p>暂无排名</p>
        </div>
      ) : (
        <div className="tourney-table-scroll" tabIndex={0} role="region" aria-label="积分榜，可横向滚动">
          <table className="tourney-table">
            <caption className="sr-only">模型循环赛积分榜</caption>
            <thead>
              <tr>
                <th scope="col">名次</th>
                <th scope="col">参赛模型</th>
                <th scope="col" className="tourney-table__num">
                  胜
                </th>
                <th scope="col" className="tourney-table__num">
                  和
                </th>
                <th scope="col" className="tourney-table__num">
                  负
                </th>
                <th scope="col" className="tourney-table__num tourney-table__points-head">
                  积分
                </th>
              </tr>
            </thead>
            <tbody>
              {standings.map((standing) => {
                const model = modelById.get(standing.modelId);
                return (
                  <tr key={standing.modelId}>
                    <td>
                      <span className={`tourney-rank tourney-rank--${rankTone(standing.rank)}`}>
                        {standing.rank}
                      </span>
                    </td>
                    <td className="tourney-table__model">
                      <span className="tourney-table__name" title={standing.name}>
                        {standing.name}
                      </span>
                      <span className="tourney-model-meta">
                        <span className="thinking-badge">{modelThinkingLabel(model)}</span>
                      </span>
                    </td>
                    <td className="tourney-table__num tourney-table__num--win">{standing.wins}</td>
                    <td className="tourney-table__num tourney-table__num--draw">{standing.draws}</td>
                    <td className="tourney-table__num tourney-table__num--loss">{standing.losses}</td>
                    <td className="tourney-table__num tourney-table__points">
                      {standing.points}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
