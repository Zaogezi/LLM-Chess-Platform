import { useEffect, useMemo, useState } from 'react';
import type {
  ChampionshipPhase,
  ModelProfileView,
  QualifierGroupId,
  QualifierStartRequest,
} from '../shared/protocol';
import {
  CHAMPIONSHIP_DEFAULT_CONCURRENCY,
  CHAMPIONSHIP_QUALIFIER_GROUPS,
  DEFAULT_THINKING_LEVEL,
  DEFAULT_THINKING_LEVELS,
} from '../shared/protocol';
import { useChampionship } from './hooks/useChampionship';
import { useQualifier } from './hooks/useQualifier';
import { useModelProfiles } from './hooks/useModelProfiles';
import type { PresetKey } from './presets';
import type {
  ChampionshipDraft,
  ChampionshipDraw,
  ChampionshipValidation,
} from './lib/championship';
import {
  applyPresetToChampionshipDraft,
  applyProfileToChampionshipDraft,
  buildChampionshipGroupPreview,
  buildChampionshipSeriesPreview,
  championshipAriaSummary,
  championshipDrawFromState,
  championshipErrorCount,
  championshipPoolLabel,
  composeDrawDrafts,
  createChampionshipDraw,
  createDefaultChampionshipDrafts,
  draftsForQualifierGroup,
  fillBlankSeatsWithProfiles,
  fillChampionshipPoolWithProfiles,
  fillChampionshipQualifierGroupWithProfiles,
  qualifiedDraftsFromState,
  qualifierDrafts,
  seededDrafts,
  toChampionshipStartRequest,
  updateChampionshipDraft,
  validateChampionshipDrafts,
} from './lib/championship';
import {
  qualifierAriaSummary,
  qualifierQualifiedNames,
} from './lib/qualifier';
import type { TournamentModelDraft } from './lib/tournament';
import {
  draftToModelRequest,
  normalizeModelName,
} from './lib/tournament';
import { FixedNav } from './components/FixedNav';
import { ChampionshipHeader } from './components/championship/ChampionshipHeader';
import { ChampionshipHero } from './components/championship/ChampionshipHero';
import { ChampionshipSetup } from './components/championship/ChampionshipSetup';
import { ChampionshipDrawBoard } from './components/championship/ChampionshipDrawBoard';
import { ChampionshipGroups } from './components/championship/ChampionshipGroups';
import { ChampionshipBracket } from './components/championship/ChampionshipBracket';
import { ChampionPlaque } from './components/championship/ChampionPlaque';
import { QualifierBoard } from './components/championship/QualifierBoard';
import { QualifierSetup } from './components/championship/QualifierSetup';

const FOCUS_FIELD_ORDER = ['profile', 'name', 'baseUrl', 'model', 'provider'] as const;

function emptyValidation(): ChampionshipValidation {
  return { ok: true, draftErrors: {}, formErrors: [] };
}

export default function ChampionshipApp() {
  const championship = useChampionship();
  const qualifier = useQualifier();
  const library = useModelProfiles();
  const state = championship.state;
  const qualifierState = qualifier.state;
  const phase: ChampionshipPhase = state?.phase ?? 'idle';
  const running = phase === 'running';
  const qualifierRunning = qualifierState?.phase === 'running';
  const qualifierFinished = qualifierState?.phase === 'finished';
  const resumeVisible = Boolean(state?.resumable) && !running;

  const [drafts, setDrafts] = useState<ChampionshipDraft[]>(createDefaultChampionshipDrafts);
  const [activePool, setActivePool] = useState(1);
  const [concurrency, setConcurrency] = useState(CHAMPIONSHIP_DEFAULT_CONCURRENCY);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [draw, setDraw] = useState<ChampionshipDraw | null>(null);
  const [validation, setValidation] = useState<ChampionshipValidation>(emptyValidation);
  const [notice, setNotice] = useState<string | null>(null);
  const [reconfiguring, setReconfiguring] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '锦标赛 · 楚河论弈';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const setupVisible = phase === 'idle' || reconfiguring;
  const serverDraw = useMemo(() => championshipDrawFromState(state), [state]);
  // While configuring a new edition the local draw is authoritative; while a
  // run is live the server snapshot is.
  const displayDraw = setupVisible ? draw : serverDraw;

  // The qualifier maps its four winners back onto the ten qualifying seats.
  // A null result while the qualifier finished means the roster changed.
  const qualifiedDrafts = useMemo(
    () => qualifiedDraftsFromState(drafts, qualifierState),
    [drafts, qualifierState],
  );
  const qualifiedIds = useMemo(() => {
    const names = new Set(
      qualifierQualifiedNames(qualifierState).map(normalizeModelName),
    );
    return new Set(
      drafts
        .filter(
          (draft) =>
            draft.qualifierGroup !== null &&
            names.has(normalizeModelName(draft.name)),
        )
        .map((draft) => draft.id),
    );
  }, [drafts, qualifierState]);
  const rosterStale = qualifierFinished && qualifiedDrafts === null;
  const composedDrafts = useMemo(
    () => (qualifiedDrafts ? composeDrawDrafts(drafts, qualifiedDrafts) : []),
    [drafts, qualifiedDrafts],
  );
  const qualifiedSignature =
    qualifiedDrafts?.map((draft) => draft.id).join('|') ?? '';

  useEffect(() => {
    // A fresh qualifying result invalidates the previous draw.
    setDraw(null);
  }, [qualifiedSignature]);

  // The server only returns groups/series after start. Before that, render the
  // drawn groups and the seven bracket slots so the standings table and the
  // knockout diagram are visible as soon as the draw is complete.
  const groupPreview = useMemo(
    () => buildChampionshipGroupPreview(composedDrafts, draw),
    [composedDrafts, draw],
  );
  const seriesPreview = useMemo(() => buildChampionshipSeriesPreview(), []);
  const hasServerGroups = Boolean(state && state.groups.length > 0);
  const hasServerSeries = Boolean(state && state.series.length > 0);
  const displayEntrants = hasServerGroups ? state!.entrants : groupPreview.entrants;
  const displayGroups = hasServerGroups ? state!.groups : groupPreview.groups;
  const displaySeries = hasServerSeries ? state!.series : seriesPreview;
  const showingPreview = !hasServerGroups;

  const liveValidation = useMemo(
    () => validateChampionshipDrafts(drafts, library.profiles),
    [drafts, library.profiles],
  );

  const canStart = liveValidation.ok && draw !== null && qualifiedDrafts !== null && state !== null;
  const startBlockedReason = useMemo(() => {
    if (state === null) {
      return '锦标赛服务尚未就绪，请先重新连接。';
    }
    if (qualifierState === null) {
      return '入围赛服务尚未就绪，请稍后重试。';
    }
    if (qualifierRunning) {
      return '入围赛进行中，两组完成后才能抽签。';
    }
    if (!qualifiedDrafts) {
      if (rosterStale) {
        return '入围赛名单已变化，请重新发起入围赛后再抽签。';
      }
      return '请先在四号种子池完成入围赛（10 位模型分两组单循环）。';
    }
    if (!liveValidation.ok) {
      const count = championshipErrorCount(liveValidation);
      return count > 0
        ? `还有 ${count} 处配置或席位待修正，修正后才能抽签与开赛。`
        : '十六强席位尚未就绪，请检查配置。';
    }
    if (!draw) {
      return '请先点「随机抽签」完成分组，抽签后才能开赛。';
    }
    return null;
  }, [state, qualifierState, qualifierRunning, qualifiedDrafts, rosterStale, liveValidation, draw]);

  const summary = useMemo(
    () =>
      `${championshipAriaSummary(state, championship.loadError)} ${qualifierAriaSummary(
        qualifierState,
        qualifier.loadError,
      )}`,
    [state, championship.loadError, qualifierState, qualifier.loadError],
  );

  const expandSeats = (ids: readonly string[]) => {
    if (ids.length === 0) {
      return;
    }
    setExpandedIds((previous) => {
      const next = new Set(previous);
      for (const id of ids) {
        next.add(id);
      }
      return next;
    });
  };

  const revealInvalidSeats = (result: ChampionshipValidation) => {
    const invalid = drafts.filter((draft) => result.draftErrors[draft.id]);
    if (invalid.length === 0) {
      return;
    }
    expandSeats(invalid.slice(0, 3).map((draft) => draft.id));
    const first = invalid[0]!;
    setActivePool(first.seedPool);
    const errors = result.draftErrors[first.id]!;
    const field = FOCUS_FIELD_ORDER.find((candidate) => errors[candidate]);
    if (field) {
      window.requestAnimationFrame(() => {
        document.getElementById(`${first.id}-${field}`)?.focus();
      });
    }
  };

  const clearDraftError = (id: string) => {
    setValidation((previous) => {
      if (!previous.draftErrors[id]) {
        return previous;
      }
      const draftErrors = { ...previous.draftErrors };
      delete draftErrors[id];
      return {
        ok: previous.formErrors.length === 0 && Object.keys(draftErrors).length === 0,
        draftErrors,
        formErrors: previous.formErrors,
      };
    });
  };

  const resetDraw = () => {
    setDraw(null);
    setNotice(null);
  };

  const updateDraft = (id: string, patch: Partial<TournamentModelDraft>) => {
    setDrafts((previous) =>
      previous.map((draft) => {
        if (draft.id !== id) {
          return draft;
        }
        const endpointChanged =
          patch.provider !== undefined ||
          patch.baseUrl !== undefined ||
          patch.model !== undefined;
        const applied: Partial<TournamentModelDraft> = endpointChanged
          ? {
              ...patch,
              thinkingLevel: DEFAULT_THINKING_LEVEL,
              thinkingOptions: [...DEFAULT_THINKING_LEVELS],
            }
          : patch;
        return updateChampionshipDraft(draft, applied);
      }),
    );
    clearDraftError(id);
    resetDraw();
  };

  const applyDraftPreset = (id: string, preset: PresetKey) => {
    setDrafts((previous) =>
      previous.map((draft) =>
        draft.id === id ? applyPresetToChampionshipDraft(draft, preset) : draft,
      ),
    );
    clearDraftError(id);
    resetDraw();
  };

  const applyDraftProfile = (id: string, profileId: string | null) => {
    if (!profileId) {
      setDrafts((previous) =>
        previous.map((draft) =>
          draft.id === id ? updateChampionshipDraft(draft, { profileId: null }) : draft,
        ),
      );
      clearDraftError(id);
      resetDraw();
      return;
    }

    const profile = library.profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }

    setDrafts((previous) =>
      previous.map((draft) =>
        draft.id === id ? applyProfileToChampionshipDraft(draft, profile, previous) : draft,
      ),
    );
    clearDraftError(id);
    resetDraw();
  };

  const toggleDraft = (id: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleFillProfiles = () => {
    if (library.profiles.length === 0) {
      setNotice('模型库暂无已保存配置，请先到模型库保存常用模型，再填充空位。');
      return;
    }
    const result = fillBlankSeatsWithProfiles(drafts, library.profiles);
    if (result.filled === 0) {
      setNotice('当前没有空位可填充；清空某个席位的名称或接口后再试。');
      return;
    }
    setDrafts(result.drafts);
    setValidation(emptyValidation());
    resetDraw();
    setNotice(`已用模型库填充 ${result.filled} 个空位。`);
  };

  const handleQuickFillPool = (pool: number, profiles: readonly ModelProfileView[]) => {
    try {
      setDrafts(fillChampionshipPoolWithProfiles(drafts, pool, profiles));
      setValidation(emptyValidation());
      resetDraw();
      setNotice(`已将 ${profiles.length} 个模型填入${championshipPoolLabel(pool)}。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '快速填充失败，请稍后重试。');
    }
  };

  const handleQuickFillQualifierGroup = (
    group: QualifierGroupId,
    profiles: readonly ModelProfileView[],
  ) => {
    try {
      setDrafts(fillChampionshipQualifierGroupWithProfiles(drafts, group, profiles));
      setValidation(emptyValidation());
      resetDraw();
      setNotice(`已将 ${profiles.length} 个模型填入入围赛 ${group} 组。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '快速填充失败，请稍后重试。');
    }
  };

  const handleQualifierStart = async () => {
    const result = validateChampionshipDrafts(drafts, library.profiles);
    setValidation(result);
    setNotice(null);
    if (!result.ok) {
      revealInvalidSeats(result);
      return;
    }

    const request: QualifierStartRequest = {
      entrants: qualifierDrafts(drafts).map(draftToModelRequest),
      groups: CHAMPIONSHIP_QUALIFIER_GROUPS.map((group) => ({
        id: group,
        entrantNames: draftsForQualifierGroup(drafts, group).map((draft) =>
          draft.name.trim(),
        ),
      })),
      concurrency,
    };
    const started = await qualifier.start(request);
    if (started) {
      setDraw(null);
      setNotice(null);
    }
  };

  const handleDraw = () => {
    const result = validateChampionshipDrafts(drafts, library.profiles);
    setValidation(result);
    setNotice(null);
    if (!result.ok) {
      revealInvalidSeats(result);
      return;
    }
    if (!qualifiedDrafts) {
      setNotice('请先完成入围赛，四号种子池产生后才能抽签。');
      setActivePool(4);
      return;
    }
    try {
      setDraw(createChampionshipDraw(composedDrafts));
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '抽签失败，请重试。');
    }
  };

  const handleStart = async () => {
    const result = validateChampionshipDrafts(drafts, library.profiles);
    setValidation(result);
    if (!result.ok) {
      revealInvalidSeats(result);
      return;
    }
    if (!qualifiedDrafts) {
      setNotice('请先完成入围赛，四号种子池产生后才能抽签与开赛。');
      setActivePool(4);
      return;
    }
    if (!draw) {
      setNotice('请先完成随机抽签后再开赛。');
      return;
    }
    const started = await championship.start({
      ...toChampionshipStartRequest(composedDrafts, draw),
      concurrency,
    });
    if (started) {
      setReconfiguring(false);
      setNotice(null);
    }
  };

  const handleResume = async () => {
    const resumed = await championship.resume();
    if (resumed) {
      setReconfiguring(false);
      setNotice(null);
    }
  };

  const handleReconfigure = () => {
    if (reconfiguring) {
      setReconfiguring(false);
      return;
    }
    setReconfiguring(true);
    setDraw(null);
    setValidation(emptyValidation());
    setNotice(null);
    setActivePool(1);
  };

  const drawDisabledReason = useMemo(() => {
    if (qualifierState === null) {
      return '入围赛服务尚未就绪，暂不能抽签。';
    }
    if (qualifierRunning) {
      return '入围赛进行中，结束后才能抽签。';
    }
    if (!qualifiedDrafts) {
      return rosterStale
        ? '入围赛名单已变化，请重新发起入围赛。'
        : '请先完成入围赛，前二晋级后填满四号种子池。';
    }
    if (!liveValidation.ok) {
      return '还有席位配置或种子池未通过校验，请先修正再抽签。';
    }
    return null;
  }, [qualifierState, qualifierRunning, qualifiedDrafts, rosterStale, liveValidation.ok]);

  const canDraw =
    setupVisible &&
    !running &&
    !qualifierRunning &&
    liveValidation.ok &&
    qualifiedDrafts !== null;

  return (
    <div className="app tournament-app championship-app">
      <FixedNav current="championship" />
      <ChampionshipHeader phase={phase} connection={championship.connection} />

      <main className="championship-main">
        <ChampionshipHero
          phase={phase}
          state={state}
          qualifierState={qualifierState}
          concurrency={
            state && state.phase !== 'idle' ? state.concurrency : concurrency
          }
          pending={championship.pending}
          loadError={championship.loadError}
          actionError={championship.actionError}
          canStart={canStart}
          startBlockedReason={startBlockedReason}
          startVisible={setupVisible}
          stopVisible={running}
          resumeVisible={resumeVisible}
          reconfiguring={reconfiguring}
          reconfigureVisible={!running && phase !== 'idle'}
          onStart={() => {
            void handleStart();
          }}
          onStop={() => {
            void championship.stop();
          }}
          onResume={() => {
            void handleResume();
          }}
          onReconfigure={handleReconfigure}
          onDismissError={championship.dismissActionError}
          onRetryLoad={() => {
            void championship.reload();
          }}
        />

        <div className="championship-grid">
          <div className="championship-column championship-column--setup">
            {setupVisible && (
              <ChampionshipSetup
                drafts={drafts}
                activePool={activePool}
                validation={validation}
                draw={draw}
                notice={notice}
                disabled={running || Boolean(qualifierRunning)}
                profiles={library.profiles}
                profilesLoading={library.loading}
                profilesError={library.error}
                expandedIds={expandedIds}
                concurrency={concurrency}
                qualifiedCount={qualifiedDrafts?.length ?? 0}
                qualifierPanel={
                  <QualifierSetup
                    drafts={drafts}
                    state={qualifierState}
                    pending={qualifier.pending}
                    actionError={qualifier.actionError}
                    loadError={qualifier.loadError}
                    validation={validation}
                    disabled={running}
                    profiles={library.profiles}
                    profilesLoading={library.loading}
                    profilesError={library.error}
                    expandedIds={expandedIds}
                    qualifiedIds={qualifiedIds}
                    rosterStale={rosterStale}
                    onStart={() => {
                      void handleQualifierStart();
                    }}
                    onStop={() => {
                      void qualifier.stop();
                    }}
                    onResume={() => {
                      void qualifier.resume();
                    }}
                    onDismissError={qualifier.dismissActionError}
                    onRetryLoad={() => {
                      void qualifier.reload();
                    }}
                    onToggle={toggleDraft}
                    onChange={updateDraft}
                    onPresetChange={applyDraftPreset}
                    onProfileChange={applyDraftProfile}
                    onQuickFill={handleQuickFillQualifierGroup}
                  />
                }
                onConcurrencyChange={setConcurrency}
                onPoolChange={setActivePool}
                onFillProfiles={handleFillProfiles}
                onQuickFill={handleQuickFillPool}
                onToggle={toggleDraft}
                onChange={updateDraft}
                onPresetChange={applyDraftPreset}
                onProfileChange={applyDraftProfile}
              />
            )}

            <ChampionshipDrawBoard
              draw={displayDraw}
              phase={phase}
              canDraw={canDraw}
              qualifierFinished={qualifiedDrafts !== null}
              drawDisabledReason={drawDisabledReason}
              onDraw={handleDraw}
            />
          </div>

          <div className="championship-column championship-column--results">
            <ChampionPlaque state={state} />
            <QualifierBoard state={qualifierState} />
            <ChampionshipGroups
              phase={phase}
              groups={displayGroups}
              entrants={displayEntrants}
              games={state?.games ?? []}
              currentGameIds={state?.currentGameIds ?? []}
              preview={showingPreview}
            />
            <ChampionshipBracket
              series={displaySeries}
              games={state?.games ?? []}
              currentSeriesId={state?.currentSeriesId ?? null}
              currentGameIds={state?.currentGameIds ?? []}
              preview={!hasServerSeries}
            />
          </div>
        </div>
      </main>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {summary}
      </p>
    </div>
  );
}
