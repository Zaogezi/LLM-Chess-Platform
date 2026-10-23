import type { HistoryGameSummary, HistoryListResponse } from '../../../shared/protocol';
import {
  HISTORY_MODE_LABELS,
  describeHistoryOutcome,
  describeHistoryRecordForAria,
  formatHistoryCount,
  formatHistoryDate,
  formatHistoryDateTime,
  formatHistoryDuration,
  formatHistoryTime,
  historyPlayerMeta,
  historyPlayerThinking,
} from '../../lib/history';
import { Spinner } from '../Icons';

interface AdminRecordListProps {
  data: HistoryListResponse | null;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  pendingDeleteId: string | null;
  deleteBusy: boolean;
  filtersActive: boolean;
  onOpen: (id: string) => void;
  onDelete: (record: HistoryGameSummary) => void;
  onRetry: () => void;
  onResetFilters: () => void;
  onPrev: () => void;
  onNext: () => void;
}

interface AdminRecordRowProps {
  record: HistoryGameSummary;
  selected: boolean;
  deleting: boolean;
  deleteBusy: boolean;
  onOpen: (id: string) => void;
  onDelete: (record: HistoryGameSummary) => void;
}

function AdminRecordRow({
  record,
  selected,
  deleting,
  deleteBusy,
  onOpen,
  onDelete,
}: AdminRecordRowProps) {
  const outcome = describeHistoryOutcome(record);

  return (
    <li className={`admin-record${selected ? ' is-selected' : ''}`}>
      <button
        type="button"
        className="admin-record__open"
        onClick={() => onOpen(record.id)}
        aria-pressed={selected}
        aria-label={describeHistoryRecordForAria(record)}
      >
        <span className="admin-record__when">
          <span className="admin-record__date">{formatHistoryDate(record.endedAt)}</span>
          <span className="admin-record__time">{formatHistoryTime(record.endedAt)}</span>
          <span className={`admin-source admin-source--${record.mode}`}>
            {HISTORY_MODE_LABELS[record.mode]}
          </span>
        </span>

        <span className="admin-record__matchup">
          {(['red', 'black'] as const).map((side) => {
            const player = record[side];
            return (
              <span
                key={side}
                className={`admin-record__side admin-record__side--${side}`}
              >
                <span className={`mini-seal mini-seal--${side}`} aria-hidden="true">
                  {side === 'red' ? '红' : '黑'}
                </span>
                <span className="admin-record__names">
                  <span className="admin-record__name" title={player.name}>
                    {player.name}
                  </span>
                  <span
                    className="admin-record__model"
                    title={historyPlayerMeta(player)}
                  >
                    {historyPlayerMeta(player)}
                  </span>
                </span>
                <span className="thinking-badge">{historyPlayerThinking(player)}</span>
              </span>
            );
          })}
        </span>

        <span className={`admin-record__outcome admin-outcome admin-outcome--${outcome.tone}`}>
          <strong>{outcome.label}</strong>
          <span title={outcome.detail}>{outcome.detail}</span>
        </span>

        <span className="admin-record__metrics">
          <span>{record.plies} 手</span>
          <span>{formatHistoryDuration(record.durationMs)}</span>
        </span>
      </button>

      <button
        type="button"
        className="admin-record__delete"
        onClick={() => onDelete(record)}
        disabled={deleting || deleteBusy}
        aria-label={`删除 ${formatHistoryDateTime(record.endedAt)} 的历史对局`}
        title="删除该档案"
      >
        {deleting ? <Spinner /> : '删除'}
      </button>
    </li>
  );
}

function AdminListSkeleton() {
  return (
    <div className="admin-list-skeleton" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="admin-list-skeleton__row">
          <span className="admin-list-skeleton__when" />
          <span className="admin-list-skeleton__main" />
          <span className="admin-list-skeleton__result" />
        </div>
      ))}
    </div>
  );
}

export function AdminRecordList({
  data,
  loading,
  error,
  selectedId,
  pendingDeleteId,
  deleteBusy,
  filtersActive,
  onOpen,
  onDelete,
  onRetry,
  onResetFilters,
  onPrev,
  onNext,
}: AdminRecordListProps) {
  const records = data?.records ?? [];
  const total = data?.total ?? 0;
  const offset = data?.offset ?? 0;
  const limit = data?.limit ?? 20;
  const page = Math.floor(offset / Math.max(limit, 1)) + 1;
  const pages = Math.max(1, Math.ceil(total / Math.max(limit, 1)));
  const refreshing = loading && data !== null;

  return (
    <section
      className="panel admin-list"
      aria-label="历史档案列表"
      aria-busy={loading}
    >
      <div className="panel__head">
        <h2 className="panel__title">对局档案</h2>
        <span className="panel__meta admin-list__meta">
          {data ? `${formatHistoryCount(total)} 条` : '读取中…'}
          {refreshing && (
            <span className="admin-list__refreshing">
              <Spinner />
            </span>
          )}
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

      {loading && !data && <AdminListSkeleton />}

      {!loading && !data && !error && (
        <div className="admin-empty">
          <span className="admin-empty__seal" aria-hidden="true">
            档
          </span>
          <p>档案未载入</p>
        </div>
      )}

      {data && records.length === 0 && (
        <div className="admin-empty">
          <span className="admin-empty__seal" aria-hidden="true">
            {filtersActive ? '筛' : '档'}
          </span>
          <p>{filtersActive ? '没有符合条件的对局' : '暂无对局'}</p>
          {filtersActive && (
            <button
              type="button"
              className="btn btn--secondary btn--compact"
              onClick={onResetFilters}
            >
              重置
            </button>
          )}
        </div>
      )}

      {records.length > 0 && (
        <ul className={`admin-record-list${refreshing ? ' is-refreshing' : ''}`}>
          {records.map((record) => (
            <AdminRecordRow
              key={record.id}
              record={record}
              selected={record.id === selectedId}
              deleting={pendingDeleteId === record.id}
              deleteBusy={deleteBusy}
              onOpen={onOpen}
              onDelete={onDelete}
            />
          ))}
        </ul>
      )}

      {data && total > 0 && (
        <nav className="admin-pagination" aria-label="档案分页">
          <button
            type="button"
            className="btn btn--secondary btn--compact"
            onClick={onPrev}
            disabled={loading || offset <= 0}
          >
            ← 上一页
          </button>
          <span className="admin-pagination__status">
            {page} / {pages}
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--compact"
            onClick={onNext}
            disabled={loading || offset + limit >= total}
          >
            下一页 →
          </button>
        </nav>
      )}
    </section>
  );
}
