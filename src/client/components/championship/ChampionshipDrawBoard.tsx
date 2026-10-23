import type { ChampionshipPhase } from '../../../shared/protocol';
import type { ChampionshipDraw } from '../../lib/championship';
import {
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_SEED_POOLS,
  championshipGroupLabel,
  championshipPoolSeal,
} from '../../lib/championship';

interface ChampionshipDrawBoardProps {
  draw: ChampionshipDraw | null;
  phase: ChampionshipPhase;
  canDraw: boolean;
  /** True once the qualifying round has produced the four pool-4 entrants. */
  qualifierFinished: boolean;
  drawDisabledReason: string | null;
  onDraw: () => void;
}

export function ChampionshipDrawBoard({
  draw,
  phase,
  canDraw,
  qualifierFinished,
  drawDisabledReason,
  onDraw,
}: ChampionshipDrawBoardProps) {
  const running = phase === 'running';
  const drawLabel = qualifierFinished ? (draw ? '重新抽签' : '随机抽签') : '等待入围赛';
  const statusText = running
    ? '已锁定'
    : draw
      ? '已抽签'
      : qualifierFinished
        ? '未抽签'
        : '待入围赛';

  return (
    <section className="panel champ-draw" aria-label="抽签分组">
      <div className="panel__head">
        <h2 className="panel__title">抽签分组</h2>
        <span className="panel__meta">{statusText}</span>
      </div>

      <div className="champ-draw__actions">
        <button
          type="button"
          className="btn btn--primary btn--compact"
          onClick={onDraw}
          disabled={!canDraw}
          title={drawDisabledReason ?? undefined}
        >
          {drawLabel}
        </button>
        {canDraw && drawDisabledReason && (
          <span className="champ-draw__status">{drawDisabledReason}</span>
        )}
      </div>

      {draw === null ? (
        <div className="tourney-empty champ-draw__empty">
          <span className="tourney-empty__seal" aria-hidden="true">
            签
          </span>
          <p>{qualifierFinished ? '尚未抽签' : '入围赛结束后抽签'}</p>
        </div>
      ) : (
        <div className="champ-draw__grid">
          {CHAMPIONSHIP_GROUPS.map((groupId) => {
            const group = draw.groups.find((candidate) => candidate.id === groupId);
            return (
              <article key={groupId} className={`champ-draw-group champ-draw-group--${groupId}`}>
                <header className="champ-draw-group__head">
                  <span className="champ-draw-group__seal" aria-hidden="true">
                    {groupId}
                  </span>
                  <h3>{championshipGroupLabel(groupId)}</h3>
                  <span className="champ-draw-group__meta">池四入围</span>
                </header>
                <ul className="champ-draw-group__slots">
                  {CHAMPIONSHIP_SEED_POOLS.map((pool) => {
                    const slot = group?.slots.find((candidate) => candidate.pool === pool);
                    return (
                      <li key={pool} className="champ-draw-row">
                        <span className="champ-draw-row__pot" aria-label={`${pool} 号种子池`}>
                          {championshipPoolSeal(pool)}池
                        </span>
                        <span
                          className={`champ-draw-row__name${slot ? '' : ' is-empty'}`}
                          title={slot?.name}
                        >
                          {slot?.name ?? '待定'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
