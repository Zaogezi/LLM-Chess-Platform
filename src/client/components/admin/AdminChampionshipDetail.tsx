import type { ChampionshipArchive } from '../../../shared/protocol';
import {
  championshipArchiveChampionLabel,
  championshipArchiveLastStage,
  championshipArchivePhaseTone,
  formatArchiveDuration,
  formatArchiveGames,
  formatArchiveRange,
  formatArchiveSeries,
  CHAMPIONSHIP_ARCHIVE_PHASE_LABELS,
  toChampionshipPhase,
} from '../../lib/championshipArchive';
import {
  CHAMPIONSHIP_GROUP_GAMES,
  championshipStageLabel,
} from '../../lib/championship';
import { Spinner } from '../Icons';
import { ChampionshipBracket } from '../championship/ChampionshipBracket';
import { ChampionshipGroups } from '../championship/ChampionshipGroups';

interface AdminChampionshipDetailProps {
  archiveId: string | null;
  archive: ChampionshipArchive | null;
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
}

function AdminChampionshipContent({ archive }: { archive: ChampionshipArchive }) {
  const phase = toChampionshipPhase(archive.phase);
  const phaseLabel = CHAMPIONSHIP_ARCHIVE_PHASE_LABELS[archive.phase];
  const tone = championshipArchivePhaseTone(archive.phase);
  const champion = championshipArchiveChampionLabel(archive);
  const lastStage = championshipArchiveLastStage(archive);
  const entrantCount = archive.entrants.length || archive.entrantNames.length;
  const groupGamesPlayed = archive.games.filter(
    (game) =>
      game.stage === 'group' &&
      (game.status === 'finished' || game.status === 'failed'),
  ).length;

  return (
    <div className="admin-champ-detail__content">
      <section
        className={`admin-champ-banner${
          archive.championName ? ' is-champion' : ' is-unfinished'
        }`}
        aria-label="档案概要"
      >
        <span className="admin-champ-banner__glow" aria-hidden="true" />
        <span className="admin-champ-banner__seal" aria-hidden="true">
          {archive.championName ? '冠' : '锦'}
        </span>
        <div className="admin-champ-banner__body">
          <h3 className="admin-champ-banner__name">{champion}</h3>
          <p className="admin-champ-banner__meta">
            <span className={`admin-champ-phase admin-champ-phase--${tone}`}>{phaseLabel}</span>
            <span>进行至 {championshipStageLabel(lastStage)}</span>
            <span>{entrantCount} 位参赛</span>
          </p>
        </div>
      </section>

      {archive.error && (
        <div className="admin-alert admin-alert--error" role="status">
          <span>{archive.error}</span>
        </div>
      )}

      <dl className="admin-facts admin-champ-facts">
        <div>
          <dt>赛程区间</dt>
          <dd>{formatArchiveRange(archive)}</dd>
        </div>
        <div>
          <dt>用时</dt>
          <dd>{formatArchiveDuration(archive)}</dd>
        </div>
        <div>
          <dt>对局进度</dt>
          <dd>{formatArchiveGames(archive)}</dd>
        </div>
        <div>
          <dt>系列赛进度</dt>
          <dd>{formatArchiveSeries(archive)}</dd>
        </div>
        <div>
          <dt>小组赛</dt>
          <dd>
            {groupGamesPlayed} / {archive.groupGamesTotal || CHAMPIONSHIP_GROUP_GAMES} 局
          </dd>
        </div>
      </dl>

      <ChampionshipGroups
        phase={phase}
        groups={archive.groups}
        entrants={archive.entrants}
        games={archive.games}
        currentGameIds={[]}
        preview={false}
      />

      <ChampionshipBracket
        series={archive.series}
        games={archive.games}
        currentSeriesId={null}
        currentGameIds={[]}
        preview={false}
      />
    </div>
  );
}

export function AdminChampionshipDetail({
  archiveId,
  archive,
  loading,
  error,
  onClose,
  onRetry,
}: AdminChampionshipDetailProps) {
  return (
    <aside
      className={`panel admin-detail admin-champ-detail${archiveId ? ' is-open' : ''}`}
      aria-label="锦标赛档案详情"
      aria-busy={loading}
    >
      <div className="admin-detail__head">
        <h2 className="admin-detail__title">档案详情</h2>
        <button
          type="button"
          className="admin-detail__close"
          onClick={onClose}
          disabled={!archiveId}
          aria-label="关闭锦标赛档案详情"
        >
          ×
        </button>
      </div>

      {!archiveId && (
        <div className="admin-detail__placeholder">
          <span className="admin-detail__seal" aria-hidden="true">
            锦
          </span>
          <p>选择一届锦标赛</p>
        </div>
      )}

      {archiveId && loading && (
        <div className="admin-detail__loading" role="status">
          <Spinner />
        </div>
      )}

      {archiveId && !loading && error && (
        <div className="admin-detail__error">
          <div className="admin-alert admin-alert--error" role="alert">
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn--secondary btn--compact" onClick={onRetry}>
            重新加载
          </button>
        </div>
      )}

      {archiveId && !loading && !error && archive && (
        <AdminChampionshipContent archive={archive} />
      )}
    </aside>
  );
}
