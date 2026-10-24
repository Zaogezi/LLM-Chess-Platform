import type {
  ChampionshipEntrantView,
  ChampionshipGameView,
  ChampionshipGroupId,
  ChampionshipGroupView,
  ChampionshipPhase,
} from '../../../shared/protocol';
import {
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_GROUP_GAMES_PER_GROUP,
  gamesForGroup,
  groupQualificationLabel,
  groupStandingQualified,
} from '../../lib/championship';
import { modelThinkingLabel } from '../../lib/tournament';
import { ChampionshipGameList } from './ChampionshipGames';

interface ChampionshipGroupsProps {
  phase: ChampionshipPhase;
  groups: readonly ChampionshipGroupView[];
  entrants: readonly ChampionshipEntrantView[];
  games: readonly ChampionshipGameView[];
  currentGameIds: readonly string[];
  /** Local draw preview before the server has created the groups. */
  preview: boolean;
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

function groupProgressLabel(
  phase: ChampionshipPhase,
  group: ChampionshipGroupView,
  done: number,
): string {
  if (group.complete) {
    return '小组完赛';
  }
  if (phase === 'running') {
    return done === 0 ? '即将开赛' : '进行中';
  }
  if (phase === 'finished') {
    return '小组完赛';
  }
  if (phase === 'paused') {
    return done === 0 ? '未开赛' : '已暂停';
  }
  if (phase === 'stopped' || phase === 'error' || phase === 'interrupted') {
    return done === 0 ? '未开赛' : '已中断';
  }
  return '待开赛';
}

export function ChampionshipGroups({
  phase,
  groups,
  entrants,
  games,
  currentGameIds,
  preview,
}: ChampionshipGroupsProps) {
  const entrantById = new Map(entrants.map((entrant) => [entrant.id, entrant]));
  const hasGroups = groups.length > 0;

  return (
    <section className="panel champ-groups" aria-label="小组赛积分与排名">
      <div className="panel__head">
        <h2 className="panel__title">小组赛</h2>
      </div>

      {!hasGroups ? (
        <div className="tourney-empty">
          <span className="tourney-empty__seal" aria-hidden="true">
            组
          </span>
          <p>尚无小组</p>
        </div>
      ) : (
        <div className="champ-groups__grid">
          {CHAMPIONSHIP_GROUPS.map((groupId) => {
            const group = groups.find((candidate) => candidate.id === groupId);
            if (!group) {
              return null;
            }
            const groupGames = gamesForGroup(games, groupId);
            const done = groupGames.filter(
              (game) => game.status === 'finished' || game.status === 'failed',
            ).length;
            const containsCurrent = groupGames.some((game) =>
              currentGameIds.includes(game.id),
            );

            return (
              <article
                key={groupId}
                className={`champ-group${group.complete ? ' is-complete' : ''}${
                  containsCurrent ? ' is-current' : ''
                }`}
              >
                <header className="champ-group__head">
                  <span className="champ-group__seal" aria-hidden="true">
                    {groupId}
                  </span>
                  <div className="champ-group__title">
                    <h3>{groupId} 组</h3>
                    <span>{groupProgressLabel(phase, group, done)}</span>
                  </div>
                  <span className="champ-group__progress">
                    {done} / {groupGames.length > 0 ? groupGames.length : CHAMPIONSHIP_GROUP_GAMES_PER_GROUP} 局
                  </span>
                </header>

                {group.standings.length === 0 ? (
                  <p className="champ-group__placeholder">暂无积分</p>
                ) : (
                  <div className="tourney-table-scroll" tabIndex={0} role="region" aria-label={`${groupId} 组积分榜，可横向滚动`}>
                    <table className="tourney-table champ-group__table">
                      <caption className="sr-only">{groupId} 组小组赛积分榜</caption>
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
                          const showQualification =
                            !preview && (group.complete || phase === 'running');
                          const qualified =
                            showQualification && groupStandingQualified(group, standing);
                          const badge = showQualification
                            ? groupQualificationLabel(group, standing)
                            : '';
                          const entrant = entrantById.get(standing.modelId);
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
                                <span className="tourney-model-meta">
                                  <span className="thinking-badge">{modelThinkingLabel(entrant)}</span>
                                  {entrant && (
                                    <span className="champ-pool-chip">{entrant.seedPool} 池</span>
                                  )}
                                </span>
                                {badge && <span className={`champ-qual-badge${group.complete ? ' is-final' : ''}`}>{badge}</span>}
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
                      {done} / {groupGames.length > 0 ? groupGames.length : CHAMPIONSHIP_GROUP_GAMES_PER_GROUP} 局
                    </span>
                    <span className="tourney-pair__chevron" aria-hidden="true" />
                  </summary>
                  <div className="champ-group__games-body">
                    <ChampionshipGameList
                      games={groupGames}
                      emptyLabel="暂无对局"
                      currentGameIds={currentGameIds}
                    />
                  </div>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
