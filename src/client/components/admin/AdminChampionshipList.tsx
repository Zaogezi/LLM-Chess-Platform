import type {
  ChampionshipArchiveListResponse,
  ChampionshipArchiveSummary,
} from '../../../shared/protocol';
import {
  CHAMPIONSHIP_ARCHIVE_PHASE_LABELS,
  championshipArchiveAriaSummary,
  championshipArchiveChampionLabel,
  championshipArchiveEntrantText,
  championshipArchivePhaseTone,
  formatArchiveGames,
  formatArchiveRange,
  formatArchiveSeries,
} from '../../lib/championshipArchive';
import { Spinner } from '../Icons';

interface AdminChampionshipListProps {
  data: ChampionshipArchiveListResponse | null;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRetry: () => void;
  onRefresh: () => void;
}

function AdminChampionshipRow({
  archive,
  selected,
  onSelect,
}: {
  archive: ChampionshipArchiveSummary;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const phaseLabel = CHAMPIONSHIP_ARCHIVE_PHASE_LABELS[archive.phase];
  const tone = championshipArchivePhaseTone(archive.phase);
  const champion = championshipArchiveChampionLabel(archive);

  return (
    <li className={`admin-champ-record${selected ? ' is-selected' : ''}`}>
      <button
        type="button"
        className="admin-champ-record__open"
        onClick={() => onSelect(archive.championshipId)}
        aria-pressed={selected}
        aria-label={championshipArchiveAriaSummary(archive)}
      >
        <span className="admin-champ-record__when">
          <span className="admin-champ-record__range">{formatArchiveRange(archive)}</span>
          <span className={`admin-champ-phase admin-champ-phase--${tone}`}>{phaseLabel}</span>
        </span>

        <span
          className={`admin-champ-record__champion${
            archive.championName ? ' is-champion' : ' is-unfinished'
          }`}
        >
          <span className="mini-seal mini-seal--red" aria-hidden="true">
            {archive.championName ? '冠' : '锦'}
          </span>
          <span className="admin-champ-record__champion-name" title={champion}>
            {champion}
          </span>
        </span>

        <span className="admin-champ-record__meta">
          <span>已完赛 {formatArchiveGames(archive)}</span>
          <span>系列赛 {formatArchiveSeries(archive)}</span>
        </span>

        <span className="admin-champ-record__entrants" title={archive.entrantNames.join('、')}>
          {championshipArchiveEntrantText(archive)}
        </span>

        {archive.error && (
          <span className="admin-champ-record__error" title={archive.error}>
            {archive.error}
          </span>
        )}
      </button>
    </li>
  );
}

function AdminChampionshipSkeleton() {
  return (
    <div className="admin-champ-skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="admin-champ-skeleton__row">
          <span className="admin-champ-skeleton__when" />
          <span className="admin-champ-skeleton__main" />
          <span className="admin-champ-skeleton__meta" />
        </div>
      ))}
    </div>
  );
}

export function AdminChampionshipList({
  data,
  loading,
  error,
  selectedId,
  onSelect,
  onRetry,
  onRefresh,
}: AdminChampionshipListProps) {
  const archives = data?.archives ?? [];
  const total = data?.total ?? 0;
  const refreshing = loading && data !== null;

  return (
    <section className="panel admin-list admin-champ-list" aria-label="锦标赛档案列表" aria-busy={loading}>
      <div className="panel__head">
        <h2 className="panel__title">历届档案</h2>
        <span className="panel__meta admin-list__meta">
          {data ? `${total} 届` : '读取中…'}
          {refreshing && (
            <span className="admin-list__refreshing">
              <Spinner />
            </span>
          )}
          <button
            type="button"
            className="btn btn--secondary btn--compact admin-champ-list__refresh"
            onClick={onRefresh}
            disabled={loading}
          >
            刷新
          </button>
        </span>
      </div>

      {error && (
        <div className="admin-alert admin-alert--error" role="alert">
          <span>{error}</span>
          <button type="button" className="admin-alert__action" onClick={onRetry}>
            重试
          </button>
        </div>
      )}

      {loading && !data && <AdminChampionshipSkeleton />}

      {!loading && !data && !error && (
        <div className="admin-empty">
          <span className="admin-empty__seal" aria-hidden="true">
            锦
          </span>
          <p>档案未载入</p>
        </div>
      )}

      {data && archives.length === 0 && (
        <div className="admin-empty">
          <span className="admin-empty__seal" aria-hidden="true">
            锦
          </span>
          <p>暂无档案</p>
        </div>
      )}

      {archives.length > 0 && (
        <ul className={`admin-champ-record-list${refreshing ? ' is-refreshing' : ''}`}>
          {archives.map((archive) => (
            <AdminChampionshipRow
              key={archive.championshipId}
              archive={archive}
              selected={archive.championshipId === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
