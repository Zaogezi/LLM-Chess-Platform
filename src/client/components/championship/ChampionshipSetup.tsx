import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ModelProfileView } from '../../../shared/protocol';
import {
  CHAMPIONSHIP_ENTRANTS,
  CHAMPIONSHIP_ENTRANTS_PER_POOL,
  CHAMPIONSHIP_MAX_CONCURRENCY,
  CHAMPIONSHIP_MIN_CONCURRENCY,
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
} from '../../../shared/protocol';
import { PROVIDER_LABELS, type PresetKey } from '../../presets';
import type {
  ChampionshipDraft,
  ChampionshipDraw,
  ChampionshipValidation,
} from '../../lib/championship';
import {
  CHAMPIONSHIP_POOL_LABELS,
  CHAMPIONSHIP_POOL_SEALS,
  CHAMPIONSHIP_SEED_POOLS,
  championshipErrorCount,
  championshipPoolLabel,
  championshipPoolSeal,
  countDraftsByPool,
  drawnGroupBadge,
  draftsForPool,
  isChampionshipDraftBlank,
} from '../../lib/championship';
import type { TournamentModelDraft } from '../../lib/tournament';
import { TournamentModelCard } from '../tournament/TournamentModelCard';

interface ChampionshipSetupProps {
  drafts: readonly ChampionshipDraft[];
  activePool: number;
  validation: ChampionshipValidation;
  draw: ChampionshipDraw | null;
  notice: string | null;
  disabled: boolean;
  profiles: ModelProfileView[];
  profilesLoading: boolean;
  profilesError: string | null;
  expandedIds: ReadonlySet<string>;
  concurrency: number;
  /** Rendered inside the pool-4 tab: the ten qualifying seats and controls. */
  qualifierPanel: ReactNode;
  /** How many qualifier winners currently fill the fourth seed pool. */
  qualifiedCount: number;
  onConcurrencyChange: (concurrency: number) => void;
  onPoolChange: (pool: number) => void;
  onFillProfiles: () => void;
  onQuickFill: (pool: number, profiles: readonly ModelProfileView[]) => void;
  onToggle: (id: string) => void;
  onChange: (id: string, patch: Partial<TournamentModelDraft>) => void;
  onPresetChange: (id: string, preset: PresetKey) => void;
  onProfileChange: (id: string, profileId: string | null) => void;
}

export function ChampionshipSetup({
  drafts,
  activePool,
  validation,
  draw,
  notice,
  disabled,
  profiles,
  profilesLoading,
  profilesError,
  expandedIds,
  concurrency,
  qualifierPanel,
  qualifiedCount,
  onConcurrencyChange,
  onPoolChange,
  onFillProfiles,
  onQuickFill,
  onToggle,
  onChange,
  onPresetChange,
  onProfileChange,
}: ChampionshipSetupProps) {
  const counts = countDraftsByPool(drafts);
  const poolDrafts = draftsForPool(drafts, activePool);
  const errorCount = championshipErrorCount(validation);
  const selectedProfileIds = new Set(
    drafts.map((draft) => draft.profileId).filter((id): id is string => Boolean(id)),
  );
  const selectedOutsidePoolIds = new Set(
    drafts
      .filter((draft) => draft.seedPool !== activePool)
      .map((draft) => draft.profileId)
      .filter((id): id is string => Boolean(id)),
  );
  const quickProfiles = profiles.filter(
    (profile) => !selectedOutsidePoolIds.has(profile.id),
  );
  const canFill = profiles.length > 0 && !disabled;
  const canQuickFill =
    quickProfiles.length >= CHAMPIONSHIP_ENTRANTS_PER_POOL && !profilesLoading && !disabled;

  const [quickOpen, setQuickOpen] = useState(false);
  const [quickSelectedIds, setQuickSelectedIds] = useState<string[]>([]);
  const quickTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setQuickOpen(false);
    setQuickSelectedIds([]);
  }, [activePool]);

  useEffect(() => {
    setQuickSelectedIds((previous) =>
      previous.filter((id) => profiles.some((profile) => profile.id === id)),
    );
  }, [profiles]);

  const quickSelectedProfiles = quickProfiles.filter((profile) =>
    quickSelectedIds.includes(profile.id),
  );

  const openQuickFill = () => {
    setQuickSelectedIds([]);
    setQuickOpen(true);
  };

  const closeQuickFill = () => {
    setQuickOpen(false);
    setQuickSelectedIds([]);
    window.requestAnimationFrame(() => quickTriggerRef.current?.focus());
  };

  const toggleQuickProfile = (profileId: string) => {
    setQuickSelectedIds((previous) => {
      if (previous.includes(profileId)) {
        return previous.filter((id) => id !== profileId);
      }
      if (previous.length >= CHAMPIONSHIP_ENTRANTS_PER_POOL) {
        return previous;
      }
      return [...previous, profileId];
    });
  };

  const applyQuickFill = () => {
    if (quickSelectedProfiles.length !== CHAMPIONSHIP_ENTRANTS_PER_POOL) {
      return;
    }
    onQuickFill(activePool, quickSelectedProfiles);
    closeQuickFill();
  };

  return (
    <section className="panel championship-setup" aria-label="十六强席位配置">
      <div className="panel__head">
        <h2 className="panel__title">十六强席位</h2>
        <span className="panel__meta">
          12 直邀 · {CHAMPIONSHIP_QUALIFIER_ENTRANTS} 入围
        </span>
      </div>

      <div className="champ-pools" role="tablist" aria-label="种子池">
        {CHAMPIONSHIP_SEED_POOLS.map((pool) => {
          const active = pool === activePool;
          const count = counts[pool] ?? 0;
          const target =
            pool === 4 ? CHAMPIONSHIP_QUALIFIER_ENTRANTS : CHAMPIONSHIP_ENTRANTS_PER_POOL;
          const complete =
            pool === 4
              ? qualifiedCount === CHAMPIONSHIP_ENTRANTS_PER_POOL
              : count === target;
          const countLabel =
            pool === 4
              ? `${qualifiedCount}/${CHAMPIONSHIP_ENTRANTS_PER_POOL} 晋级`
              : `${count}/${target} 席`;
          return (
            <button
              key={pool}
              type="button"
              role="tab"
              id={`champ-pool-tab-${pool}`}
              aria-selected={active}
              aria-controls={`champ-pool-panel-${pool}`}
              className={`champ-pool-tab${active ? ' is-active' : ''}${
                complete ? '' : ' is-incomplete'
              }`}
              onClick={() => onPoolChange(pool)}
            >
              <span className="champ-pool-tab__seal" aria-hidden="true">
                {CHAMPIONSHIP_POOL_SEALS[pool]}
              </span>
              <span className="champ-pool-tab__body">
                <span className="champ-pool-tab__label">{CHAMPIONSHIP_POOL_LABELS[pool]}</span>
                <span className="champ-pool-tab__count">{countLabel}</span>
              </span>
            </button>
          );
        })}
      </div>

      {validation.formErrors.length > 0 && (
        <ul className="champ-form-errors" role="alert">
          {validation.formErrors.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}

      {activePool === 4 ? (
        <div
          id="champ-pool-panel-4"
          role="tabpanel"
          aria-labelledby="champ-pool-tab-4"
          className="champ-seats champ-seats--qualifier"
        >
          {qualifierPanel}
        </div>
      ) : (
        <div
          id={`champ-pool-panel-${activePool}`}
          role="tabpanel"
          aria-labelledby={`champ-pool-tab-${activePool}`}
          className="champ-seats"
        >
        <div className="champ-seats__head">
          <h3>
            <span aria-hidden="true">{championshipPoolSeal(activePool)}</span>
            {championshipPoolLabel(activePool)}
          </h3>
          <div className="champ-seats__tools">
            <span>{poolDrafts.length} / {CHAMPIONSHIP_ENTRANTS_PER_POOL} 席</span>
            <button
              ref={quickTriggerRef}
              type="button"
              className="btn btn--secondary btn--compact champ-quick-open"
              onClick={() => {
                if (quickOpen) {
                  closeQuickFill();
                } else {
                  openQuickFill();
                }
              }}
              disabled={disabled || (!quickOpen && !canQuickFill)}
              aria-expanded={quickOpen}
              aria-controls={`champ-quick-${activePool}`}
              title={
                profiles.length < CHAMPIONSHIP_ENTRANTS_PER_POOL
                  ? `模型库至少需要保存 ${CHAMPIONSHIP_ENTRANTS_PER_POOL} 个模型`
                  : '从模型库选择 4 个模型，一次性填入本种子池'
              }
            >
              {quickOpen ? '收起' : '快速选择'}
            </button>
          </div>
        </div>

        {quickOpen && (
          <section
            className="champ-quick"
            id={`champ-quick-${activePool}`}
            aria-label={`快速填充${championshipPoolLabel(activePool)}`}
          >
            <div className="champ-quick__head">
              <div>
                <strong>从模型库选择 4 个模型</strong>
                <span>将覆盖{championshipPoolLabel(activePool)}的 4 个席位</span>
              </div>
              <button
                type="button"
                className="champ-quick__close"
                onClick={closeQuickFill}
                aria-label="关闭快速选择"
              >
                ×
              </button>
            </div>

            <p className="champ-quick__hint" aria-live="polite">
              已选 {quickSelectedProfiles.length} / {CHAMPIONSHIP_ENTRANTS_PER_POOL}
            </p>

            <ul className="champ-quick__list">
              {quickProfiles.map((profile) => {
                const selected = quickSelectedIds.includes(profile.id);
                const choiceDisabled =
                  !selected &&
                  quickSelectedIds.length >= CHAMPIONSHIP_ENTRANTS_PER_POOL;
                return (
                  <li key={profile.id}>
                    <label
                      className={`champ-quick__item${selected ? ' is-selected' : ''}${
                        choiceDisabled ? ' is-disabled' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={choiceDisabled}
                        onChange={() => toggleQuickProfile(profile.id)}
                      />
                      <span className="champ-quick__identity">
                        <strong>{profile.name}</strong>
                        <span>
                          {PROVIDER_LABELS[profile.provider]} · {profile.model}
                        </span>
                      </span>
                      <span
                        className={`champ-quick__key${profile.keyConfigured ? ' is-set' : ''}`}
                      >
                        {profile.keyConfigured ? '密钥就绪' : '无密钥'}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>

            <div className="champ-quick__actions">
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                onClick={closeQuickFill}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn--primary btn--compact"
                onClick={applyQuickFill}
                disabled={quickSelectedProfiles.length !== CHAMPIONSHIP_ENTRANTS_PER_POOL}
              >
                填入{championshipPoolLabel(activePool)}
              </button>
            </div>
          </section>
        )}

        <div className="tourney-model-list champ-seat-list">
          {poolDrafts.map((draft, seatIndex) => {
            const groupLabel = drawnGroupBadge(draw, draft.id);
            const blank = isChampionshipDraftBlank(draft);
            const caption = [
              `${championshipPoolLabel(activePool)} · 第 ${seatIndex + 1} 席`,
              blank ? '空位' : '',
              groupLabel ? `已入 ${groupLabel}` : '',
            ]
              .filter((part) => part.length > 0)
              .join(' · ');

            return (
              <TournamentModelCard
                key={draft.id}
                index={seatIndex}
                draft={draft}
                errors={validation.draftErrors[draft.id] ?? {}}
                disabled={disabled}
                open={expandedIds.has(draft.id)}
                canRemove={false}
                canDuplicate={false}
                showManagement={false}
                caption={caption}
                profiles={profiles}
                profilesLoading={profilesLoading}
                profilesError={profilesError}
                excludeProfileIds={[...selectedProfileIds].filter(
                  (profileId) => profileId !== draft.profileId,
                )}
                onToggle={() => onToggle(draft.id)}
                onRemove={() => {}}
                onDuplicate={() => {}}
                onChange={(patch) => onChange(draft.id, patch)}
                onPresetChange={(preset) => onPresetChange(draft.id, preset)}
                onProfileChange={(profileId) => onProfileChange(draft.id, profileId)}
              />
            );
          })}
        </div>
        </div>
      )}

      <div className="champ-setup-actions">
        <button
          type="button"
          className="btn btn--secondary btn--compact"
          onClick={onFillProfiles}
          disabled={!canFill}
          title={
            profiles.length === 0
              ? '模型库尚无配置'
              : '将空席位填充为模型库中的已保存配置'
          }
        >
          填充空位
        </button>
        <label className="champ-concurrency" title="同时进行的小组赛或同轮系列赛数量">
          <span>并发</span>
          <select
            value={concurrency}
            onChange={(event) => onConcurrencyChange(Number(event.target.value))}
            disabled={disabled}
            aria-label="并发局数"
          >
            {Array.from(
              { length: CHAMPIONSHIP_MAX_CONCURRENCY - CHAMPIONSHIP_MIN_CONCURRENCY + 1 },
              (_, index) => CHAMPIONSHIP_MIN_CONCURRENCY + index,
            ).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {errorCount > 0 && (
          <span className="champ-setup-foot__errors">{errorCount} 处待修正</span>
        )}
      </div>

      {profilesError && (
        <p className="field__help champ-setup-errors" role="status">
          {profilesError}
        </p>
      )}

      {notice && (
        <p className="champ-notice" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
