import type { QualifierGroupView, QualifierState } from '../../../shared/protocol';
import {
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP,
  QUALIFIER_GROUP_LABELS,
} from '../../lib/championship';
import {
  QUALIFIER_GROUP_ORDER,
  QUALIFIER_PHASE_LABELS,
  qualifierCurrentGames,
  qualifierPhaseTone,
  qualifierProgress,
  qualifierStandingQualified,
} from '../../lib/qualifier';
import { ChampionshipGameList } from './ChampionshipGames';

interface QualifierBoardProps {
  state: QualifierState | null;
}

function rankTone(rank: number): string {
  if (rank === 1) {
    return 'gold';
  }
  if (rank === 2) {
    return 'silver';
  }
  return 'plain';
}

function groupStatusLabel(group: QualifierGroupView, phase: QualifierState['phase']): string {
  if (group.complete) {
    return '本组完赛';
  }
  if (phase === 'running') {
    return '进行中';
  }
  if (phase === 'paused') {
    return '已暂停';
  }
  if (phase === 'stopped' || phase === 'error' || phase === 'interrupted') {
    return '已中断';
  }
  if (phase === 'finished') {
    return '本组完赛';
  }
  return '待开赛';
}

export function QualifierBoard({ state }: QualifierBoardProps) {
  if (!state || state.entrants.length === 0) {
    return null;
  }

  const progress = qualifierProgress(state);
  const currentGames = qualifierCurrentGames(state);

  return (
    <section className="panel champ-groups qualifier-board" aria-label="入围赛积分与排名">
      <div className="panel__head">
        <h2 className="panel__title">入围赛</h2>
        <span className={`tourney-status tourney-status--${qualifierPhaseTone(state.phase)}`}>
          {QUALIFIER_PHASE_LABELS[state.phase]}
        </span>
      </div>

      <div className="qualifier-board__progress">
        <div className="tourney-progress__head">
          <span>已赛</span>
          <strong>
            {progress.groupGamesProcessed} / {progress.totalGames} 局
          </strong>
        </div>
        <div
          className="tourney-progress__track"
          role="progressbar"
          aria-label="入围赛进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
        >
          <span className="tourney-progress__fill" style={{ width: `${progress.percent}%` }} />
        </div>
      </div>

      {currentGames.length > 0 && (
        <div className="qualifier-board__current">
          {currentGames.map((current) => (
            <div key={current.game.id} className="tourney-current-row">
              <p className="tourney-current">{current.label}</p>
              <a
                className="watch-link"
                href={`/watch?mode=qualifier&gameId=${encodeURIComponent(current.game.id)}`}
              >
                查看棋盘
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="champ-groups__grid champ-groups__grid--qualifier">
        {QUALIFIER_GROUP_ORDER.map((groupId) => {
          const group = state.groups.find((candidate) => candidate.id === groupId);
          if (!group) {
            return null;
          }
          const groupGames = state.games.filter((game) => game.groupId === groupId);
          const done = groupGames.filter(
            (game) => game.status === 'finished' || game.status === 'failed',
          ).length;
          const containsCurrent = groupGames.some((game) =>
            state.currentGameIds.includes(game.id),
          );

          return (
            <article
              key={groupId}
              className={`champ-group${group.complete ? ' is-complete' : ''}${
                containsCurrent ? ' is-current' : ''
              }`}
            >
              <header className="champ-group__head">
                <div className="champ-group__title">
                  <h3>{QUALIFIER_GROUP_LABELS[groupId]}</h3>
                  <span>{groupStatusLabel(group, state.phase)}</span>
                </div>
                <span className="champ-group__progress">
                  {done} / {groupGames.length > 0 ? groupGames.length : CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP} 局
                </span>
              </header>

              {group.standings.length === 0 ? (
                <p className="champ-group__placeholder">暂无积分</p>
              ) : (
                <div
                  className="tourney-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label={`${groupId} 组入围赛积分榜，可横向滚动`}
                >
                  <table className="tourney-table champ-group__table">
                    <caption className="sr-only">{groupId} 组入围赛积分榜</caption>
                    <thead>
                      <tr>
                        <th scope="col">名次</th>
                        <th scope="col">选手</th>
                        <th scope="col" className="tourney-table__num">胜</th>
                        <th scope="col" className="tourney-table__num">和</th>
                        <th scope="col" className="tourney-table__num">负</th>
                        <th scope="col" className="tourney-table__num tourney-table__points-head">积分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.standings.map((standing) => {
                        const qualified = qualifierStandingQualified(group, standing);
                        return (
                          <tr
                            key={standing.modelId}
                            className={qualified ? 'champ-group__row is-qualified' : 'champ-group__row'}
                          >
                            <td>
                              <span className={`tourney-rank tourney-rank--${rankTone(standing.rank)}`}>
                                {standing.rank}
                              </span>
                            </td>
                            <td className="tourney-table__model">
                              <span className="tourney-table__name" title={standing.name}>
                                {standing.name}
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

              <details className="champ-group__games" open={containsCurrent}>
                <summary className="champ-group__games-summary">
                  <span>本组对局</span>
                  <span className="champ-group__games-count">
                    {done} / {groupGames.length > 0 ? groupGames.length : CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP} 局
                  </span>
                  <span className="tourney-pair__chevron" aria-hidden="true" />
                </summary>
                <div className="champ-group__games-body">
                  <ChampionshipGameList
                    games={groupGames}
                    emptyLabel="暂无对局"
                    currentGameIds={state.currentGameIds}
                    watchMode="qualifier"
                  />
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
