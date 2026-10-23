import { useCallback, useEffect, useRef, useState } from 'react';
import type { HistoryGameRecord, HistoryListResponse } from '../../shared/protocol';
import {
  clearHistory,
  deleteHistoryRecord,
  fetchHistoryList,
  fetchHistoryRecord,
} from '../api';
import type { HistoryFilters } from '../lib/history';
import { DEFAULT_HISTORY_FILTERS, HISTORY_PAGE_SIZE } from '../lib/history';

export type HistoryPending = 'delete' | 'clear';

export interface HistoryController {
  data: HistoryListResponse | null;
  filters: HistoryFilters;
  offset: number;
  limit: number;
  loading: boolean;
  listError: string | null;
  detailId: string | null;
  detail: HistoryGameRecord | null;
  detailLoading: boolean;
  detailError: string | null;
  pending: HistoryPending | null;
  pendingId: string | null;
  actionError: string | null;
  applyFilters: (next: HistoryFilters) => void;
  resetFilters: () => void;
  goToOffset: (nextOffset: number) => void;
  refresh: () => void;
  openDetail: (id: string) => void;
  closeDetail: () => void;
  retryDetail: () => void;
  removeRecord: (id: string) => Promise<boolean>;
  clearAll: () => Promise<boolean>;
  dismissActionError: () => void;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '历史服务暂时无法响应，请稍后重试。';
}

/**
 * Read-only archive controller: summary list + on-demand detail + guarded
 * delete/clear mutations. There is no live stream on this page.
 */
export function useHistory(): HistoryController {
  const [data, setData] = useState<HistoryListResponse | null>(null);
  const [filters, setFilters] = useState<HistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<HistoryGameRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [pending, setPending] = useState<HistoryPending | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const filtersRef = useRef<HistoryFilters>(DEFAULT_HISTORY_FILTERS);
  const offsetRef = useRef(0);
  const pendingRef = useRef<HistoryPending | null>(null);
  const detailIdRef = useRef<string | null>(null);

  const loadList = useCallback(async (nextFilters: HistoryFilters, nextOffset: number) => {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setListError(null);

    try {
      const response = await fetchHistoryList({
        limit: HISTORY_PAGE_SIZE,
        offset: nextOffset,
        mode: nextFilters.mode,
        status: nextFilters.status,
        q: nextFilters.q,
      });
      if (requestId !== listRequestRef.current) {
        return;
      }
      setData(response);
    } catch (error) {
      if (requestId !== listRequestRef.current) {
        return;
      }
      setListError(messageOf(error));
    } finally {
      if (requestId === listRequestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadList(DEFAULT_HISTORY_FILTERS, 0);
  }, [loadList]);

  const applyFilters = useCallback(
    (next: HistoryFilters) => {
      const normalized: HistoryFilters = {
        q: next.q.trim(),
        mode: next.mode,
        status: next.status,
      };
      filtersRef.current = normalized;
      offsetRef.current = 0;
      setFilters(normalized);
      setOffset(0);
      void loadList(normalized, 0);
    },
    [loadList],
  );

  const resetFilters = useCallback(() => {
    applyFilters(DEFAULT_HISTORY_FILTERS);
  }, [applyFilters]);

  const goToOffset = useCallback(
    (nextOffset: number) => {
      const safeOffset = Math.max(0, Math.floor(nextOffset));
      offsetRef.current = safeOffset;
      setOffset(safeOffset);
      void loadList(filtersRef.current, safeOffset);
    },
    [loadList],
  );

  const refresh = useCallback(() => {
    void loadList(filtersRef.current, offsetRef.current);
  }, [loadList]);

  const closeDetail = useCallback(() => {
    detailRequestRef.current += 1;
    detailIdRef.current = null;
    setDetailId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  const openDetail = useCallback((id: string) => {
    const requestId = ++detailRequestRef.current;
    detailIdRef.current = id;
    setDetailId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    void (async () => {
      try {
        const record = await fetchHistoryRecord(id);
        if (requestId !== detailRequestRef.current) {
          return;
        }
        setDetail(record);
      } catch (error) {
        if (requestId !== detailRequestRef.current) {
          return;
        }
        setDetailError(messageOf(error));
      } finally {
        if (requestId === detailRequestRef.current) {
          setDetailLoading(false);
        }
      }
    })();
  }, []);

  const retryDetail = useCallback(() => {
    const current = detailIdRef.current;
    if (current) {
      openDetail(current);
    }
  }, [openDetail]);

  const removeRecord = useCallback(
    async (id: string): Promise<boolean> => {
      if (pendingRef.current) {
        return false;
      }

      pendingRef.current = 'delete';
      setPending('delete');
      setPendingId(id);
      setActionError(null);

      try {
        const response = await deleteHistoryRecord(id);
        if (detailIdRef.current === id) {
          closeDetail();
        }

        const total = response.total;
        const lastOffset =
          total > 0 ? Math.floor((total - 1) / HISTORY_PAGE_SIZE) * HISTORY_PAGE_SIZE : 0;
        const safeOffset = Math.min(offsetRef.current, lastOffset);
        offsetRef.current = safeOffset;
        setOffset(safeOffset);
        await loadList(filtersRef.current, safeOffset);
        return true;
      } catch (error) {
        setActionError(messageOf(error));
        return false;
      } finally {
        pendingRef.current = null;
        setPending(null);
        setPendingId(null);
      }
    },
    [closeDetail, loadList],
  );

  const clearAll = useCallback(async (): Promise<boolean> => {
    if (pendingRef.current) {
      return false;
    }

    pendingRef.current = 'clear';
    setPending('clear');
    setActionError(null);

    try {
      await clearHistory();
      closeDetail();
      offsetRef.current = 0;
      setOffset(0);
      await loadList(filtersRef.current, 0);
      return true;
    } catch (error) {
      setActionError(messageOf(error));
      return false;
    } finally {
      pendingRef.current = null;
      setPending(null);
    }
  }, [closeDetail, loadList]);

  const dismissActionError = useCallback(() => setActionError(null), []);

  return {
    data,
    filters,
    offset,
    limit: HISTORY_PAGE_SIZE,
    loading,
    listError,
    detailId,
    detail,
    detailLoading,
    detailError,
    pending,
    pendingId,
    actionError,
    applyFilters,
    resetFilters,
    goToOffset,
    refresh,
    openDetail,
    closeDetail,
    retryDetail,
    removeRecord,
    clearAll,
    dismissActionError,
  };
}
