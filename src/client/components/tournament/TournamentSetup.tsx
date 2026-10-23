import type { ModelProfileView } from '../../../shared/protocol';
import {
  TOURNAMENT_MAX_GAMES_PER_PAIR,
  TOURNAMENT_MAX_MODELS,
  TOURNAMENT_MIN_MODELS,
} from '../../../shared/protocol';
import type { PresetKey } from '../../presets';
import type {
  TournamentModelDraft,
  TournamentModelErrors,
  TournamentPlan,
} from '../../lib/tournament';
import { TournamentModelCard } from './TournamentModelCard';

interface TournamentSetupProps {
  drafts: TournamentModelDraft[];
  modelErrors: TournamentModelErrors;
  gamesPerPair: number;
  gamesError: string | null;
  formError: string | null;
  disabled: boolean;
  plan: TournamentPlan;
  expandedIds: ReadonlySet<string>;
  canAdd: boolean;
  profiles: ModelProfileView[];
  profilesLoading: boolean;
  profilesError: string | null;
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string) => void;
  onChange: (id: string, patch: Partial<TournamentModelDraft>) => void;
  onPresetChange: (id: string, preset: PresetKey) => void;
  onProfileChange: (id: string, profileId: string | null) => void;
  onGamesChange: (value: number) => void;
}

export function TournamentSetup({
  drafts,
  modelErrors,
  gamesPerPair,
  gamesError,
  formError,
  disabled,
  plan,
  expandedIds,
  canAdd,
  profiles,
  profilesLoading,
  profilesError,
  onAdd,
  onDuplicate,
  onRemove,
  onToggle,
  onChange,
  onPresetChange,
  onProfileChange,
  onGamesChange,
}: TournamentSetupProps) {
  return (
    <section className="panel tournament-setup" aria-label="参赛模型配置">
      <div className="panel__head">
        <h2 className="panel__title">阵容</h2>
        <span className="panel__meta">
          {drafts.length} / {TOURNAMENT_MAX_MODELS}
        </span>
      </div>

      {formError && (
        <p className="tourney-form-error" role="alert">
          {formError}
        </p>
      )}

      <div className="tourney-model-list">
        {drafts.map((draft, index) => (
          <TournamentModelCard
            key={draft.id}
            index={index}
            draft={draft}
            errors={modelErrors[draft.id] ?? {}}
            disabled={disabled}
            open={expandedIds.has(draft.id)}
            canRemove={drafts.length > TOURNAMENT_MIN_MODELS}
            canDuplicate={canAdd}
            profiles={profiles}
            profilesLoading={profilesLoading}
            profilesError={profilesError}
            onToggle={() => onToggle(draft.id)}
            onRemove={() => onRemove(draft.id)}
            onDuplicate={() => onDuplicate(draft.id)}
            onChange={(patch) => onChange(draft.id, patch)}
            onPresetChange={(preset) => onPresetChange(draft.id, preset)}
            onProfileChange={(profileId) => onProfileChange(draft.id, profileId)}
          />
        ))}
      </div>

      <div className="tourney-add-row">
        <button
          type="button"
          className="btn btn--secondary btn--compact"
          onClick={onAdd}
          disabled={disabled || !canAdd}
        >
          <span aria-hidden="true">＋</span>
          添加模型
        </button>
      </div>

      <div className="tourney-games">
        <div className="tourney-games__head">
          <h3>赛制</h3>
        </div>

        <div className="tourney-games__control">
          <label htmlFor="tourney-games-per-pair">每对局数</label>
          <div className="tourney-stepper">
            <button
              type="button"
              aria-label="减少每对局数"
              onClick={() => onGamesChange(gamesPerPair - 1)}
              disabled={disabled || gamesPerPair <= 1}
            >
              −
            </button>
            <input
              id="tourney-games-per-pair"
              type="number"
              min={1}
              max={TOURNAMENT_MAX_GAMES_PER_PAIR}
              step={1}
              inputMode="numeric"
              value={gamesPerPair}
              disabled={disabled}
              aria-invalid={Boolean(gamesError)}
              onChange={(event) => onGamesChange(Number(event.target.value))}
            />
            <button
              type="button"
              aria-label="增加每对局数"
              onClick={() => onGamesChange(gamesPerPair + 1)}
              disabled={disabled || gamesPerPair >= TOURNAMENT_MAX_GAMES_PER_PAIR}
            >
              ＋
            </button>
          </div>
        </div>

        {gamesError && (
          <p className="field__error" role="alert">
            {gamesError}
          </p>
        )}

        <div className="tourney-plan-summary" aria-label="赛制规模汇总">
          <div>
            <span>配对</span>
            <strong>{plan.pairings}</strong>
            <em>组</em>
          </div>
          <div>
            <span>总对局</span>
            <strong>{plan.totalGames}</strong>
            <em>局</em>
          </div>
          <div>
            <span>每位对弈</span>
            <strong>{plan.gamesPerModel}</strong>
            <em>局</em>
          </div>
        </div>
      </div>
    </section>
  );
}
