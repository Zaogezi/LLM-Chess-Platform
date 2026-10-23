import type { ReactNode } from 'react';
import type { ModelProfileView } from '../../../shared/protocol';
import type { PresetKey } from '../../presets';
import { PRESETS, PROVIDER_LABELS, PROVIDER_OPTIONS, presetByKey } from '../../presets';
import { profileKeyLabel } from '../../lib/profiles';
import type {
  TournamentFieldErrors,
  TournamentModelDraft,
} from '../../lib/tournament';
import { TOURNAMENT_MODEL_SEALS } from '../../lib/tournament';
import { EyeIcon, EyeOffIcon } from '../Icons';
import { ThinkingLevelField } from '../ThinkingLevelField';

interface TournamentModelCardProps {
  index: number;
  draft: TournamentModelDraft;
  errors: TournamentFieldErrors;
  disabled: boolean;
  open: boolean;
  canRemove: boolean;
  canDuplicate: boolean;
  profiles: ModelProfileView[];
  profilesLoading: boolean;
  profilesError: string | null;
  /** Profiles already used by another seat; hidden unless they are the current value. */
  excludeProfileIds?: readonly string[];
  /** Optional line shown under the card head, e.g. a seed-pool badge. */
  caption?: ReactNode;
  /**
   * When false the copy/remove actions and the "管理模型库" link are hidden.
   * The fixed 16-seat championship board has no add/remove, so it opts out.
   */
  showManagement?: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onChange: (patch: Partial<TournamentModelDraft>) => void;
  onPresetChange: (preset: PresetKey) => void;
  onProfileChange: (profileId: string | null) => void;
}

export function TournamentModelCard({
  index,
  draft,
  errors,
  disabled,
  open,
  canRemove,
  canDuplicate,
  profiles,
  profilesLoading,
  profilesError,
  excludeProfileIds,
  caption,
  showManagement = true,
  onToggle,
  onRemove,
  onDuplicate,
  onChange,
  onPresetChange,
  onProfileChange,
}: TournamentModelCardProps) {
  const preset = presetByKey(draft.preset);
  const seal = TOURNAMENT_MODEL_SEALS[index] ?? String(index + 1);
  const displayName = draft.name.trim() || `模型 ${index + 1}`;
  const hasErrors = Object.keys(errors).length > 0;
  const selectedProfile = profiles.find((profile) => profile.id === draft.profileId) ?? null;
  const excluded = new Set(excludeProfileIds ?? []);
  const selectableProfiles = profiles.filter(
    (profile) => profile.id === draft.profileId || !excluded.has(profile.id),
  );
  const profileMode = Boolean(draft.profileId);
  const profileMissing = profileMode && selectedProfile === null;

  const profileId = `${draft.id}-profile`;
  const profileErrorId = `${draft.id}-profile-error`;
  const nameId = `${draft.id}-name`;
  const presetId = `${draft.id}-preset`;
  const providerId = `${draft.id}-provider`;
  const baseUrlId = `${draft.id}-baseUrl`;
  const modelId = `${draft.id}-model`;
  const thinkingId = `${draft.id}-thinkingLevel`;
  const apiReasoningId = `${draft.id}-apiReasoning`;
  const apiKeyId = `${draft.id}-apiKey`;

  return (
    <article
      className={`tourney-model-card${open ? ' is-open' : ''}${hasErrors ? ' has-errors' : ''}`}
      aria-label={`参赛模型 ${index + 1}：${displayName}`}
    >
      <header className="tourney-model-card__head">
        <span className={`tourney-seal tourney-seal--${index % 2 === 0 ? 'red' : 'ink'}`} aria-hidden="true">
          {seal}
        </span>
        <div className="tourney-model-card__title">
          <h3>{displayName}</h3>
          <p>
            <span>{preset.label}</span>
            <i aria-hidden="true">·</i>
            <span>{PROVIDER_LABELS[draft.provider]}</span>
            <i aria-hidden="true">·</i>
            <span className="tourney-model-card__model-id" title={draft.model}>
              {draft.model.trim() || '模型待定'}
            </span>
          </p>
        </div>
        <div className="tourney-model-card__actions">
          {showManagement && (
            <>
              <button
                type="button"
                className="tourney-mini-btn"
                onClick={onDuplicate}
                disabled={disabled || !canDuplicate}
                title={canDuplicate ? '复制此参赛模型' : '最多支持 8 位参赛模型'}
              >
                复制
              </button>
              <button
                type="button"
                className="tourney-mini-btn tourney-mini-btn--danger"
                onClick={onRemove}
                disabled={disabled || !canRemove}
                title={canRemove ? '移除此参赛模型' : '至少保留 2 位参赛模型'}
              >
                移除
              </button>
            </>
          )}
          <button
            type="button"
            className="tourney-mini-btn tourney-mini-btn--toggle"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={open ? '收起模型配置' : '展开模型配置'}
          >
            <span className="tourney-mini-btn__chevron" aria-hidden="true" />
            {open ? '收起' : '配置'}
          </button>
        </div>
      </header>

      {caption && <p className="tourney-model-card__caption">{caption}</p>}

      {open && (
        <div className="tourney-model-card__body">
          <div className="tourney-field-grid">
            <div className={`field tourney-field--wide${errors.profile ? ' field--invalid' : ''}`}>
              <label className="field__label" htmlFor={profileId}>
                模型库
              </label>
              <span className="select-wrap">
                <select
                  id={profileId}
                  value={draft.profileId ?? ''}
                  disabled={disabled}
                  aria-invalid={Boolean(errors.profile)}
                  aria-describedby={errors.profile ? profileErrorId : undefined}
                  onChange={(event) => onProfileChange(event.target.value || null)}
                >
                  <option value="">临时配置</option>
                  {profileMissing && (
                    <option value={draft.profileId!}>已删除的模型（请重新选择）</option>
                  )}
                  {selectableProfiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {profile.model}
                    </option>
                  ))}
                </select>
              </span>
              {errors.profile && (
                <span className="field__error" id={profileErrorId} role="alert">
                  {errors.profile}
                </span>
              )}
              {profilesError && (
                <p className="field__help">模型库读取失败：{profilesError}</p>
              )}
              {profilesLoading && profiles.length === 0 && (
                <p className="field__help">正在读取模型库…</p>
              )}
            </div>

            <div className={`field${errors.name ? ' field--invalid' : ''}`}>
              <label className="field__label" htmlFor={nameId}>
                名称
              </label>
              <input
                id={nameId}
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="例如 DeepSeek V3"
                value={draft.name}
                disabled={disabled}
                aria-invalid={Boolean(errors.name)}
                onChange={(event) => onChange({ name: event.target.value })}
              />
              {errors.name && (
                <span className="field__error" role="alert">
                  {errors.name}
                </span>
              )}
            </div>

            <div className="field">
              <label className="field__label" htmlFor={presetId}>
                服务预设
              </label>
              <span className="select-wrap">
                <select
                  id={presetId}
                  value={draft.preset}
                  disabled={disabled || profileMode}
                  onChange={(event) => onPresetChange(event.target.value as PresetKey)}
                >
                  {PRESETS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </span>
            </div>

            <div className={`field${errors.provider ? ' field--invalid' : ''}`}>
              <label className="field__label" htmlFor={providerId}>
                接口协议
              </label>
              <span className="select-wrap">
                <select
                  id={providerId}
                  value={draft.provider}
                  disabled={disabled || profileMode}
                  aria-invalid={Boolean(errors.provider)}
                  onChange={(event) => {
                    const provider = event.target.value as 'openai' | 'anthropic';
                    onChange({ provider, apiReasoning: provider === 'openai' });
                  }}
                >
                  {PROVIDER_OPTIONS.map((provider) => (
                    <option key={provider} value={provider}>
                      {PROVIDER_LABELS[provider]}
                    </option>
                  ))}
                </select>
              </span>
              {errors.provider && (
                <span className="field__error" role="alert">
                  {errors.provider}
                </span>
              )}
            </div>

            <div className={`field${errors.model ? ' field--invalid' : ''}`}>
              <label className="field__label" htmlFor={modelId}>
                模型 ID
              </label>
              <input
                id={modelId}
                type="text"
                autoComplete="off"
                spellCheck={false}
                placeholder="deepseek-chat"
                value={draft.model}
                disabled={disabled || profileMode}
                aria-invalid={Boolean(errors.model)}
                onChange={(event) => onChange({ model: event.target.value })}
              />
              {errors.model && (
                <span className="field__error" role="alert">
                  {errors.model}
                </span>
              )}
            </div>

            <div className={`field tourney-field--wide${errors.baseUrl ? ' field--invalid' : ''}`}>
              <label className="field__label" htmlFor={baseUrlId}>
                API Base URL
              </label>
              <input
                id={baseUrlId}
                type="url"
                inputMode="url"
                autoComplete="url"
                spellCheck={false}
                placeholder="https://api.deepseek.com/v1"
                value={draft.baseUrl}
                disabled={disabled || profileMode}
                aria-invalid={Boolean(errors.baseUrl)}
                onChange={(event) => onChange({ baseUrl: event.target.value })}
              />
              {errors.baseUrl && (
                <span className="field__error" role="alert">
                  {errors.baseUrl}
                </span>
              )}
            </div>

            <ThinkingLevelField
              id={thinkingId}
              provider={draft.provider}
              baseUrl={draft.baseUrl}
              model={draft.model}
              apiKey={draft.apiKey}
              profileId={draft.profileId}
              value={draft.thinkingLevel}
              options={draft.thinkingOptions}
              disabled={disabled}
              onChange={(level) => onChange({ thinkingLevel: level })}
              onOptionsChange={(options, selected) =>
                onChange({
                  thinkingOptions: options,
                  ...(selected ? { thinkingLevel: selected } : {}),
                })
              }
            />

            <div className="field">
              <label className="check-field tourney-check-field" htmlFor={apiReasoningId}>
                <input
                  id={apiReasoningId}
                  type="checkbox"
                  checked={draft.apiReasoning}
                  disabled={disabled}
                  onChange={(event) => onChange({ apiReasoning: event.target.checked })}
                />
                <span className="check-field__copy">
                  <span className="check-field__title">发送推理参数</span>
                </span>
              </label>
            </div>

            {profileMode ? (
              <div className="field tourney-field--wide">
                <span className="field__label">API Key</span>
                <p className="profile-key-readout">
                  <span
                    className={`profile-key${selectedProfile?.keyConfigured ? ' is-set' : ''}`}
                  >
                    {selectedProfile
                      ? profileKeyLabel(selectedProfile)
                      : '配置已删除'}
                  </span>
                </p>
              </div>
            ) : (
              <div className="field tourney-field--wide">
                <label className="field__label" htmlFor={apiKeyId}>
                  API Key
                  <span className="field__optional">可留空</span>
                </label>
                <div className="key-field">
                  <input
                    id={apiKeyId}
                    type={draft.showKey ? 'text' : 'password'}
                    autoComplete="new-password"
                    spellCheck={false}
                    placeholder="sk-…"
                    value={draft.apiKey}
                    disabled={disabled}
                    onChange={(event) => onChange({ apiKey: event.target.value })}
                  />
                  <button
                    type="button"
                    className="key-field__toggle"
                    onClick={() => onChange({ showKey: !draft.showKey })}
                    disabled={disabled}
                    aria-label={draft.showKey ? '隐藏 API Key' : '显示 API Key'}
                    aria-pressed={draft.showKey}
                  >
                    {draft.showKey ? (
                      <EyeOffIcon width={15} height={15} />
                    ) : (
                      <EyeIcon width={15} height={15} />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {hasErrors && (
            <p className="tourney-model-card__error-summary" role="status">
              请补全配置
            </p>
          )}
        </div>
      )}
    </article>
  );
}
