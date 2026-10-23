import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelProfileView, ModelTestRequest } from '../shared/protocol';
import {
  DEFAULT_THINKING_LEVEL,
  DEFAULT_THINKING_LEVELS,
  MODEL_PROFILES_MAX,
} from '../shared/protocol';
import { testModelProfile } from './api';
import { useModelProfiles } from './hooks/useModelProfiles';
import type { PresetKey } from './presets';
import { validateModelConfig } from './presets';
import type { ProfileForm, ProfileFormErrors, ProfileTestState } from './lib/profiles';
import {
  applyProfileFormPreset,
  createProfileForm,
  profileTestErrorMessage,
  profileTestFromResponse,
  profileToForm,
  toProfileCreateRequest,
  toProfileUpdateRequest,
  validateProfileForm,
} from './lib/profiles';
import { FixedNav } from './components/FixedNav';
import { ModelLibraryHeader } from './components/models/ModelLibraryHeader';
import { ProfileCard } from './components/models/ProfileCard';
import { ProfileEditor } from './components/models/ProfileEditor';
import { Spinner } from './components/Icons';

interface EditorState {
  mode: 'create' | 'edit';
  profile: ModelProfileView | null;
}

function testErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return '测试模型可用性失败，请稍后重试。';
}

export default function ModelLibraryApp() {
  const library = useModelProfiles();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [errors, setErrors] = useState<ProfileFormErrors>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [profileTests, setProfileTests] = useState<Record<string, ProfileTestState>>({});
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editorTest, setEditorTest] = useState<ProfileTestState | null>(null);
  const editorTestRunRef = useRef(0);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '模型库 · 楚河论弈';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => {
    if (!editor || editor.mode !== 'edit' || !editor.profile) return;
    if (!library.profiles.some((profile) => profile.id === editor.profile?.id)) {
      setEditor(null);
      setForm(null);
    }
  }, [editor, library.profiles]);

  const configuredKeys = library.profiles.filter((profile) => profile.keyConfigured).length;
  const busy = library.pending !== null;
  const testBusy = testingId !== null || editorTest?.status === 'testing';

  const clearEditorTest = () => {
    editorTestRunRef.current += 1;
    setEditorTest(null);
  };

  const ariaSummary = useMemo(() => {
    if (library.error) return `模型库读取失败：${library.error}`;
    if (library.loading && library.profiles.length === 0) return '正在读取模型库。';
    return `模型库，共 ${library.profiles.length} 个模型，${configuredKeys} 个已配置密钥。`;
  }, [configuredKeys, library.error, library.loading, library.profiles.length]);

  const openCreate = () => {
    setEditor({ mode: 'create', profile: null });
    setForm(createProfileForm());
    setErrors({});
    setNotice(null);
    clearEditorTest();
  };

  const openEdit = (profile: ModelProfileView) => {
    setEditor({ mode: 'edit', profile });
    setForm(profileToForm(profile));
    setErrors({});
    setNotice(null);
    clearEditorTest();
  };

  const closeEditor = () => {
    setEditor(null);
    setForm(null);
    setErrors({});
    clearEditorTest();
  };

  const changeForm = (patch: Partial<ProfileForm>) => {
    clearEditorTest();
    setForm((previous) => {
      if (!previous) return previous;
      const endpointChanged =
        patch.provider !== undefined || patch.baseUrl !== undefined || patch.model !== undefined;
      return endpointChanged
        ? {
            ...previous,
            ...patch,
            thinkingLevel: DEFAULT_THINKING_LEVEL,
            thinkingOptions: [...DEFAULT_THINKING_LEVELS],
          }
        : { ...previous, ...patch };
    });
    setErrors((previous) => {
      if (Object.keys(previous).length === 0) return previous;
      const next = { ...previous };
      for (const key of Object.keys(patch) as Array<keyof ProfileForm>) {
        if (key === 'name' || key === 'provider' || key === 'baseUrl' || key === 'model') {
          delete next[key];
        }
      }
      return next;
    });
  };

  const changePreset = (preset: PresetKey) => {
    clearEditorTest();
    setForm((previous) => (previous ? applyProfileFormPreset(previous, preset) : previous));
    setErrors({});
  };

  const focusFirstError = (nextErrors: ProfileFormErrors) => {
    const order = ['name', 'baseUrl', 'model', 'provider'] as const;
    const field = order.find((candidate) => nextErrors[candidate]);
    if (field) {
      window.requestAnimationFrame(() => {
        document.getElementById(`profile-${field}`)?.focus();
      });
    }
  };

  const handleSave = async () => {
    if (!form || !editor || busy) return;
    const nextErrors = validateProfileForm(form);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      focusFirstError(nextErrors);
      return;
    }

    if (editor.mode === 'create') {
      const created = await library.createProfile(toProfileCreateRequest(form));
      if (created) {
        setNotice(`已保存模型「${created.name}」，可在棋盘或自动评测中直接选用。`);
        closeEditor();
      }
      return;
    }

    if (!editor.profile) return;
    const updated = await library.updateProfile(
      editor.profile.id,
      toProfileUpdateRequest(form, editor.profile.keyConfigured),
    );
    if (updated) {
      setProfileTests((previous) => {
        const next = { ...previous };
        delete next[updated.id];
        return next;
      });
      setNotice(`模型「${updated.name}」已更新。`);
      closeEditor();
    }
  };

  const handleTestProfile = async (profile: ModelProfileView) => {
    if (testBusy) return;
    setTestingId(profile.id);
    setProfileTests((previous) => ({
      ...previous,
      [profile.id]: { status: 'testing', message: '正在测试模型接口…' },
    }));
    try {
      const response = await testModelProfile({ profileId: profile.id });
      setProfileTests((previous) => ({
        ...previous,
        [profile.id]: profileTestFromResponse(response),
      }));
    } catch (error) {
      setProfileTests((previous) => ({
        ...previous,
        [profile.id]: profileTestErrorMessage(testErrorMessage(error)),
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleTestEditor = async () => {
    if (!form || !editor || busy || testBusy) return;
    const connectionErrors = validateModelConfig(form);
    if (Object.keys(connectionErrors).length > 0) {
      setErrors((previous) => ({ ...previous, ...connectionErrors }));
      setEditorTest(null);
      focusFirstError(connectionErrors);
      return;
    }

    const typedKey = form.apiKey.trim();
    const useSavedKey =
      editor.mode === 'edit' &&
      Boolean(editor.profile?.keyConfigured) &&
      !form.clearKey &&
      typedKey.length === 0;
    const request: ModelTestRequest = {
      provider: form.provider,
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      thinkingLevel: form.thinkingLevel,
      apiReasoning: form.apiReasoning,
      ...(typedKey ? { apiKey: typedKey } : {}),
      ...(useSavedKey && editor.profile ? { profileId: editor.profile.id } : {}),
    };

    const runId = editorTestRunRef.current + 1;
    editorTestRunRef.current = runId;
    setEditorTest({ status: 'testing', message: '正在测试当前表单配置…' });
    try {
      const response = await testModelProfile(request);
      if (runId !== editorTestRunRef.current) return;
      setEditorTest(profileTestFromResponse(response));
    } catch (error) {
      if (runId !== editorTestRunRef.current) return;
      setEditorTest(profileTestErrorMessage(testErrorMessage(error)));
    }
  };

  const handleDelete = async (profile: ModelProfileView) => {
    if (busy) return;
    const confirmed = window.confirm(
      `确定删除模型「${profile.name}」？已开始的对局不受影响，之后需要重新选择模型配置。`,
    );
    if (!confirmed) return;
    setNotice(null);
    const removed = await library.removeProfile(profile.id);
    if (removed) {
      setProfileTests((previous) => {
        const next = { ...previous };
        delete next[profile.id];
        return next;
      });
      setNotice(`模型「${profile.name}」已从模型库删除。`);
      if (editor?.profile?.id === profile.id) {
        closeEditor();
      }
    }
  };

  return (
    <div className="app library-app">
      <FixedNav current="models" />
      <ModelLibraryHeader />

      <main className="library-main">
        {(library.error || library.actionError) && (
          <div className="library-alert" role="alert">
            <span>{library.error ?? library.actionError}</span>
            <button
              type="button"
              className="library-alert__dismiss"
              onClick={() => {
                if (library.actionError) library.dismissActionError();
                else library.refresh();
              }}
              aria-label={library.actionError ? '关闭错误提示' : '重试读取模型库'}
            >
              {library.actionError ? '×' : '重试'}
            </button>
          </div>
        )}

        {notice && (
          <div className="library-notice" role="status">
            <span>{notice}</span>
            <button
              type="button"
              className="library-alert__dismiss"
              onClick={() => setNotice(null)}
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        )}

        <div className={`library-workspace${editor ? ' has-editor' : ''}`}>
          <section className="panel library-list-panel" aria-label="已保存模型列表">
            <div className="library-list-head">
              <h3>模型</h3>
              <span>{library.profiles.length}</span>
              <div className="library-list-actions">
                <button
                  type="button"
                  className="btn btn--secondary btn--compact"
                  onClick={library.refresh}
                  disabled={library.loading || busy}
                >
                  {library.loading ? <Spinner /> : '刷新'}
                </button>
                <button
                  type="button"
                  className="btn btn--primary btn--compact"
                  onClick={openCreate}
                  disabled={
                    library.loading ||
                    busy ||
                    testBusy ||
                    library.profiles.length >= MODEL_PROFILES_MAX
                  }
                >
                  ＋ 新增
                </button>
              </div>
            </div>

            {library.loading && library.profiles.length === 0 ? (
              <div className="library-loading" aria-live="polite">
                <Spinner />
              </div>
            ) : library.profiles.length === 0 ? (
              <div className="library-empty">
                <span className="library-empty__seal" aria-hidden="true">
                  库
                </span>
                <h3>暂无模型</h3>
                <button
                  type="button"
                  className="btn btn--primary btn--compact"
                  onClick={openCreate}
                  disabled={library.loading || busy}
                >
                  ＋ 新增
                </button>
              </div>
            ) : (
              <div className="profile-grid">
                {library.profiles.map((profile) => (
                  <ProfileCard
                    key={profile.id}
                    profile={profile}
                    selected={editor?.profile?.id === profile.id}
                    deleting={library.pending === 'delete' && library.pendingId === profile.id}
                    disabled={busy || testBusy}
                    testing={testingId === profile.id}
                    testDisabled={busy || testBusy || editor !== null}
                    testState={profileTests[profile.id] ?? null}
                    onTest={() => {
                      void handleTestProfile(profile);
                    }}
                    onEdit={() => openEdit(profile)}
                    onDelete={() => {
                      void handleDelete(profile);
                    }}
                  />
                ))}
              </div>
            )}
          </section>

          {editor && form && (
            <ProfileEditor
              mode={editor.mode}
              profile={editor.profile}
              form={form}
              errors={errors}
              busy={busy}
              testState={editorTest}
              testing={editorTest?.status === 'testing'}
              testDisabled={busy || testBusy}
              onChange={changeForm}
              onPresetChange={changePreset}
              onTest={() => {
                void handleTestEditor();
              }}
              onSave={() => {
                void handleSave();
              }}
              onCancel={closeEditor}
            />
          )}
        </div>
      </main>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {ariaSummary}
      </p>
    </div>
  );
}
