import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  GameSettings,
  GameSideRequest,
  ModelProfileView,
  ModelView,
  Phase,
  Side,
  StartGameRequest,
} from '../shared/protocol';
import {
  DEFAULT_SETTINGS,
  DEFAULT_THINKING_LEVEL,
  DEFAULT_THINKING_LEVELS,
} from '../shared/protocol';
import { useArena } from './hooks/useArena';
import { useModelProfiles } from './hooks/useModelProfiles';
import { Board, BoardPlaceholder } from './components/Board';
import { ControlPanel } from './components/ControlPanel';
import { ErrorBanner } from './components/ErrorBanner';
import { FixedNav } from './components/FixedNav';
import { ModelCard } from './components/ModelCard';
import { MoveSheet } from './components/MoveSheet';
import { PlayerPlaque } from './components/PlayerPlaque';
import { ResultBanner } from './components/ResultBanner';
import { StatusStrip } from './components/StatusStrip';
import { TopBar } from './components/TopBar';
import type {
  ModelConfigErrors,
  ModelConfigForm,
  PresetKey,
} from './presets';
import {
  DEFAULT_PRESET_BY_SIDE,
  createModelConfig,
  presetByKey,
  toModelSetup,
  validateModelConfig,
} from './presets';
import { applyProfileToGameForm } from './lib/profiles';
import { PHASE_LABELS, turnHeadline } from './lib/format';
import { SIDE_LABEL } from './lib/chess';

const EMPTY_ERRORS: Record<Side, ModelConfigErrors> = { red: {}, black: {} };
const EMPTY_SELECTIONS: Record<Side, string | null> = { red: null, black: null };
const EMPTY_PROFILE_ERRORS: Record<Side, string | null> = { red: null, black: null };

function configDisplayName(
  form: ModelConfigForm,
  selectedProfile: ModelProfileView | null,
): string {
  return selectedProfile?.name || form.model.trim() || presetByKey(form.preset).label;
}

export default function App() {
  const arena = useArena();
  const library = useModelProfiles();
  const state = arena.state;
  const phase: Phase = state?.phase ?? 'idle';
  const isActive = phase === 'running' || phase === 'paused' || phase === 'error';
  const hasMatch = phase !== 'idle';

  const [forms, setForms] = useState<Record<Side, ModelConfigForm>>(() => ({
    red: createModelConfig(DEFAULT_PRESET_BY_SIDE.red),
    black: createModelConfig(DEFAULT_PRESET_BY_SIDE.black),
  }));
  const [formErrors, setFormErrors] =
    useState<Record<Side, ModelConfigErrors>>(EMPTY_ERRORS);
  const [profileIds, setProfileIds] =
    useState<Record<Side, string | null>>(EMPTY_SELECTIONS);
  const [profileErrors, setProfileErrors] =
    useState<Record<Side, string | null>>(EMPTY_PROFILE_ERRORS);
  const [settings, setSettings] = useState<GameSettings>({ ...DEFAULT_SETTINGS });
  const settingsTouchedRef = useRef(false);

  const serverMoveDelay = state?.settings.moveDelayMs;
  const serverMaxAttempts = state?.settings.maxAttempts;

  useEffect(() => {
    if (serverMoveDelay === undefined || serverMaxAttempts === undefined) {
      return;
    }
    if (settingsTouchedRef.current) {
      return;
    }
    if (phase !== 'idle' && phase !== 'finished') {
      return;
    }

    setSettings((previous) =>
      previous.moveDelayMs === serverMoveDelay && previous.maxAttempts === serverMaxAttempts
        ? previous
        : { moveDelayMs: serverMoveDelay, maxAttempts: serverMaxAttempts },
    );
  }, [phase, serverMaxAttempts, serverMoveDelay]);

  useEffect(() => {
    if (library.loading || library.error) return;
    setProfileIds((previous) => {
      const next: Record<Side, string | null> = { ...previous };
      let changed = false;
      for (const side of ['red', 'black'] as const) {
        const id = previous[side];
        if (id && !library.profiles.some((profile) => profile.id === id)) {
          next[side] = null;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [library.error, library.loading, library.profiles]);

  const selectedProfiles: Record<Side, ModelProfileView | null> = {
    red: library.profiles.find((profile) => profile.id === profileIds.red) ?? null,
    black: library.profiles.find((profile) => profile.id === profileIds.black) ?? null,
  };

  const updateForm = (side: Side, patch: Partial<ModelConfigForm>) => {
    setForms((previous) => {
      const current = previous[side];
      const endpointChanged =
        patch.provider !== undefined || patch.baseUrl !== undefined || patch.model !== undefined;
      const next = endpointChanged
        ? {
            ...current,
            ...patch,
            thinkingLevel: DEFAULT_THINKING_LEVEL,
            thinkingOptions: [...DEFAULT_THINKING_LEVELS],
          }
        : { ...current, ...patch };
      return { ...previous, [side]: next };
    });
    setFormErrors((previous) => {
      if (Object.keys(previous[side]).length === 0) {
        return previous;
      }
      return { ...previous, [side]: {} };
    });
  };

  const selectProfile = (side: Side, profileId: string | null) => {
    setProfileErrors((previous) => ({ ...previous, [side]: null }));
    if (!profileId) {
      setProfileIds((previous) => ({ ...previous, [side]: null }));
      return;
    }
    const profile = library.profiles.find((item) => item.id === profileId);
    if (!profile) {
      setProfileErrors((previous) => ({
        ...previous,
        [side]: '所选模型已不存在，请刷新模型库后重试。',
      }));
      return;
    }
    setForms((previous) => ({
      ...previous,
      [side]: applyProfileToGameForm(previous[side], profile),
    }));
    setProfileIds((previous) => ({ ...previous, [side]: profile.id }));
    setFormErrors((previous) => ({ ...previous, [side]: {} }));
  };

  const applyPreset = (side: Side, presetKey: PresetKey) => {
    const preset = presetByKey(presetKey);
    setForms((previous) => ({
      ...previous,
      [side]: {
        ...previous[side],
        preset: preset.key,
        provider: preset.provider,
        baseUrl: preset.baseUrl,
        model: preset.model,
        thinkingLevel: DEFAULT_THINKING_LEVEL,
        thinkingOptions: [...DEFAULT_THINKING_LEVELS],
      },
    }));
    setFormErrors((previous) => ({ ...previous, [side]: {} }));
  };

  const handleStart = async () => {
    if (!state) {
      return;
    }

    const nextFormErrors: Record<Side, ModelConfigErrors> = { red: {}, black: {} };
    const nextProfileErrors: Record<Side, string | null> = { red: null, black: null };
    const sideRequests: Record<Side, GameSideRequest | null> = { red: null, black: null };
    let missingProfileSide: Side | null = null;

    for (const side of ['red', 'black'] as const) {
      const profileId = profileIds[side];
      if (profileId) {
        const profile = library.profiles.find((item) => item.id === profileId);
        if (!profile) {
          nextProfileErrors[side] = '所选模型已不存在，请刷新模型库后重新选择。';
          missingProfileSide = missingProfileSide ?? side;
          continue;
        }
        sideRequests[side] = {
          profileId: profile.id,
          thinkingLevel: forms[side].thinkingLevel,
          apiReasoning: forms[side].apiReasoning,
        };
        continue;
      }

      const errors = validateModelConfig(forms[side]);
      nextFormErrors[side] = errors;
      sideRequests[side] = toModelSetup(forms[side]);
    }

    setFormErrors(nextFormErrors);
    setProfileErrors(nextProfileErrors);

    if (missingProfileSide) {
      library.refresh();
      window.requestAnimationFrame(() => {
        document.getElementById(`${missingProfileSide}-profile`)?.focus();
      });
      return;
    }

    const invalidSide = (['red', 'black'] as const).find(
      (side) => Object.keys(nextFormErrors[side]).length > 0,
    );

    if (invalidSide) {
      const sideErrors = nextFormErrors[invalidSide];
      const firstField = (['baseUrl', 'model', 'provider'] as const).find(
        (field) => sideErrors[field],
      );
      if (firstField) {
        window.requestAnimationFrame(() => {
          document.getElementById(`${invalidSide}-${firstField}`)?.focus();
        });
      }
      return;
    }

    const request: StartGameRequest = {
      red: sideRequests.red!,
      black: sideRequests.black!,
      settings: {
        moveDelayMs: settings.moveDelayMs,
        maxAttempts: settings.maxAttempts,
      },
    };

    const started = await arena.start(request);
    if (started) {
      settingsTouchedRef.current = false;
    }
  };

  const handleReset = async () => {
    if (isActive) {
      const confirmed = window.confirm(
        '对局正在进行，重新布阵将终止本局并清空棋盘，确定继续？',
      );
      if (!confirmed) {
        return;
      }
    }
    await arena.reset();
  };

  const handleSettingsChange = (patch: Partial<GameSettings>) => {
    settingsTouchedRef.current = true;
    setSettings((previous) => {
      const next = { ...previous, ...patch };
      return {
        moveDelayMs: Math.min(5000, Math.max(0, Math.round(next.moveDelayMs))),
        maxAttempts: Math.min(5, Math.max(1, Math.round(next.maxAttempts))),
      };
    });
  };

  const liveSummary = useMemo(() => {
    if (!state) {
      return arena.loadError ? '棋局服务尚未就绪。' : '正在连接棋局服务。';
    }

    const parts: string[] = [
      PHASE_LABELS[state.phase],
      turnHeadline(state.phase, state.turn),
      `第 ${state.moveNumber} 回合，共 ${state.ply} 手`,
    ];

    if (state.moves.length > 0) {
      const last = state.moves[state.moves.length - 1];
      parts.push(`最后一手，${SIDE_LABEL[last.side]}${last.notation}`);
    }

    if (state.checked) {
      parts.push(`${SIDE_LABEL[state.turn]}正被将军`);
    }

    if (state.result) {
      parts.push(state.result.text);
    }

    return `${parts.join('，')}。`;
  }, [arena.loadError, state]);

  const redModel: ModelView | null = state?.models.red ?? null;
  const blackModel: ModelView | null = state?.models.black ?? null;

  return (
    <div className="app">
      <FixedNav current="arena" />
      <TopBar state={state} connection={arena.connection} />

      <main className="arena">
        <section className="board-column" aria-label="棋盘对局区">
          <div className="board-stack">
            <PlayerPlaque
              side="black"
              phase={phase}
              model={blackModel}
              fallbackName={configDisplayName(forms.black, selectedProfiles.black)}
              isTurn={isActive && state?.turn === 'black'}
              isWinner={phase === 'finished' && state?.result?.winner === 'black'}
              board={state?.board ?? null}
            />

            {state ? (
              <Board state={state} />
            ) : (
              <BoardPlaceholder
                loading={!arena.loadError}
                error={arena.loadError}
                onRetry={() => {
                  void arena.reload();
                }}
              />
            )}

            <PlayerPlaque
              side="red"
              phase={phase}
              model={redModel}
              fallbackName={configDisplayName(forms.red, selectedProfiles.red)}
              isTurn={isActive && state?.turn === 'red'}
              isWinner={phase === 'finished' && state?.result?.winner === 'red'}
              board={state?.board ?? null}
            />
          </div>
        </section>

        <aside className={`sidebar${hasMatch ? ' sidebar--live' : ''}`} aria-label="棋谱阁">
          <div className="sidebar-head">
            <h2>棋谱阁</h2>
            <span className="sidebar-head__meta">
              {state
                ? state.phase === 'finished'
                  ? `${state.moves.length} 手`
                  : state.ply > 0
                    ? `第 ${state.moveNumber} 回合`
                    : '待开局'
                : '连接中'}
            </span>
          </div>

          <StatusStrip state={state} />

          {phase === 'error' && state?.error && (
            <ErrorBanner
              error={state.error}
              pending={arena.pending}
              onRetry={() => {
                void arena.retry();
              }}
              onReset={() => {
                void handleReset();
              }}
            />
          )}

          {phase === 'finished' && state?.result && (
            <ResultBanner
              result={state.result}
              pending={arena.pending === 'start'}
              onRematch={() => {
                void handleStart();
              }}
            />
          )}

          <ControlPanel
            phase={phase}
            pending={arena.pending}
            settings={isActive && state ? state.settings : settings}
            settingsLocked={isActive}
            startBlocked={state === null}
            actionError={arena.actionError}
            onStart={() => {
              void handleStart();
            }}
            onPause={() => {
              void arena.pause();
            }}
            onResume={() => {
              void arena.resume();
            }}
            onRetry={() => {
              void arena.retry();
            }}
            onReset={() => {
              void handleReset();
            }}
            onSettingsChange={handleSettingsChange}
            onDismissError={arena.dismissActionError}
          />

          <MoveSheet state={state} />

          <div className="model-cards">
            <ModelCard
              side="red"
              form={forms.red}
              errors={formErrors.red}
              locked={isActive}
              collapsed={phase === 'finished'}
              serverModel={redModel}
              profiles={library.profiles}
              profilesLoading={library.loading}
              profilesError={library.error}
              selectedProfile={selectedProfiles.red}
              profileError={profileErrors.red}
              onChange={(patch) => updateForm('red', patch)}
              onPresetChange={(preset) => applyPreset('red', preset)}
              onSelectProfile={(profileId) => selectProfile('red', profileId)}
            />
            <ModelCard
              side="black"
              form={forms.black}
              errors={formErrors.black}
              locked={isActive}
              collapsed={phase === 'finished'}
              serverModel={blackModel}
              profiles={library.profiles}
              profilesLoading={library.loading}
              profilesError={library.error}
              selectedProfile={selectedProfiles.black}
              profileError={profileErrors.black}
              onChange={(patch) => updateForm('black', patch)}
              onPresetChange={(preset) => applyPreset('black', preset)}
              onSelectProfile={(profileId) => selectProfile('black', profileId)}
            />
          </div>
        </aside>
      </main>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveSummary}
      </p>
    </div>
  );
}
