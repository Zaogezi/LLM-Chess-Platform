import type { ModelProfileView } from '../../../shared/protocol';
import type { PresetKey } from '../../presets';
import { PRESETS, PROVIDER_LABELS, PROVIDER_OPTIONS } from '../../presets';
import type {
  ProfileForm,
  ProfileFormErrors,
  ProfileTestState,
} from '../../lib/profiles';
import { EyeIcon, EyeOffIcon, Spinner } from '../Icons';
import { ProfileTestResult } from './ProfileTestResult';
import { ThinkingLevelField } from '../ThinkingLevelField';

interface ProfileEditorProps {
  mode: 'create' | 'edit';
  profile: ModelProfileView | null;
  form: ProfileForm;
  errors: ProfileFormErrors;
  busy: boolean;
  testState: ProfileTestState | null;
  testing: boolean;
  testDisabled: boolean;
  onChange: (patch: Partial<ProfileForm>) => void;
  onPresetChange: (preset: PresetKey) => void;
  onTest: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function ProfileEditor({
  mode,
  profile,
  form,
  errors,
  busy,
  testState,
  testing,
  testDisabled,
  onChange,
  onPresetChange,
  onTest,
  onSave,
  onCancel,
}: ProfileEditorProps) {
  const hasErrors = Object.keys(errors).length > 0;
  const editing = mode === 'edit';
  const storedKey = Boolean(editing && profile?.keyConfigured);

  const nameErrorId = 'profile-name-error';
  const providerErrorId = 'profile-provider-error';
  const baseUrlErrorId = 'profile-baseUrl-error';
  const modelErrorId = 'profile-model-error';

  return (
    <section className="panel library-editor" aria-label={editing ? '编辑模型' : '新增模型'}>
      <div className="panel__head">
        <h2 className="panel__title">{editing ? '编辑模型' : '新增模型'}</h2>
      </div>

      <div className="library-editor__body">
        <div className={`field${errors.name ? ' field--invalid' : ''}`}>
          <label className="field__label" htmlFor="profile-name">
            名称
          </label>
          <input
            id="profile-name"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="例如 DeepSeek 深思版"
            value={form.name}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? nameErrorId : undefined}
            onChange={(event) => onChange({ name: event.target.value })}
          />
          {errors.name && (
            <span className="field__error" id={nameErrorId} role="alert">
              {errors.name}
            </span>
          )}
        </div>

        <div className="field">
          <label className="field__label" htmlFor="profile-preset">
            服务预设
          </label>
          <span className="select-wrap">
            <select
              id="profile-preset"
              value={form.preset}
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
          <label className="field__label" htmlFor="profile-provider">
            接口协议
          </label>
          <span className="select-wrap">
            <select
              id="profile-provider"
              value={form.provider}
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

        <div className={`field${errors.model ? ' field--invalid' : ''}`}>
          <label className="field__label" htmlFor="profile-model">
            模型 ID
          </label>
          <input
            id="profile-model"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="deepseek-chat"
            value={form.model}
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

        <div className={`field library-editor__wide${errors.baseUrl ? ' field--invalid' : ''}`}>
          <label className="field__label" htmlFor="profile-baseUrl">
            API Base URL
          </label>
          <input
            id="profile-baseUrl"
            type="url"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="https://api.deepseek.com/v1"
            value={form.baseUrl}
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

        <ThinkingLevelField
          id="profile-thinkingLevel"
          provider={form.provider}
          baseUrl={form.baseUrl}
          model={form.model}
          apiKey={form.apiKey}
          profileId={profile?.id ?? null}
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

        <div className="field">
          <label className="check-field library-check-field" htmlFor="profile-apiReasoning">
            <input
              id="profile-apiReasoning"
              type="checkbox"
              checked={form.apiReasoning}
              onChange={(event) => onChange({ apiReasoning: event.target.checked })}
            />
            <span className="check-field__copy">
              <span className="check-field__title">发送推理参数</span>
            </span>
          </label>
        </div>

        <div className="field library-editor__wide">
          <label className="field__label" htmlFor="profile-apiKey">
            API Key
            <span className="field__optional">
              {storedKey ? `已保存 ${profile?.keyHint}` : '可留空'}
            </span>
          </label>
          <div className="key-field">
            <input
              id="profile-apiKey"
              type={form.showKey ? 'text' : 'password'}
              autoComplete="new-password"
              spellCheck={false}
              placeholder={storedKey ? '留空保持' : 'sk-…'}
              value={form.apiKey}
              disabled={form.clearKey}
              onChange={(event) => onChange({ apiKey: event.target.value })}
            />
            <button
              type="button"
              className="key-field__toggle"
              onClick={() => onChange({ showKey: !form.showKey })}
              disabled={form.clearKey}
              aria-label={form.showKey ? '隐藏 API Key' : '显示 API Key'}
              aria-pressed={form.showKey}
            >
              {form.showKey ? (
                <EyeOffIcon width={15} height={15} />
              ) : (
                <EyeIcon width={15} height={15} />
              )}
            </button>
          </div>
          {storedKey && (
            <label className="library-clear-key" htmlFor="profile-clearKey">
              <input
                id="profile-clearKey"
                type="checkbox"
                checked={form.clearKey}
                onChange={(event) =>
                  onChange({ clearKey: event.target.checked, apiKey: '' })
                }
              />
              清除已保存密钥
            </label>
          )}
        </div>
      </div>

      {hasErrors && (
        <p className="library-editor__error-summary" role="status">
          请补全配置
        </p>
      )}

      {testState && <ProfileTestResult state={testState} />}

      <div className="library-editor__actions">
        <button
          type="button"
          className="btn btn--secondary btn--compact"
          onClick={onCancel}
          disabled={busy}
        >
          取消
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--compact"
          onClick={onTest}
          disabled={busy || testDisabled}
          aria-busy={testing}
        >
          {testing ? (
            <>
              <Spinner />
              测试中…
            </>
          ) : (
            '测试连接'
          )}
        </button>
        <button
          type="button"
          className="btn btn--primary btn--compact"
          onClick={onSave}
          disabled={busy}
          aria-busy={busy}
        >
          {busy ? (
            <>
              <Spinner />
              保存中…
            </>
          ) : editing ? (
            '保存修改'
          ) : (
            '保存模型'
          )}
        </button>
      </div>
    </section>
  );
}
