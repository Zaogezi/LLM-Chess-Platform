import { useEffect, useRef, useState } from 'react';
import type { ModelProfileView, QualifierGroupId, QualifierState } from '../../../shared/protocol';
import type { QualifierAction } from '../../hooks/useQualifier';
import { PROVIDER_LABELS, type PresetKey } from '../../presets';
import {
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES,
  CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
  QUALIFIER_GROUP_LABELS,
  championshipErrorCount,
  draftsForQualifierGroup,
  qualifierDrafts,
  type ChampionshipDraft,
  type ChampionshipValidation,
} from '../../lib/championship';
import {
  QUALIFIER_GROUP_ORDER,
  QUALIFIER_PHASE_LABELS,
  qualifierPhaseTone,
  qualifierProgress,
} from '../../lib/qualifier';
import { Spinner } from '../Icons';
import { TournamentModelCard } from '../tournament/TournamentModelCard';

interface QualifierSetupProps {
  drafts: readonly ChampionshipDraft[];
  state: QualifierState | null;
  pending: QualifierAction | null;
  actionError: string | null;
  loadError: string | null;
  validation: ChampionshipValidation;
  disabled: boolean;
  profiles: ModelProfileView[];
  profilesLoading: boolean;
  profilesError: string | null;
  expandedIds: ReadonlySet<string>;
  qualifiedIds: ReadonlySet<string>;
  /** True when the qualifier ran with a different roster than the current seats. */
  rosterStale: boolean;
  onStart: () => void;
  onStop: () => void;
  onResume: () => void;
  onDismissError: () => void;
  onRetryLoad: () => void;
  onToggle: (id: string) => void;
  onChange: (id: string, patch: Record<string, unknown>) => void;
  onPresetChange: (id: string, preset: PresetKey) => void;
  onProfileChange: (id: string, profileId: string | null) => void;
  onQuickFill: (group: QualifierGroupId, profiles: readonly ModelProfileView[]) => void;
}

export function QualifierSetup({
  drafts,
  state,
  pending,
  actionError,
  loadError,
  validation,
  disabled,
  profiles,
  profilesLoading,
  profilesError,
  expandedIds,
  qualifiedIds,
  rosterStale,
  onStart,
  onStop,
  onResume,
  onDismissError,
  onRetryLoad,
  onToggle,
  onChange,
  onPresetChange,
  onProfileChange,
  onQuickFill,
}: QualifierSetupProps) {
  const phase = state?.phase ?? 'idle';
  const running = phase === 'running';
  const progress = qualifierProgress(state);
  const busy = pending !== null;
  const qualifier = qualifierDrafts(drafts);
  const layoutOk =
    qualifier.length === CHAMPIONSHIP_QUALIFIER_ENTRANTS &&
    QUALIFIER_GROUP_ORDER.every(
      (group) =>
        draftsForQualifierGroup(drafts, group).length ===
        CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
    );
  const rosterValid = layoutOk && championshipErrorCount(validation) === 0;
  const canStart = !running && !disabled && rosterValid && !busy;
  const canResume = Boolean(state?.resumable) && !running && !disabled && !busy;
  const selectedProfileIds = new Set(
    drafts.map((draft) => draft.profileId).filter((id): id is string => Boolean(id)),
  );

  const [quickGroup, setQuickGroup] = useState<QualifierGroupId | null>(null);
  const [quickSelectedIds, setQuickSelectedIds] = useState<string[]>([]);
  const quickTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setQuickSelectedIds((previous) =>
      previous.filter((id) => profiles.some((profile) => profile.id === id)),
    );
  }, [profiles]);

  useEffect(() => {
    setQuickGroup(null);
    setQuickSelectedIds([]);
  }, [phase]);

  const openQuickFill = (group: QualifierGroupId) => {
    setQuickGroup(group);
    setQuickSelectedIds([]);
  };

  const closeQuickFill = () => {
    setQuickGroup(null);
    setQuickSelectedIds([]);
    window.requestAnimationFrame(() => quickTriggerRef.current?.focus());
  };

  const toggleQuickProfile = (profileId: string) => {
    setQuickSelectedIds((previous) => {
      if (previous.includes(profileId)) {
        return previous.filter((id) => id !== profileId);
      }
      if (previous.length >= CHAMPIONSHIP_QUALIFIER_GROUP_SIZE) {
        return previous;
      }
      return [...previous, profileId];
    });
  };

  let startLabel = '开始入围赛';
  if (pending === 'start') {
    startLabel = '启动中…';
  } else if (phase === 'finished') {
    startLabel = '重新入围赛';
  } else if (phase === 'stopped' || phase === 'error' || phase === 'paused' || phase === 'interrupted') {
    startLabel = '重新发起';
  }

  return (
    <div className="qualifier-setup">
      <div className="champ-seats__head">
        <h3>
          <span aria-hidden="true">围</span>
          入围赛
        </h3>
        <div className="champ-seats__tools">
          <span>
            {qualifier.length} / {CHAMPIONSHIP_QUALIFIER_ENTRANTS} 席
          </span>
          <span className={`tourney-status tourney-status--${qualifierPhaseTone(phase)}`}>
            {QUALIFIER_PHASE_LABELS[phase]}
          </span>
        </div>
      </div>

      <div className="qualifier-setup__actions">
        {running ? (
          <button
            type="button"
            className="btn btn--danger btn--compact"
            onClick={onStop}
            disabled={busy}
            aria-busy={pending === 'stop'}
          >
            {pending === 'stop' && <Spinner />}
            {pending === 'stop' ? '停止中…' : '终止入围赛'}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary btn--compact"
            onClick={onStart}
            disabled={!canStart}
            aria-busy={pending === 'start'}
            title={
              rosterValid
                ? `两组共 ${CHAMPIONSHIP_QUALIFIER_GROUP_GAMES} 局真实模型调用`
                : '请先补齐 A、B 两组各 5 位模型并修正配置'
            }
          >
            {pending === 'start' && <Spinner />}
            {startLabel}
          </button>
        )}
        {canResume && (
          <button
            type="button"
            className="btn btn--primary btn--compact"
            onClick={onResume}
            disabled={busy}
            aria-busy={pending === 'resume'}
          >
            {pending === 'resume' && <Spinner />}
            {pending === 'resume' ? '恢复中…' : '继续入围赛'}
          </button>
        )}
        <span className="qualifier-setup__progress">
          {progress.groupGamesProcessed} / {progress.totalGames} 局 · 小组 {progress.groupsComplete}/2
        </span>
      </div>

      {rosterStale && (
        <p className="champ-notice champ-notice--warning" role="status">
          入围赛名单已变化，当前结果已失效；请重新发起入围赛后再抽签。
        </p>
      )}

      {!rosterValid && (
        <p className="field__help qualifier-setup__error">
          A、B 两组各需 5 位模型，并修正 {championshipErrorCount(validation)} 处配置。
        </p>
      )}

      {actionError && (
        <div className="tourney-alert" role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className="tourney-alert__dismiss"
            onClick={onDismissError}
            aria-label="关闭错误提示"
          >
            ×
          </button>
        </div>
      )}

      {loadError && (
        <div className="tourney-alert" role="alert">
          <span>{loadError}</span>
          <button type="button" className="tourney-alert__action" onClick={onRetryLoad}>
            重连
          </button>
        </div>
      )}

      <div className="qualifier-setup__groups">
        {QUALIFIER_GROUP_ORDER.map((groupId) => {
          const groupDrafts = draftsForQualifierGroup(drafts, groupId);
          const outsideProfileIds = new Set(
            drafts
              .filter((draft) => draft.qualifierGroup !== groupId)
              .map((draft) => draft.profileId)
              .filter((id): id is string => Boolean(id)),
          );
          const quickProfiles = profiles.filter(
            (profile) => !outsideProfileIds.has(profile.id),
          );
          const quickSelectedProfiles = quickProfiles.filter((profile) =>
            quickSelectedIds.includes(profile.id),
          );
          const quickOpen = quickGroup === groupId;
          const canQuickFill =
            quickProfiles.length >= CHAMPIONSHIP_QUALIFIER_GROUP_SIZE &&
            !profilesLoading &&
            !running &&
            !disabled;

          return (
            <section key={groupId} className="qualifier-setup__group" aria-label={QUALIFIER_GROUP_LABELS[groupId]}>
              <header className="qualifier-setup__group-head">
                <span className="champ-group__seal" aria-hidden="true">
                  {groupId}
                </span>
                <h4>{QUALIFIER_GROUP_LABELS[groupId]}</h4>
                <span className="qualifier-setup__group-count">
                  {groupDrafts.length} / {CHAMPIONSHIP_QUALIFIER_GROUP_SIZE} 席
                </span>
                <button
                  ref={quickOpen ? quickTriggerRef : undefined}
                  type="button"
                  className="btn btn--secondary btn--compact champ-quick-open"
                  onClick={() => {
                    if (quickOpen) {
                      closeQuickFill();
                    } else {
                      openQuickFill(groupId);
                    }
                  }}
                  disabled={running || disabled || (!quickOpen && !canQuickFill)}
                  aria-expanded={quickOpen}
                  aria-controls={`qualifier-quick-${groupId}`}
                  title={
                    quickProfiles.length < CHAMPIONSHIP_QUALIFIER_GROUP_SIZE
                      ? `模型库至少需要 ${CHAMPIONSHIP_QUALIFIER_GROUP_SIZE} 个未占用的模型`
                      : `从模型库选择 ${CHAMPIONSHIP_QUALIFIER_GROUP_SIZE} 个模型，一次性填入本组`
                  }
                >
                  {quickOpen ? '收起' : '快速选择'}
                </button>
              </header>

              {quickOpen && (
                <section
                  className="champ-quick qualifier-quick"
                  id={`qualifier-quick-${groupId}`}
                  aria-label={`快速填充${QUALIFIER_GROUP_LABELS[groupId]}`}
                >
                  <div className="champ-quick__head">
                    <div>
                      <strong>
                        从模型库选择 {CHAMPIONSHIP_QUALIFIER_GROUP_SIZE} 个模型
                      </strong>
                      <span>将覆盖{QUALIFIER_GROUP_LABELS[groupId]}的 5 个席位</span>
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
                    已选 {quickSelectedProfiles.length} / {CHAMPIONSHIP_QUALIFIER_GROUP_SIZE}
                  </p>

                  <ul className="champ-quick__list">
                    {quickProfiles.map((profile) => {
                      const selected = quickSelectedIds.includes(profile.id);
                      const choiceDisabled =
                        !selected &&
                        quickSelectedIds.length >= CHAMPIONSHIP_QUALIFIER_GROUP_SIZE;
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
                      onClick={() => {
                        onQuickFill(groupId, quickSelectedProfiles);
                        closeQuickFill();
                      }}
                      disabled={
                        quickSelectedProfiles.length !== CHAMPIONSHIP_QUALIFIER_GROUP_SIZE
                      }
                    >
                      填入{QUALIFIER_GROUP_LABELS[groupId]}
                    </button>
                  </div>
                </section>
              )}

              <div className="tourney-model-list champ-seat-list qualifier-seat-list">
                {groupDrafts.map((draft, seatIndex) => {
                  const qualified = qualifiedIds.has(draft.id);
                  const caption = [
                    `${QUALIFIER_GROUP_LABELS[groupId]} · 第 ${seatIndex + 1} 席`,
                    qualified ? '已晋级' : '',
                  ]
                    .filter((part) => part.length > 0)
                    .join(' · ');

                  return (
                    <TournamentModelCard
                      key={draft.id}
                      index={seatIndex}
                      draft={draft}
                      errors={validation.draftErrors[draft.id] ?? {}}
                      disabled={running || disabled}
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
            </section>
          );
        })}
      </div>
    </div>
  );
}
