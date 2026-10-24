import { useEffect, useState } from 'react';
import type { ModelProfileView, ModelView, Side } from '../../shared/protocol';
import { useMediaQuery } from '../hooks/useMediaQuery';
import type { ModelConfigErrors, ModelConfigForm, PresetKey } from '../presets';
import { PRESETS, PROVIDER_LABELS, PROVIDER_OPTIONS, presetByKey } from '../presets';
import { SIDE_DUTY, SIDE_LABEL, SIDE_SEAL } from '../lib/chess';
import {
  describeApiReasoning,
  thinkingLevelHint,
  thinkingLevelLabel,
} from '../lib/format';
import { profileKeyLabel } from '../lib/profiles';
import { EyeIcon, EyeOffIcon, LockIcon } from './Icons';
import { ReasoningTimeoutField } from './ReasoningTimeoutField';
import { ThinkingLevelField } from './ThinkingLevelField';

interface ModelCardProps {
  side: Side;
  form: ModelConfigForm;
  errors: ModelConfigErrors;
  locked: boolean;
  /** Editable cards start folded after a finished match so results stay in view. */
  collapsed: boolean;
  serverModel: ModelView | null;
  profiles: ModelProfileView[];
  profilesLoading: boolean;
  profilesError: string | null;
  selectedProfile: ModelProfileView | null;
  profileError: string | null;
  onChange: (patch: Partial<ModelConfigForm>) => void;
  onPresetChange: (preset: PresetKey) => void;
  onSelectProfile: (profileId: string | null) => void;
}

export function ModelCard({
  side,
  form,
  errors,
  locked,
  collapsed,
  serverModel,
  profiles,
  profilesLoading,
  profilesError,
  selectedProfile,
  profileError,
  onChange,
  onPresetChange,
  onSelectProfile,
}: ModelCardProps) {
  const isCompact = useMediaQuery('(max-width: 640px)');
  const [open, setOpen] = useState(!isCompact && !collapsed);

  useEffect(() => {
    if (isCompact) {
      setOpen(false);
      return;
    }
    setOpen(!collapsed);
  }, [collapsed, isCompact]);

  useEffect(() => {
    if (Object.keys(errors).length > 0) {
      setOpen(true);
    }
  }, [errors]);

  const preset = presetByKey(form.preset);
  const profileMode = selectedProfile !== null;
  const providerKind =
    locked && serverModel
      ? serverModel.provider
      : selectedProfile
        ? selectedProfile.provider
        : form.provider;
  const displayModel =
    (locked && serverModel
      ? serverModel.displayName
      : selectedProfile
        ? selectedProfile.name
        : form.model.trim()) || preset.label;
  const displayProvider = PROVIDER_LABELS[providerKind];
  const displayThinkingLevel = locked && serverModel ? serverModel.thinkingLevel : form.thinkingLevel;
  const displayApiReasoning = locked && serverModel ? serverModel.apiReasoning : form.apiReasoning;
  const displayRequestTimeout =
    locked && serverModel ? serverModel.requestTimeoutSeconds ?? null : form.requestTimeoutSeconds;
  const hasErrors = Object.keys(errors).length > 0;

  const baseUrlErrorId = `${side}-baseUrl-error`;
  const modelErrorId = `${side}-model-error`;
  const providerErrorId = `${side}-provider-error`;
  const profileErrorId = `${side}-profile-error`;
  const profileSelectId = `${side}-profile`;

  const summaryContent = (
    <>
      <span className={`side-seal side-seal--${side}`} aria-hidden="true">
        {SIDE_SEAL[side]}
      </span>
      <span className="model-card__headings">
        <span className="model-card__title">
          {SIDE_LABEL[side]} · {SIDE_DUTY[side]}
        </span>
        <span className="model-card__subtitle">
          <span className="model-card__model" title={displayModel}>
            {displayModel}
          </span>
          <span className="model-card__provider">{displayProvider}</span>
          <span
            className="thinking-badge"
            title={`${thinkingLevelHint(displayThinkingLevel, displayRequestTimeout)}${
              displayApiReasoning
                ? ` ${describeApiReasoning(providerKind, displayThinkingLevel)}`
                : ''
            }`}
          >
            {thinkingLevelLabel(displayThinkingLevel)}
            {displayApiReasoning ? ' · API' : ''}
          </span>
        </span>
      </span>
      <span className="model-card__tail">
        {locked ? (
          <span className="lock-badge">
            <LockIcon width={11} height={11} />
            已锁定
          </span>
        ) : (
          <span className="model-card__chevron" aria-hidden="true" />
        )}
      </span>
    </>
  );

  if (locked) {
    return (
      <section
        className={`model-card model-card--${side} is-locked`}
        aria-label={`${SIDE_LABEL[side]}配置已锁定`}
      >
        <div className="model-card__summary model-card__summary--static">{summaryContent}</div>
        <p className="model-card__locked-strip">
          <LockIcon width={11} height={11} />
          <span>
            对局进行中，配置已锁定
            {serverModel?.keyConfigured ? '；密钥驻留服务端内存' : ''}
          </span>
        </p>
      </section>
    );
  }

  return (
    <details
      className={`model-card model-card--${side}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="model-card__summary">{summaryContent}</summary>

      <div className="model-card__body">
        <div className={`field model-profile-field${profileError ? ' field--invalid' : ''}`}>
          <label className="field__label" htmlFor={profileSelectId}>
            模型库
          </label>
          <span className="select-wrap">
            <select
              id={profileSelectId}
              value={selectedProfile?.id ?? ''}
              aria-invalid={Boolean(profileError)}
              aria-describedby={profileError ? profileErrorId : undefined}
              onChange={(event) => onSelectProfile(event.target.value || null)}
            >
              <option value="">临时配置</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name} · {profile.model}
                </option>
              ))}
            </select>
          </span>
          {profileError && (
            <span className="field__error" id={profileErrorId} role="alert">
              {profileError}
            </span>
          )}
          {profilesError && (
            <p className="field__help model-profile-field__error">
              模型库读取失败：{profilesError}
            </p>
          )}
          {profilesLoading && profiles.length === 0 && (
            <p className="field__help">正在读取模型库…</p>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor={`${side}-preset`}>
            服务预设
          </label>
          <span className="select-wrap">
            <select
              id={`${side}-preset`}
              value={form.preset}
              disabled={profileMode}
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
          <label className="field__label" htmlFor={`${side}-provider`}>
            接口协议
          </label>
          <span className="select-wrap">
            <select
              id={`${side}-provider`}
              value={form.provider}
              disabled={profileMode}
              aria-invalid={Boolean(errors.provider)}
              aria-describedby={errors.provider ? providerErrorId : undefined}
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
            <span className="field__error" id={providerErrorId} role="alert">
              {errors.provider}
            </span>
          )}
        </div>

        <div className={`field${errors.baseUrl ? ' field--invalid' : ''}`}>
          <label className="field__label" htmlFor={`${side}-baseUrl`}>
            API Base URL
          </label>
          <input
            id={`${side}-baseUrl`}
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://api.deepseek.com/v1"
            value={form.baseUrl}
            disabled={profileMode}
            aria-invalid={Boolean(errors.baseUrl)}
            aria-describedby={errors.baseUrl ? baseUrlErrorId : undefined}
            onChange={(event) => onChange({ baseUrl: event.target.value })}
          />
          {errors.baseUrl && (
            <span className="field__error" id={baseUrlErrorId} role="alert">
              {errors.baseUrl}
            </span>
          )}
        </div>

        <div className={`field${errors.model ? ' field--invalid' : ''}`}>
          <label className="field__label" htmlFor={`${side}-model`}>
            模型 ID
          </label>
          <input
            id={`${side}-model`}
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="deepseek-chat"
            value={form.model}
            disabled={profileMode}
            aria-invalid={Boolean(errors.model)}
            aria-describedby={errors.model ? modelErrorId : undefined}
            onChange={(event) => onChange({ model: event.target.value })}
          />
          {errors.model && (
            <span className="field__error" id={modelErrorId} role="alert">
              {errors.model}
            </span>
          )}
        </div>

        <ThinkingLevelField
          id={`${side}-thinkingLevel`}
          provider={form.provider}
          baseUrl={form.baseUrl}
          model={form.model}
          apiKey={form.apiKey}
          profileId={selectedProfile?.id ?? null}
          value={form.thinkingLevel}
          options={form.thinkingOptions}
          onChange={(level) => onChange({ thinkingLevel: level })}
          onOptionsChange={(options, selected) =>
            onChange({
              thinkingOptions: options,
              ...(selected ? { thinkingLevel: selected } : {}),
            })
          }
        />

        <ReasoningTimeoutField
          id={`${side}-requestTimeout`}
          value={form.requestTimeoutSeconds}
          thinkingLevel={form.thinkingLevel}
          error={errors.requestTimeoutSeconds}
          onChange={(seconds) => onChange({ requestTimeoutSeconds: seconds })}
        />

        <div className="api-reasoning-field">
          <label className="check-field" htmlFor={`${side}-apiReasoning`}>
            <input
              id={`${side}-apiReasoning`}
              type="checkbox"
              checked={form.apiReasoning}
              onChange={(event) => onChange({ apiReasoning: event.target.checked })}
            />
            <span className="check-field__copy">
              <span className="check-field__title">API 推理参数</span>
            </span>
          </label>
        </div>

        {profileMode ? (
          <div className="field">
            <span className="field__label">API Key</span>
            <p className="profile-key-readout">
              <span
                className={`profile-key${selectedProfile.keyConfigured ? ' is-set' : ''}`}
              >
                {profileKeyLabel(selectedProfile)}
              </span>
            </p>
          </div>
        ) : (
          <div className="field">
            <label className="field__label" htmlFor={`${side}-apiKey`}>
              API Key
              <span className="field__optional">可留空</span>
            </label>
            <div className="key-field">
              <input
                id={`${side}-apiKey`}
                type={form.showKey ? 'text' : 'password'}
                autoComplete="new-password"
                spellCheck={false}
                placeholder="sk-…"
                value={form.apiKey}
                onChange={(event) => onChange({ apiKey: event.target.value })}
              />
              <button
                type="button"
                className="key-field__toggle"
                onClick={() => onChange({ showKey: !form.showKey })}
                aria-label={form.showKey ? '隐藏 API Key' : '显示 API Key'}
                aria-pressed={form.showKey}
              >
                {form.showKey ? <EyeOffIcon width={15} height={15} /> : <EyeIcon width={15} height={15} />}
              </button>
            </div>
          </div>
        )}

        {hasErrors && (
          <p className="model-card__error-summary" role="status">
            请补全配置
          </p>
        )}
      </div>
    </details>
  );
}
