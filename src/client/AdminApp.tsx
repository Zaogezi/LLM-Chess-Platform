import { useEffect, useMemo, useState } from 'react';
import type { HistoryGameSummary } from '../shared/protocol';
import { useHistory } from './hooks/useHistory';
import { useChampionshipArchives } from './hooks/useChampionshipArchives';
import type { HistoryFilters } from './lib/history';
import {
  DEFAULT_HISTORY_FILTERS,
  formatHistoryCount,
  formatHistoryDateTime,
  isHistoryFilterActive,
} from './lib/history';
import { FixedNav } from './components/FixedNav';
import { AdminChampionshipDetail } from './components/admin/AdminChampionshipDetail';
import { AdminChampionshipList } from './components/admin/AdminChampionshipList';
import { AdminDetailPanel } from './components/admin/AdminDetailPanel';
import { AdminFilters } from './components/admin/AdminFilters';
import { AdminHeader } from './components/admin/AdminHeader';
import { AdminRecordList } from './components/admin/AdminRecordList';
import { AdminStats } from './components/admin/AdminStats';
import { Spinner } from './components/Icons';

type AdminTab = 'games' | 'championship';

export default function AdminApp() {
  const history = useHistory();
  const archives = useChampionshipArchives();
  const [tab, setTab] = useState<AdminTab>('games');
  const [draft, setDraft] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '对局管理 · 楚河论弈';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const stats = history.data?.stats ?? null;
  const filtersActive = isHistoryFilterActive(history.filters);
  const busy = history.pending !== null;
  const recordCount = stats?.total ?? 0;
  const archiveCount = archives.data?.total ?? 0;

  const ariaSummary = useMemo(() => {
    if (tab === 'championship') {
      if (!archives.data) {
        return archives.listError
          ? `锦标赛档案读取失败：${archives.listError}`
          : '正在读取锦标赛档案。';
      }
      const base = `锦标赛档案，共 ${archives.data.total} 届可回看。`;
      if (archives.detail) {
        return `${base} 已打开 ${archives.detail.championName ?? '未产生冠军'} 的锦标赛档案。`;
      }
      return base;
    }
    if (!history.data) {
      return history.listError ? `历史档案读取失败：${history.listError}` : '正在读取历史档案。';
    }
    const base = `对局管理，共 ${history.data.stats.total} 条历史档案，当前筛选 ${history.data.total} 条。`;
    if (history.detail) {
      return `${base} 已打开 ${history.detail.red.name} 对 ${history.detail.black.name} 的档案。`;
    }
    return base;
  }, [
    tab,
    archives.data,
    archives.detail,
    archives.listError,
    history.data,
    history.detail,
    history.listError,
  ]);

  const handleApply = () => {
    history.applyFilters(draft);
  };

  const handleReset = () => {
    setDraft(DEFAULT_HISTORY_FILTERS);
    history.resetFilters();
  };

  const handleDeleteRecord = async (record: HistoryGameSummary) => {
    if (busy) {
      return;
    }
    const confirmed = window.confirm(
      `确定删除 ${formatHistoryDateTime(record.endedAt)} 的历史对局（红方 ${record.red.name} 对黑方 ${record.black.name}）？此操作不可撤销。`,
    );
    if (!confirmed) {
      return;
    }
    await history.removeRecord(record.id);
  };

  const handleClearAll = async () => {
    if (busy || recordCount === 0) {
      return;
    }
    const confirmed = window.confirm(
      `确定清空全部 ${recordCount} 条历史对局？此操作不可撤销。`,
    );
    if (!confirmed) {
      return;
    }
    await history.clearAll();
  };

  const handlePrev = () => {
    history.goToOffset(Math.max(0, history.offset - history.limit));
  };

  const handleNext = () => {
    history.goToOffset(history.offset + history.limit);
  };

  return (
    <div className="app admin-app">
      <FixedNav current="admin" />
      <AdminHeader />

      <main className="admin-main">
        <nav className="admin-tabs" role="tablist" aria-label="对局管理分区">
          <button
            type="button"
            role="tab"
            id="admin-tab-games"
            aria-selected={tab === 'games'}
            aria-controls="admin-panel-games"
            className={`admin-tab${tab === 'games' ? ' is-active' : ''}`}
            onClick={() => setTab('games')}
          >
            对局档案
          </button>
          <button
            type="button"
            role="tab"
            id="admin-tab-championship"
            aria-selected={tab === 'championship'}
            aria-controls="admin-panel-championship"
            className={`admin-tab${tab === 'championship' ? ' is-active' : ''}`}
            onClick={() => setTab('championship')}
          >
            锦标赛档案
            {archiveCount > 0 && (
              <span className="admin-tab__count">{formatHistoryCount(archiveCount)}</span>
            )}
          </button>
        </nav>

        {tab === 'games' ? (
          <div
            className="admin-tab-panel"
            id="admin-panel-games"
            role="tabpanel"
            aria-labelledby="admin-tab-games"
          >
            <section className="panel admin-hero" aria-label="对局管理">
              <h2 className="admin-hero__title">对局档案</h2>

              <div className="admin-hero__actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--compact"
                  onClick={history.refresh}
                  disabled={history.loading || busy}
                >
                  {history.loading ? (
                    <>
                      <Spinner />
                      读取中…
                    </>
                  ) : (
                    '刷新档案'
                  )}
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--compact"
                  onClick={() => {
                    void handleClearAll();
                  }}
                  disabled={busy || history.loading || recordCount === 0}
                  aria-busy={history.pending === 'clear'}
                >
                  {history.pending === 'clear' ? (
                    <>
                      <Spinner />
                      清空中…
                    </>
                  ) : (
                    '清空全部'
                  )}
                </button>
              </div>
            </section>

            <AdminStats stats={stats} loading={history.loading && !history.data} />

            <AdminFilters
              draft={draft}
              onChange={setDraft}
              onApply={handleApply}
              onReset={handleReset}
              busy={busy}
            />

            {history.actionError && (
              <div className="admin-alert admin-alert--error" role="alert">
                <span>{history.actionError}</span>
                <button
                  type="button"
                  className="admin-alert__dismiss"
                  onClick={history.dismissActionError}
                  aria-label="关闭错误提示"
                >
                  ×
                </button>
              </div>
            )}

            <div className="admin-workspace">
              {history.detailId && (
                <button
                  type="button"
                  className="admin-detail-backdrop"
                  onClick={history.closeDetail}
                  aria-label="关闭对局详情"
                />
              )}

              <AdminRecordList
                data={history.data}
                loading={history.loading}
                error={history.listError}
                selectedId={history.detailId}
                pendingDeleteId={history.pendingId}
                deleteBusy={busy}
                filtersActive={filtersActive}
                onOpen={history.openDetail}
                onDelete={(record) => {
                  void handleDeleteRecord(record);
                }}
                onRetry={history.refresh}
                onResetFilters={handleReset}
                onPrev={handlePrev}
                onNext={handleNext}
              />

              <AdminDetailPanel
                detailId={history.detailId}
                detail={history.detail}
                loading={history.detailLoading}
                error={history.detailError}
                pendingDelete={history.pending === 'delete' && history.pendingId === history.detailId}
                onClose={history.closeDetail}
                onRetry={history.retryDetail}
                onDelete={() => {
                  if (history.detail) {
                    void handleDeleteRecord(history.detail);
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <div
            className="admin-tab-panel"
            id="admin-panel-championship"
            role="tabpanel"
            aria-labelledby="admin-tab-championship"
          >
            <section className="panel admin-hero admin-hero--archive" aria-label="锦标赛档案">
              <h2 className="admin-hero__title">锦标赛档案</h2>

              <div className="admin-hero__actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--compact"
                  onClick={archives.refresh}
                  disabled={archives.loading}
                >
                  {archives.loading ? (
                    <>
                      <Spinner />
                      读取中…
                    </>
                  ) : (
                    '刷新档案'
                  )}
                </button>
              </div>
            </section>

            {archives.selectedId && (
              <button
                type="button"
                className="admin-detail-backdrop"
                onClick={archives.closeArchive}
                aria-label="关闭锦标赛档案详情"
              />
            )}

            <div className="admin-champ-workspace">
              <AdminChampionshipList
                data={archives.data}
                loading={archives.loading}
                error={archives.listError}
                selectedId={archives.selectedId}
                onSelect={archives.openArchive}
                onRetry={archives.refresh}
                onRefresh={archives.refresh}
              />

              <AdminChampionshipDetail
                archiveId={archives.selectedId}
                archive={archives.detail}
                loading={archives.detailLoading}
                error={archives.detailError}
                onClose={archives.closeArchive}
                onRetry={archives.retryDetail}
              />
            </div>
          </div>
        )}
      </main>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {ariaSummary}
      </p>
    </div>
  );
}
