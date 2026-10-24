import { describe, expect, it } from 'vitest';
import type { ModelProfileView, ModelTestResponse } from '../../shared/protocol';
import {
  applyProfileFormPreset,
  applyProfileToGameForm,
  createProfileForm,
  detectPreset,
  profileTestErrorMessage,
  profileTestFromResponse,
  profileTestLatencyLabel,
  profileToForm,
  toProfileCreateRequest,
  toProfileUpdateRequest,
  validateProfileForm,
} from './profiles';

const profile: ModelProfileView = {
  id: 'profile-1',
  name: 'DeepSeek 深思',
  provider: 'openai',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  thinkingLevel: 'deep',
  thinkingLevels: ['quick', 'balanced', 'deep'],
  apiReasoning: true,
  keyConfigured: true,
  keyHint: '••••1234',
  createdAt: 1,
  updatedAt: 2,
};

describe('model profile form helpers', () => {
  it('detects built-in presets and keeps custom endpoints custom', () => {
    expect(detectPreset('openai', 'https://api.deepseek.com/v1/', 'deepseek-chat')).toBe(
      'deepseek',
    );
    expect(detectPreset('openai', 'https://custom.example.test/v1', 'deepseek-chat')).toBe(
      'custom',
    );
  });

  it('validates names and reuses the shared endpoint validation', () => {
    const form = createProfileForm();
    const errors = validateProfileForm(form);
    expect(errors.name).toMatch(/名称/);
    expect(errors.baseUrl).toBeUndefined();

    form.name = '   ';
    expect(validateProfileForm(form).name).toMatch(/名称/);

    form.name = 'x'.repeat(81);
    expect(validateProfileForm(form).name).toMatch(/最多/);

    form.name = '合法名称';
    form.baseUrl = 'ftp://bad';
    expect(validateProfileForm(form).baseUrl).toMatch(/http/);
  });

  it('creates requests with a key and preserves a stored key on blank updates', () => {
    const form = profileToForm(profile);
    form.apiKey = 'new-key';

    const create = toProfileCreateRequest(form);
    expect(create).toMatchObject({
      name: 'DeepSeek 深思',
      apiKey: 'new-key',
      thinkingLevel: 'deep',
      apiReasoning: true,
    });

    form.apiKey = '';
    const keep = toProfileUpdateRequest(form, true);
    expect(keep).not.toHaveProperty('apiKey');
    expect(keep).not.toHaveProperty('clearApiKey');

    form.clearKey = true;
    expect(toProfileUpdateRequest(form, true)).toMatchObject({ clearApiKey: true });
  });

  it('carries the independent request timeout through forms and requests', () => {
    const timedProfile: ModelProfileView = { ...profile, requestTimeoutSeconds: 300 };
    const form = profileToForm(timedProfile);
    expect(form.requestTimeoutSeconds).toBe(300);
    expect(toProfileCreateRequest(form).requestTimeoutSeconds).toBe(300);
    expect(toProfileUpdateRequest(form, true).requestTimeoutSeconds).toBe(300);

    form.requestTimeoutSeconds = 3;
    expect(validateProfileForm(form).requestTimeoutSeconds).toMatch(/最大推理时长/);
    form.requestTimeoutSeconds = null;
    expect(validateProfileForm(form).requestTimeoutSeconds).toBeUndefined();

    const applied = applyProfileToGameForm(createProfileForm(), timedProfile);
    expect(applied.requestTimeoutSeconds).toBe(300);
  });

  it('carries prompt level and token caps through forms and requests', () => {
    const richProfile: ModelProfileView = {
      ...profile,
      promptLevel: 'quick',
      maxThinkingTokens: 4096,
      maxCompletionTokens: 8192,
    };
    const form = profileToForm(richProfile);
    expect(form.promptLevel).toBe('quick');
    expect(form.maxThinkingTokens).toBe(4096);
    expect(form.maxCompletionTokens).toBe(8192);
    expect(toProfileCreateRequest(form)).toMatchObject({
      promptLevel: 'quick',
      maxThinkingTokens: 4096,
      maxCompletionTokens: 8192,
    });
    expect(toProfileUpdateRequest(form, true)).toMatchObject({
      promptLevel: 'quick',
      maxThinkingTokens: 4096,
      maxCompletionTokens: 8192,
    });

    const applied = applyProfileToGameForm(createProfileForm(), richProfile);
    expect(applied.promptLevel).toBe('quick');
    expect(applied.maxThinkingTokens).toBe(4096);
    expect(applied.maxCompletionTokens).toBe(8192);
  });

  it('renders old profiles without the new fields as follow / no limit', () => {
    const form = profileToForm(profile);
    expect(form.promptLevel).toBeNull();
    expect(form.maxThinkingTokens).toBeNull();
    expect(form.maxCompletionTokens).toBeNull();

    const created = toProfileCreateRequest(form);
    expect(created).toMatchObject({
      promptLevel: null,
      maxThinkingTokens: null,
      maxCompletionTokens: null,
    });
  });

  it('surfaces token-cap range and cross-field errors through the profile form', () => {
    const form = profileToForm(profile);
    form.provider = 'openai';
    form.apiReasoning = true;

    form.maxThinkingTokens = 512;
    expect(validateProfileForm(form).maxThinkingTokens).toMatch(/最大思考 token/);
    form.maxThinkingTokens = 4096;
    form.maxCompletionTokens = 4096;
    expect(validateProfileForm(form).maxCompletionTokens).toMatch(/必须大于最大思考 token/);

    form.maxCompletionTokens = 8192;
    expect(validateProfileForm(form).maxCompletionTokens).toBeUndefined();
  });

  it('carries the reason-output switch through forms and requests', () => {
    const noReasonProfile: ModelProfileView = { ...profile, requireReason: false };
    const form = profileToForm(noReasonProfile);
    expect(form.requireReason).toBe(false);
    expect(toProfileCreateRequest(form).requireReason).toBe(false);
    expect(toProfileUpdateRequest(form, true).requireReason).toBe(false);
    expect(applyProfileToGameForm(createProfileForm(), noReasonProfile).requireReason).toBe(
      false,
    );

    // Old profiles without the field keep the historical require-reason default.
    const legacyForm = profileToForm(profile);
    expect(legacyForm.requireReason).toBe(true);
    expect(toProfileCreateRequest(legacyForm).requireReason).toBe(true);

    // Presets start from the default, and the form defaults to checked.
    expect(createProfileForm().requireReason).toBe(true);
    const presetForm = { ...createProfileForm(), requireReason: false };
    expect(applyProfileFormPreset(presetForm, 'anthropic').requireReason).toBe(true);
  });

  it('applies A profile to game forms without carrying a browser key', () => {
    const form = createProfileForm();
    form.apiKey = 'temporary-browser-key';
    const applied = applyProfileToGameForm(form, profile);
    expect(applied).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: '',
      thinkingLevel: 'deep',
      apiReasoning: true,
      preset: 'deepseek',
    });
  });

  it('fills preset defaults when choosing a service preset', () => {
    const form = createProfileForm();
    form.name = 'DeepSeek';
    const next = applyProfileFormPreset(form, 'ollama');
    expect(next).toMatchObject({
      preset: 'ollama',
      provider: 'openai',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:7b',
      name: 'Ollama 本地',
    });
  });
});

describe('model availability result helpers', () => {
  const response: ModelTestResponse = {
    ok: true,
    provider: 'openai',
    model: 'deepseek-chat',
    latencyMs: 842,
    tokensIn: 12,
    tokensOut: 1,
    message: '模型可用，接口已成功返回内容。',
    replyPreview: 'OK',
    testedAt: 1_700_000_000_000,
  };

  it('maps successful and failed probes to display state', () => {
    expect(profileTestFromResponse(response)).toMatchObject({
      status: 'ok',
      latencyMs: 842,
      tokensIn: 12,
      replyPreview: 'OK',
    });
    expect(
      profileTestFromResponse({
        ...response,
        ok: false,
        latencyMs: 500,
        message: '模型不可用：鉴权失败',
        replyPreview: '',
      }),
    ).toMatchObject({ status: 'error', message: '模型不可用：鉴权失败' });
  });

  it('formats latency and keeps a fallback for unexpected transport errors', () => {
    expect(profileTestLatencyLabel(842)).toBe('842 ms');
    expect(profileTestLatencyLabel(1_250)).toBe('1.3 s');
    expect(profileTestLatencyLabel(undefined)).toBe('');
    expect(profileTestErrorMessage('  网络不可达  ')).toMatchObject({
      status: 'error',
      message: '网络不可达',
    });
    expect(profileTestErrorMessage('')).toMatchObject({
      status: 'error',
      message: expect.stringContaining('失败'),
    });
  });
});
