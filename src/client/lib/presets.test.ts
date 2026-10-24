import { describe, expect, it } from 'vitest';
import {
  MAX_COMPLETION_TOKENS_MAX,
  MAX_COMPLETION_TOKENS_MIN,
  MAX_THINKING_TOKENS_MAX,
  MAX_THINKING_TOKENS_MIN,
} from '../../shared/protocol';
import { createModelConfig, toModelSetup, validateModelConfig } from '../presets';

describe('prompt level and token caps', () => {
  it('defaults to follow / no limit and keeps them in the setup payload', () => {
    const form = createModelConfig('deepseek');
    expect(form.promptLevel).toBeNull();
    expect(form.maxThinkingTokens).toBeNull();
    expect(form.maxCompletionTokens).toBeNull();

    form.promptLevel = 'quick';
    form.maxThinkingTokens = 4096;
    form.maxCompletionTokens = 8192;
    expect(toModelSetup(form)).toMatchObject({
      promptLevel: 'quick',
      maxThinkingTokens: 4096,
      maxCompletionTokens: 8192,
    });

    const defaults = toModelSetup(createModelConfig('deepseek'));
    expect(defaults.promptLevel).toBeNull();
    expect(defaults.maxThinkingTokens).toBeNull();
    expect(defaults.maxCompletionTokens).toBeNull();
  });

  it('validates both token caps as integers inside their allowed ranges', () => {
    const form = createModelConfig('deepseek');

    form.maxThinkingTokens = MAX_THINKING_TOKENS_MIN - 1;
    expect(validateModelConfig(form).maxThinkingTokens).toMatch(/最大思考 token/);
    form.maxThinkingTokens = MAX_THINKING_TOKENS_MAX + 1;
    expect(validateModelConfig(form).maxThinkingTokens).toMatch(/最大思考 token/);
    form.maxThinkingTokens = 4096.5;
    expect(validateModelConfig(form).maxThinkingTokens).toMatch(/整数/);
    form.maxThinkingTokens = 4096;
    expect(validateModelConfig(form).maxThinkingTokens).toBeUndefined();

    form.maxCompletionTokens = MAX_COMPLETION_TOKENS_MIN - 1;
    expect(validateModelConfig(form).maxCompletionTokens).toMatch(/最大输出 token/);
    form.maxCompletionTokens = MAX_COMPLETION_TOKENS_MAX + 1;
    expect(validateModelConfig(form).maxCompletionTokens).toMatch(/最大输出 token/);
    form.maxCompletionTokens = 8192.5;
    expect(validateModelConfig(form).maxCompletionTokens).toMatch(/整数/);
    form.maxCompletionTokens = 8192;
    expect(validateModelConfig(form).maxCompletionTokens).toBeUndefined();
  });

  it('requires the output cap to exceed an explicit thinking cap', () => {
    const form = createModelConfig('openai');
    form.maxThinkingTokens = 4096;
    form.maxCompletionTokens = 4096;
    expect(validateModelConfig(form).maxCompletionTokens).toMatch(/必须大于最大思考 token/);

    form.maxCompletionTokens = 2048;
    expect(validateModelConfig(form).maxCompletionTokens).toMatch(/必须大于最大思考 token/);

    form.maxCompletionTokens = 4097;
    expect(validateModelConfig(form).maxCompletionTokens).toBeUndefined();
  });

  it('requires the output cap to exceed the Anthropic thinking budget when reasoning is sent', () => {
    const form = createModelConfig('anthropic');
    form.apiReasoning = true;
    form.thinkingLevel = 'deep'; // tier budget 4096
    form.maxCompletionTokens = 4096;
    expect(validateModelConfig(form).maxCompletionTokens).toMatch(/Anthropic 思考预算（当前 4096）/);

    form.maxCompletionTokens = 8192;
    expect(validateModelConfig(form).maxCompletionTokens).toBeUndefined();

    // An explicit thinking cap raises the budget, but a larger output cap is
    // still fine; only the tier default can be violated with a custom cap.
    form.maxThinkingTokens = 4096;
    form.maxCompletionTokens = 4096;
    expect(validateModelConfig(form).maxCompletionTokens).toMatch(/必须大于最大思考 token/);
    form.maxCompletionTokens = 8192;
    expect(validateModelConfig(form).maxCompletionTokens).toBeUndefined();

    // The budget check only applies while provider-native reasoning is on.
    form.maxThinkingTokens = null;
    form.maxCompletionTokens = 2048;
    expect(validateModelConfig(form).maxCompletionTokens).toMatch(
      /Anthropic 思考预算（当前 4096）/,
    );
    form.apiReasoning = false;
    expect(validateModelConfig(form).maxCompletionTokens).toBeUndefined();
  });

  it('does not apply a budget rule when the level disables thinking', () => {
    const form = createModelConfig('anthropic');
    form.apiReasoning = true;
    form.thinkingLevel = 'off';
    form.maxCompletionTokens = MAX_COMPLETION_TOKENS_MIN;
    expect(validateModelConfig(form).maxCompletionTokens).toBeUndefined();
  });
});
