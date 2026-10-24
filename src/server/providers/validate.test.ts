import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  validateModelSetup,
  validateSettings,
  validateStartRequest,
  validateThinkingLevels,
} from './validate';

describe('validateModelSetup', () => {
  it('normalizes a valid setup', () => {
    const setup = validateModelSetup(
      {
        provider: 'openai',
        baseUrl: ' https://api.deepseek.com/v1/ ',
        model: ' deepseek-chat ',
        apiKey: ' sk-key ',
        thinkingLevel: 'deep',
        apiReasoning: true,
      },
      'red',
    );
    expect(setup).toEqual({
      provider: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-key',
      thinkingLevel: 'deep',
      apiReasoning: true,
    });
  });

  it('defaults the thinking level and accepts all supported levels', () => {
    const base = {
      provider: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    };
    expect(validateModelSetup(base, 'red').thinkingLevel).toBe('balanced');
    expect(validateModelSetup(base, 'red').apiReasoning).toBe(true);
    expect(
      validateModelSetup(
        {
          provider: 'anthropic',
          baseUrl: 'https://api.anthropic.com/v1',
          model: 'claude-test',
        },
        'red',
      ).apiReasoning,
    ).toBe(false);
    expect(validateModelSetup({ ...base, thinkingLevel: 'quick' }, 'red').thinkingLevel).toBe(
      'quick',
    );
    expect(validateModelSetup({ ...base, thinkingLevel: 'deep' }, 'red').thinkingLevel).toBe(
      'deep',
    );
    expect(validateModelSetup({ ...base, apiReasoning: true }, 'red').apiReasoning).toBe(true);
    expect(validateModelSetup({ ...base, thinkingLevel: 'minimal' }, 'red').thinkingLevel).toBe(
      'minimal',
    );
    expect(validateModelSetup({ ...base, thinkingLevel: 'turbo' }, 'red').thinkingLevel).toBe(
      'turbo',
    );
    expect(() => validateModelSetup({ ...base, thinkingLevel: 'x'.repeat(65) }, 'red')).toThrow(
      /过长/,
    );
    expect(() => validateModelSetup({ ...base, thinkingLevel: 'bad\u0000level' }, 'red')).toThrow(
      /无效/,
    );
    expect(() => validateModelSetup({ ...base, apiReasoning: 'yes' }, 'red')).toThrow(
      /推理参数/,
    );
  });

  it('accepts an independent request timeout and rejects out-of-range values', () => {
    const base = {
      provider: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    };
    expect(
      validateModelSetup({ ...base, requestTimeoutSeconds: 300 }, 'red')
        .requestTimeoutSeconds,
    ).toBe(300);
    expect(
      validateModelSetup({ ...base, requestTimeoutSeconds: null }, 'red')
        .requestTimeoutSeconds,
    ).toBeUndefined();
    for (const invalid of [4, 1801, 12.5, '300']) {
      expect(() =>
        validateModelSetup({ ...base, requestTimeoutSeconds: invalid }, 'red'),
      ).toThrow(/最大推理时长/);
    }
  });

  it('allows local OpenAI-compatible endpoints without a key', () => {
    const setup = validateModelSetup(
      {
        provider: 'openai',
        baseUrl: 'http://127.0.0.1:11434/v1',
        model: 'qwen2.5:7b',
      },
      'black',
    );
    expect(setup.apiKey).toBe('');
    expect(setup.baseUrl).toBe('http://127.0.0.1:11434/v1');
    expect(setup.thinkingLevel).toBe('balanced');
    expect(setup.apiReasoning).toBe(true);
  });

  it.each([
    [{ provider: 'x', baseUrl: 'https://a.test/v1', model: 'm' }, '协议'],
    [{ provider: 'openai', baseUrl: '', model: 'm' }, '接口地址'],
    [{ provider: 'openai', baseUrl: 'ftp://a.test/v1', model: 'm' }, 'http'],
    [{ provider: 'openai', baseUrl: 'https://user:pass@a.test/v1', model: 'm' }, '用户名'],
    [{ provider: 'openai', baseUrl: 'https://a.test/v1?x=1', model: 'm' }, '查询参数'],
    [{ provider: 'openai', baseUrl: 'https://a.test/v1', model: '  ' }, '模型 ID'],
  ])('rejects malformed setup %#', (raw, needle) => {
    expect(() => validateModelSetup(raw, 'red')).toThrow(ValidationError);
    expect(() => validateModelSetup(raw, 'red')).toThrow(needle);
  });
});

describe('validateThinkingLevels', () => {
  it('defaults to built-ins, trims, deduplicates and caps API levels', () => {
    expect(validateThinkingLevels(undefined)).toEqual(['quick', 'balanced', 'deep']);
    expect(validateThinkingLevels([' high ', 'HIGH', 'low'])).toEqual(['high', 'low']);
    expect(() => validateThinkingLevels('high')).toThrow(/数组/);
    expect(() =>
      validateThinkingLevels(Array.from({ length: 17 }, (_, index) => `level-${index}`)),
    ).toThrow(/最多/);
    expect(() => validateThinkingLevels(['x'.repeat(65)])).toThrow(/过长/);
  });
});

describe('validateSettings', () => {
  it('applies defaults', () => {
    expect(validateSettings(undefined)).toEqual({ moveDelayMs: 1000, maxAttempts: 3 });
  });

  it('accepts boundaries and rounds values', () => {
    expect(validateSettings({ moveDelayMs: 12.6, maxAttempts: 5 })).toEqual({
      moveDelayMs: 13,
      maxAttempts: 5,
    });
    expect(validateSettings({ moveDelayMs: 0, maxAttempts: 1 })).toEqual({
      moveDelayMs: 0,
      maxAttempts: 1,
    });
  });

  it.each([
    [{ moveDelayMs: -1 }],
    [{ moveDelayMs: 5001 }],
    [{ maxAttempts: 0 }],
    [{ maxAttempts: 6 }],
    [{ moveDelayMs: 'fast' }],
  ])('rejects out-of-range settings %#', (raw) => {
    expect(() => validateSettings(raw)).toThrow(ValidationError);
  });
});

describe('validateStartRequest', () => {
  it('validates both sides', () => {
    const request = validateStartRequest({
      red: {
        provider: 'openai',
        baseUrl: 'https://red.test/v1',
        model: 'red-model',
        apiKey: 'red-key',
      },
      black: {
        provider: 'anthropic',
        baseUrl: 'https://black.test/v1',
        model: 'black-model',
        apiKey: 'black-key',
      },
      settings: { moveDelayMs: 0, maxAttempts: 2 },
    });
    expect(request.red.model).toBe('red-model');
    expect(request.black.provider).toBe('anthropic');
    expect(request.settings.maxAttempts).toBe(2);
  });

  it('rejects unknown or missing side fields', () => {
    expect(() => validateStartRequest({})).toThrow(ValidationError);
    expect(() =>
      validateStartRequest({
        red: { provider: 'openai', baseUrl: 'https://a.test/v1', model: 'm' },
      }),
    ).toThrow(ValidationError);
  });

  it('resolves model-library selections on the server with per-game overrides', () => {
    const profiles = {
      resolveSetup(id: string) {
        if (id !== 'saved-1') return null;
        return {
          provider: 'anthropic' as const,
          baseUrl: 'https://saved.test/v1',
          model: 'saved-model',
          apiKey: 'saved-secret',
          displayName: '主力 Claude',
          thinkingLevel: 'balanced' as const,
          apiReasoning: false,
        };
      },
    };

    const request = validateStartRequest(
      {
        red: { profileId: 'saved-1', thinkingLevel: 'deep', apiReasoning: true },
        black: { profileId: 'saved-1' },
      },
      profiles,
    );

    expect(request.red).toMatchObject({
      provider: 'anthropic',
      baseUrl: 'https://saved.test/v1',
      model: 'saved-model',
      apiKey: 'saved-secret',
      displayName: '主力 Claude',
      thinkingLevel: 'deep',
      apiReasoning: true,
    });
    expect(request.black).toMatchObject({
      thinkingLevel: 'balanced',
      apiReasoning: false,
    });
  });

  it('rejects missing or unknown model-library selections', () => {
    expect(() =>
      validateStartRequest(
        {
          red: { profileId: '' },
          black: { provider: 'openai', baseUrl: 'https://b.test/v1', model: 'm' },
        },
        { resolveSetup: () => null },
      ),
    ).toThrow(/选择/);

    expect(() =>
      validateStartRequest(
        {
          red: { profileId: 'gone' },
          black: { provider: 'openai', baseUrl: 'https://b.test/v1', model: 'm' },
        },
        { resolveSetup: () => null },
      ),
    ).toThrow(/已不存在/);

    expect(() =>
      validateStartRequest(
        {
          red: { profileId: 'saved-1' },
          black: { provider: 'openai', baseUrl: 'https://b.test/v1', model: 'm' },
        },
      ),
    ).toThrow(/不支持/);
  });
});
