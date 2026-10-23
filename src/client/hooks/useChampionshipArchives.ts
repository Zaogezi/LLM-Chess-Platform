import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChampionshipArchive,
  ChampionshipArchiveListResponse,
} from '../../shared/protocol';
import { fetchChampionshipArchive, fetchChampionshipArchives } from '../api';

export interface ChampionshipArchivesController {
  data: ChampionshipArchiveListResponse | null;
  loading: boolean;
  listError: string | null;
  selectedId: string | null;
  detail: ChampionshipArchive | null;
  detailLoading: boolean;
  detailError: string | null;
  refresh: () => void;
  openArchive: (id: string) => void;
  closeArchive: () => void;
  retryDetail: () => void;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '锦标赛档案服务暂时无法响应，请稍后重试。';
}

/**
 * Archive controller for 对局管理 → 锦标赛档案: summary list plus an on-demand
 * full snapshot (group tables + knockout bracket). Request guards keep late
 * responses from overwriting a newer selection; there is no live stream here.
 */
export function useChampionshipArchives(): ChampionshipArchivesController {
  const [data, setData] = useState<ChampionshipArchiveListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ChampionshipArchive | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const detailIdRef = useRef<string | null>(null);

  const loadList = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    setLoading(true);
    setListError(null);
    try {
      const response = await fetchChampionshipArchives();
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
    void loadList();
  }, [loadList]);

  const refresh = useCallback(() => {
    void loadList();
  }, [loadList]);

  const closeArchive = useCallback(() => {
    detailRequestRef.current += 1;
    detailIdRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
  }, []);

  const openArchive = useCallback((id: string) => {
    const requestId = ++detailRequestRef.current;
    detailIdRef.current = id;
    setSelectedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);

    void (async () => {
      try {
        const archive = await fetchChampionshipArchive(id);
        if (requestId !== detailRequestRef.current) {
          return;
        }
        setDetail(archive);
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
      openArchive(current);
    }
  }, [openArchive]);

  return {
    data,
    loading,
    listError,
    selectedId,
    detail,
    detailLoading,
    detailError,
    refresh,
    openArchive,
    closeArchive,
    retryDetail,
  };
}
