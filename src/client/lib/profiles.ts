import type {
  ModelProfileCreateRequest,
  ModelProfileUpdateRequest,
  ModelProfileView,
  ModelTestResponse,
  ProviderKind,
  ThinkingLevel,
} from '../../shared/protocol';
import {
  DEFAULT_THINKING_LEVELS,
  MODEL_PROFILE_NAME_MAX,
} from '../../shared/protocol';
import { thinkingLevelLabel } from './format';
import type { PresetKey } from '../presets';
import {
  PRESETS,
  PROVIDER_LABELS,
  createModelConfig,
  presetByKey,
  validateModelConfig,
} from '../presets';

export interface ProfileForm {
  name: string;
  preset: PresetKey;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  thinkingOptions: ThinkingLevel[];
  apiReasoning: boolean;
  apiKey: string;
  showKey: boolean;
  clearKey: boolean;
  /** In-app prompt intensity; null follows the API thinking level. */
  promptLevel: ThinkingLevel | null;
  /** Hard thinking-token cap; null uses the provider/tier default. */
  maxThinkingTokens: number | null;
  /** Hard total-output cap; null sends no cap. */
  maxCompletionTokens: number | null;
  requestTimeoutSeconds: number | null;
}

export interface ProfileFormErrors {
  name?: string;
  provider?: string;
  baseUrl?: string;
  model?: string;
  maxThinkingTokens?: string;
  maxCompletionTokens?: string;
  requestTimeoutSeconds?: string;
}

export type ProfileTestStatus = 'testing' | 'ok' | 'error';

/** Client-only visual state for the library availability probe. */
export interface ProfileTestState {
  status: ProfileTestStatus;
  message: string;
  latencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  replyPreview?: string;
  testedAt?: number;
}

export function profileTestFromResponse(response: ModelTestResponse): ProfileTestState {
  return {
    status: response.ok ? 'ok' : 'error',
    message: response.message,
    latencyMs: response.latencyMs,
    tokensIn: response.tokensIn,
    tokensOut: response.tokensOut,
    replyPreview: response.replyPreview,
    testedAt: response.testedAt,
  };
}

export function profileTestErrorMessage(message: string): ProfileTestState {
  return {
    status: 'error',
    message: message.trim() || '测试模型可用性失败，请稍后重试。',
  };
}

export function profileTestLatencyLabel(latencyMs: number | undefined): string {
  if (typeof latencyMs !== 'number' || !Number.isFinite(latencyMs) || latencyMs < 0) {
    return '';
  }
  if (latencyMs < 1000) {
    return `${Math.max(1, Math.round(latencyMs))} ms`;
  }
  return `${(latencyMs / 1000).toFixed(1)} s`;
}

export function detectPreset(provider: ProviderKind, baseUrl: string, model: string): PresetKey {
  const normalizedUrl = baseUrl.trim().replace(/\/+$/, '').toLocaleLowerCase();
  const normalizedModel = model.trim().toLocaleLowerCase();
  const match = PRESETS.find(
    (preset) =>
      preset.key !== 'custom' &&
      preset.provider === provider &&
      preset.baseUrl.replace(/\/+$/, '').toLocaleLowerCase() === normalizedUrl &&
      preset.model.toLocaleLowerCase() === normalizedModel,
  );
  return match?.key ?? 'custom';
}

export function createProfileForm(): ProfileForm {
  const config = createModelConfig('deepseek');
  return {
    name: '',
    preset: config.preset,
    provider: config.provider,
    baseUrl: config.baseUrl,
    model: config.model,
    thinkingLevel: config.thinkingLevel,
    thinkingOptions: [...DEFAULT_THINKING_LEVELS],
    apiReasoning: config.apiReasoning,
    apiKey: '',
    showKey: false,
    clearKey: false,
    promptLevel: config.promptLevel,
    maxThinkingTokens: config.maxThinkingTokens,
    maxCompletionTokens: config.maxCompletionTokens,
    requestTimeoutSeconds: null,
  };
}

export function profileToForm(profile: ModelProfileView): ProfileForm {
  return {
    name: profile.name,
    preset: detectPreset(profile.provider, profile.baseUrl, profile.model),
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    thinkingLevel: profile.thinkingLevel,
    thinkingOptions: [...profile.thinkingLevels],
    apiReasoning: profile.apiReasoning,
    apiKey: '',
    showKey: false,
    clearKey: false,
    promptLevel: profile.promptLevel ?? null,
    maxThinkingTokens: profile.maxThinkingTokens ?? null,
    maxCompletionTokens: profile.maxCompletionTokens ?? null,
    requestTimeoutSeconds: profile.requestTimeoutSeconds ?? null,
  };
}

export function applyProfileFormPreset(form: ProfileForm, presetKey: PresetKey): ProfileForm {
  const preset = presetByKey(presetKey);
  const currentName = form.name.trim();
  return {
    ...form,
    preset: preset.key,
    provider: preset.provider,
    baseUrl: preset.baseUrl,
    model: preset.model,
    thinkingLevel: 'balanced',
    thinkingOptions: [...DEFAULT_THINKING_LEVELS],
    apiReasoning: preset.provider === 'openai',
    promptLevel: null,
    maxThinkingTokens: null,
    maxCompletionTokens: null,
    requestTimeoutSeconds: null,
    name:
      currentName.length === 0 || currentName === presetByKey(form.preset).label
        ? preset.key === 'custom'
          ? ''
          : preset.label
        : form.name,
  };
}

export function validateProfileForm(form: ProfileForm): ProfileFormErrors {
  const errors: ProfileFormErrors = { ...validateModelConfig(form) };
  const name = form.name.trim();
  if (!name) {
    errors.name = '请填写模型名称。';
  } else if (name.length > MODEL_PROFILE_NAME_MAX) {
    errors.name = `模型名称最多 ${MODEL_PROFILE_NAME_MAX} 个字符。`;
  }
  return errors;
}

export function toProfileCreateRequest(form: ProfileForm): ModelProfileCreateRequest {
  return {
    name: form.name.trim(),
    provider: form.provider,
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    thinkingLevel: form.thinkingLevel,
    thinkingLevels: [...form.thinkingOptions],
    apiReasoning: form.apiReasoning,
    promptLevel: form.promptLevel,
    maxThinkingTokens: form.maxThinkingTokens,
    maxCompletionTokens: form.maxCompletionTokens,
    requestTimeoutSeconds: form.requestTimeoutSeconds,
    apiKey: form.apiKey.trim(),
  };
}

export function toProfileUpdateRequest(
  form: ProfileForm,
  hasStoredKey: boolean,
): ModelProfileUpdateRequest {
  const request: ModelProfileUpdateRequest = {
    name: form.name.trim(),
    provider: form.provider,
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    thinkingLevel: form.thinkingLevel,
    thinkingLevels: [...form.thinkingOptions],
    apiReasoning: form.apiReasoning,
    promptLevel: form.promptLevel,
    maxThinkingTokens: form.maxThinkingTokens,
    maxCompletionTokens: form.maxCompletionTokens,
    requestTimeoutSeconds: form.requestTimeoutSeconds,
  };

  if (form.clearKey && hasStoredKey) {
    request.clearApiKey = true;
  } else if (form.apiKey.trim().length > 0) {
    request.apiKey = form.apiKey.trim();
  }
  return request;
}

export function profileProviderLabel(provider: ProviderKind): string {
  return PROVIDER_LABELS[provider];
}

export function profileKeyLabel(profile: ModelProfileView): string {
  return profile.keyConfigured ? profile.keyHint || '已保存密钥' : '未设置密钥';
}

export function profileThinkingLabel(level: ThinkingLevel): string {
  return thinkingLevelLabel(level);
}

export function applyProfileToGameForm(
  form: {
    provider: ProviderKind;
    baseUrl: string;
    model: string;
    thinkingLevel: ThinkingLevel;
    thinkingOptions: ThinkingLevel[];
    apiReasoning: boolean;
    apiKey: string;
    showKey: boolean;
    preset: PresetKey;
    requestTimeoutSeconds?: number | null;
    promptLevel?: ThinkingLevel | null;
    maxThinkingTokens?: number | null;
    maxCompletionTokens?: number | null;
  },
  profile: ModelProfileView,
): typeof form {
  return {
    ...form,
    preset: detectPreset(profile.provider, profile.baseUrl, profile.model),
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    thinkingLevel: profile.thinkingLevel,
    thinkingOptions: [...profile.thinkingLevels],
    apiReasoning: profile.apiReasoning,
    apiKey: '',
    showKey: false,
    promptLevel: profile.promptLevel ?? null,
    maxThinkingTokens: profile.maxThinkingTokens ?? null,
    maxCompletionTokens: profile.maxCompletionTokens ?? null,
    requestTimeoutSeconds: profile.requestTimeoutSeconds ?? null,
  };
}

export function formatProfileTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return '—';
  }
}
