import { useEffect, useMemo, useState } from 'react';
import type { TournamentPhase } from '../shared/protocol';
import {
  DEFAULT_THINKING_LEVEL,
  DEFAULT_THINKING_LEVELS,
  TOURNAMENT_MAX_MODELS,
  TOURNAMENT_MIN_MODELS,
} from '../shared/protocol';
import { useTournament } from './hooks/useTournament';
import { useModelProfiles } from './hooks/useModelProfiles';
import type { PresetKey } from './presets';
import type {
  TournamentFieldErrors,
  TournamentModelDraft,
  TournamentModelErrors,
} from './lib/tournament';
import {
  DEFAULT_GAMES_PER_PAIR,
  applyPresetToDraft,
  applyProfileToDraft,
  calculateTournamentPlan,
  createDefaultTournamentDrafts,
  createTournamentDraft,
  duplicateTournamentDraft,
  toTournamentStartRequest,
  tournamentAriaSummary,
  uniqueModelName,
  validateTournamentDrafts,
} from './lib/tournament';
import { FixedNav } from './components/FixedNav';
import { TournamentHeader } from './components/tournament/TournamentHeader';
import { TournamentHero } from './components/tournament/TournamentHero';
import { TournamentSetup } from './components/tournament/TournamentSetup';
import { TournamentRoster } from './components/tournament/TournamentRoster';
import { TournamentStandings } from './components/tournament/TournamentStandings';
import { TournamentGames } from './components/tournament/TournamentGames';

const FOCUS_FIELD_ORDER: ReadonlyArray<keyof TournamentFieldErrors> = [
  'profile',
  'name',
  'baseUrl',
  'model',
  'provider',
];

export default function TournamentApp() {
  const tournament = useTournament();
  const library = useModelProfiles();
  const state = tournament.state;
  const phase: TournamentPhase = state?.phase ?? 'idle';
  const running = phase === 'running';

  const [drafts, setDrafts] = useState<TournamentModelDraft[]>(createDefaultTournamentDrafts);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(drafts.map((draft) => draft.id)),
  );
  const [gamesPerPair, setGamesPerPair] = useState<number>(DEFAULT_GAMES_PER_PAIR);
  const [modelErrors, setModelErrors] = useState<TournamentModelErrors>({});
  const [gamesError, setGamesError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = '自动评测 · 楚河论弈';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const plan = useMemo(
    () => calculateTournamentPlan(drafts.length, gamesPerPair),
    [drafts.length, gamesPerPair],
  );
  const livePlan = useMemo(
    () =>
      state ? calculateTournamentPlan(state.models.length, state.gamesPerPair) : plan,
    [plan, state],
  );

  const summary = useMemo(
    () => tournamentAriaSummary(state, plan, tournament.loadError),
    [plan, state, tournament.loadError],
  );

  const clearDraftError = (id: string) => {
    setModelErrors((previous) => {
      if (!previous[id]) {
        return previous;
      }
      const next = { ...previous };
      delete next[id];
      return next;
    });
  };

  const updateDraft = (id: string, patch: Partial<TournamentModelDraft>) => {
    setDrafts((previous) =>
      previous.map((draft) => {
        if (draft.id !== id) return draft;
        const endpointChanged =
          patch.provider !== undefined ||
          patch.baseUrl !== undefined ||
          patch.model !== undefined;
        return endpointChanged
          ? {
              ...draft,
              ...patch,
              thinkingLevel: DEFAULT_THINKING_LEVEL,
              thinkingOptions: [...DEFAULT_THINKING_LEVELS],
            }
          : { ...draft, ...patch };
      }),
    );
    clearDraftError(id);
  };

  const applyDraftPreset = (id: string, preset: PresetKey) => {
    setDrafts((previous) =>
      previous.map((draft) =>
        draft.id === id ? applyPresetToDraft(draft, preset) : draft,
      ),
    );
    clearDraftError(id);
  };

  const applyDraftProfile = (id: string, profileId: string | null) => {
    if (!profileId) {
      setDrafts((previous) =>
        previous.map((draft) => (draft.id === id ? { ...draft, profileId: null } : draft)),
      );
      clearDraftError(id);
      return;
    }
    const profile = library.profiles.find((item) => item.id === profileId);
    if (!profile) {
      return;
    }
    setDrafts((previous) =>
      previous.map((draft) =>
        draft.id === id ? applyProfileToDraft(draft, profile, previous) : draft,
      ),
    );
    clearDraftError(id);
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

  const expandDrafts = (ids: readonly string[]) => {
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

  const handleAddModel = () => {
    if (drafts.length >= TOURNAMENT_MAX_MODELS) {
      return;
    }
    const draft = createTournamentDraft('custom', uniqueModelName('新模型', drafts));
    setDrafts((previous) => [...previous, draft]);
    setExpandedIds((previous) => new Set(previous).add(draft.id));
    setFormError(null);
  };

  const handleDuplicateModel = (id: string) => {
    if (drafts.length >= TOURNAMENT_MAX_MODELS) {
      return;
    }
    const source = drafts.find((draft) => draft.id === id);
    if (!source) {
      return;
    }
    const copy = duplicateTournamentDraft(source, drafts);
    setDrafts((previous) => [...previous, copy]);
    setExpandedIds((previous) => new Set(previous).add(copy.id));
    setFormError(null);
  };

  const handleRemoveModel = (id: string) => {
    if (drafts.length <= TOURNAMENT_MIN_MODELS) {
      return;
    }
    setDrafts((previous) => previous.filter((draft) => draft.id !== id));
    setExpandedIds((previous) => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    clearDraftError(id);
    setFormError(null);
  };

  const handleGamesChange = (value: number) => {
    setGamesPerPair(Number.isFinite(value) ? value : 0);
    setGamesError(null);
  };

  const handleStart = async () => {
    const validation = validateTournamentDrafts(drafts, gamesPerPair, library.profiles);
    setModelErrors(validation.modelErrors);
    setGamesError(validation.gamesError);
    setFormError(validation.formError);

    if (!validation.ok) {
      const invalidDrafts = drafts.filter((draft) => validation.modelErrors[draft.id]);
      expandDrafts(invalidDrafts.map((draft) => draft.id));

      const firstInvalid = invalidDrafts[0];
      if (firstInvalid) {
        const errors = validation.modelErrors[firstInvalid.id];
        const field = FOCUS_FIELD_ORDER.find((candidate) => errors[candidate]);
        if (field) {
          window.requestAnimationFrame(() => {
            document.getElementById(`${firstInvalid.id}-${field}`)?.focus();
          });
          return;
        }
      }

      if (validation.gamesError) {
        window.requestAnimationFrame(() => {
          document.getElementById('tourney-games-per-pair')?.focus();
        });
      }
      return;
    }

    await tournament.start(toTournamentStartRequest(drafts, gamesPerPair));
  };

  const canAddModel = drafts.length < TOURNAMENT_MAX_MODELS;
  const hasTournament = state !== null && state.phase !== 'idle';

  return (
    <div className={`app tournament-app${hasTournament ? ' tournament-app--active' : ''}`}>
      <FixedNav current="tournament" />
      <TournamentHeader phase={phase} connection={tournament.connection} />

      <main className="tournament-main">
        <TournamentHero
          phase={phase}
          state={state}
          plan={plan}
          pending={tournament.pending}
          loadError={tournament.loadError}
          actionError={tournament.actionError}
          onStart={() => {
            void handleStart();
          }}
          onStop={() => {
            void tournament.stop();
          }}
          onDismissError={tournament.dismissActionError}
          onRetryLoad={() => {
            void tournament.reload();
          }}
        />

        <div className="tournament-grid">
          <div className="tournament-column tournament-column--setup">
            {running && state ? (
              <TournamentRoster
                models={state.models}
                gamesPerPair={state.gamesPerPair}
                plan={livePlan}
                phase={phase}
              />
            ) : (
              <>
                {state && phase !== 'idle' && state.models.length > 0 && (
                  <TournamentRoster
                    models={state.models}
                    gamesPerPair={state.gamesPerPair}
                    plan={calculateTournamentPlan(state.models.length, state.gamesPerPair)}
                    phase={phase}
                  />
                )}
                <TournamentSetup
                  drafts={drafts}
                  modelErrors={modelErrors}
                  gamesPerPair={gamesPerPair}
                  gamesError={gamesError}
                  formError={formError}
                  disabled={running}
                  plan={plan}
                  expandedIds={expandedIds}
                  canAdd={canAddModel}
                  profiles={library.profiles}
                  profilesLoading={library.loading}
                  profilesError={library.error}
                  onAdd={handleAddModel}
                  onDuplicate={handleDuplicateModel}
                  onRemove={handleRemoveModel}
                  onToggle={toggleDraft}
                  onChange={updateDraft}
                  onPresetChange={applyDraftPreset}
                  onProfileChange={applyDraftProfile}
                  onGamesChange={handleGamesChange}
                />
              </>
            )}
          </div>

          <div className="tournament-column tournament-column--results">
            <TournamentStandings
              models={state?.models ?? []}
              standings={state?.standings ?? []}
            />
            <TournamentGames state={state} />
          </div>
        </div>
      </main>

      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {summary}
      </p>
    </div>
  );
}
