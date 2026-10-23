import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ModelProfileCreateRequest,
  ModelProfileUpdateRequest,
  ModelProfileView,
} from '../../shared/protocol';
import {
  createModelProfile,
  deleteModelProfile,
  fetchModelProfiles,
  updateModelProfile,
} from '../api';

export type ModelProfilePending = 'create' | 'update' | 'delete';

export interface ModelProfilesController {
  profiles: ModelProfileView[];
  loading: boolean;
  error: string | null;
  pending: ModelProfilePending | null;
  pendingId: string | null;
  actionError: string | null;
  refresh: () => void;
  createProfile: (input: ModelProfileCreateRequest) => Promise<ModelProfileView | null>;
  updateProfile: (
    id: string,
    input: ModelProfileUpdateRequest,
  ) => Promise<ModelProfileView | null>;
  removeProfile: (id: string) => Promise<boolean>;
  dismissActionError: () => void;
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '模型库服务暂时无法响应，请稍后重试。';
}

/**
 * Reads the saved model library and exposes guarded CRUD mutations. The
 * selector pages use the same hook but simply ignore mutation helpers.
 */
export function useModelProfiles(): ModelProfilesController {
  const [profiles, setProfiles] = useState<ModelProfileView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ModelProfilePending | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const requestRef = useRef(0);
  const pendingRef = useRef<ModelProfilePending | null>(null);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetchModelProfiles();
      if (requestId !== requestRef.current) return;
      setProfiles(response.profiles);
    } catch (loadError) {
      if (requestId !== requestRef.current) return;
      setError(messageOf(loadError));
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleFocus = () => {
      if (pendingRef.current === null && document.visibilityState === 'visible') {
        void load();
      }
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [load]);

  const refresh = useCallback(() => {
    if (pendingRef.current !== null) return;
    void load();
  }, [load]);

  const beginPending = (kind: ModelProfilePending, id: string | null): boolean => {
    if (pendingRef.current !== null) return false;
    pendingRef.current = kind;
    setPending(kind);
    setPendingId(id);
    setActionError(null);
    return true;
  };

  const endPending = () => {
    pendingRef.current = null;
    setPending(null);
    setPendingId(null);
  };

  const createProfile = useCallback(
    async (input: ModelProfileCreateRequest): Promise<ModelProfileView | null> => {
      if (!beginPending('create', null)) return null;
      try {
        const created = await createModelProfile(input);
        setProfiles((previous) => [...previous, created]);
        setError(null);
        return created;
      } catch (mutationError) {
        setActionError(messageOf(mutationError));
        return null;
      } finally {
        endPending();
      }
    },
    [],
  );

  const updateProfile = useCallback(
    async (
      id: string,
      input: ModelProfileUpdateRequest,
    ): Promise<ModelProfileView | null> => {
      if (!beginPending('update', id)) return null;
      try {
        const updated = await updateModelProfile(id, input);
        setProfiles((previous) =>
          previous.map((profile) => (profile.id === id ? updated : profile)),
        );
        setError(null);
        return updated;
      } catch (mutationError) {
        setActionError(messageOf(mutationError));
        return null;
      } finally {
        endPending();
      }
    },
    [],
  );

  const removeProfile = useCallback(async (id: string): Promise<boolean> => {
    if (!beginPending('delete', id)) return false;
    try {
      await deleteModelProfile(id);
      setProfiles((previous) => previous.filter((profile) => profile.id !== id));
      setError(null);
      return true;
    } catch (mutationError) {
      setActionError(messageOf(mutationError));
      return false;
    } finally {
      endPending();
    }
  }, []);

  const dismissActionError = useCallback(() => setActionError(null), []);

  return {
    profiles,
    loading,
    error,
    pending,
    pendingId,
    actionError,
    refresh,
    createProfile,
    updateProfile,
    removeProfile,
    dismissActionError,
  };
}
