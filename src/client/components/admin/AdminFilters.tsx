import type { HistoryFilters } from '../../lib/history';
import {
  HISTORY_MODE_OPTIONS,
  HISTORY_STATUS_OPTIONS,
} from '../../lib/history';

interface AdminFiltersProps {
  draft: HistoryFilters;
  onChange: (next: HistoryFilters) => void;
  onApply: () => void;
  onReset: () => void;
  busy: boolean;
}

export function AdminFilters({
  draft,
  onChange,
  onApply,
  onReset,
  busy,
}: AdminFiltersProps) {
  return (
    <section className="admin-filters" aria-label="筛选档案">
      <form
        className="admin-filter-row"
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        <div className="field admin-filter-search">
          <label className="field__label" htmlFor="admin-search">
            关键词
          </label>
          <input
            id="admin-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            placeholder="搜索模型、结果或错误"
            value={draft.q}
            onChange={(event) => onChange({ ...draft, q: event.target.value })}
          />
        </div>

        <div className="field admin-filter-select">
          <label className="field__label" htmlFor="admin-mode">
            来源
          </label>
          <span className="select-wrap">
            <select
              id="admin-mode"
              value={draft.mode}
              onChange={(event) =>
                onChange({ ...draft, mode: event.target.value as HistoryFilters['mode'] })
              }
            >
              {HISTORY_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>
        </div>

        <div className="field admin-filter-select">
          <label className="field__label" htmlFor="admin-status">
            状态
          </label>
          <span className="select-wrap">
            <select
              id="admin-status"
              value={draft.status}
              onChange={(event) =>
                onChange({ ...draft, status: event.target.value as HistoryFilters['status'] })
              }
            >
              {HISTORY_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>
        </div>

        <div className="admin-filter-actions">
          <button type="submit" className="btn btn--primary btn--compact" disabled={busy}>
            筛选
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--compact"
            onClick={onReset}
            disabled={busy}
          >
            重置
          </button>
        </div>
      </form>
    </section>
  );
}
