import type { ModelSetup, ProviderKind, Side, ThinkingLevel } from '../shared/protocol';
import {
  DEFAULT_THINKING_LEVELS,
  DEFAULT_THINKING_LEVEL,
  MAX_COMPLETION_TOKENS_MAX,
  MAX_COMPLETION_TOKENS_MIN,
  MAX_THINKING_TOKENS_MAX,
  MAX_THINKING_TOKENS_MIN,
  REQUEST_TIMEOUT_MAX_SECONDS,
  REQUEST_TIMEOUT_MIN_SECONDS,
  thinkingBudgetTokens,
} from '../shared/protocol';

export type PresetKey =
  | 'deepseek'
  | 'openai'
  | 'anthropic'
  | 'moonshot'
  | 'zhipu'
  | 'openrouter'
  | 'ollama'
  | 'custom';

export interface Preset {
  key: PresetKey;
  label: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
}

export const PRESETS: readonly Preset[] = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    key: 'openai',
    label: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    key: 'anthropic',
    label: 'Anthropic',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-20250514',
  },
  {
    key: 'moonshot',
    label: 'Moonshot',
    provider: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
  },
  {
    key: 'zhipu',
    label: '智谱',
    provider: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
  },
  {
    key: 'openrouter',
    label: 'OpenRouter',
    provider: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
  },
  {
    key: 'ollama',
    label: 'Ollama 本地',
    provider: 'openai',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5:7b',
  },
  {
    key: 'custom',
    label: '自定义',
    provider: 'openai',
    baseUrl: '',
    model: '',
  },
];

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic',
};

export const PROVIDER_OPTIONS: readonly ProviderKind[] = ['openai', 'anthropic'];

export const DEFAULT_PRESET_BY_SIDE: Record<Side, PresetKey> = {
  red: 'deepseek',
  black: 'openai',
};

export interface ModelConfigForm {
  preset: PresetKey;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  /** Selectable levels; the built-ins until the model API provides its own. */
  thinkingOptions: ThinkingLevel[];
  apiReasoning: boolean;
  apiKey: string;
  showKey: boolean;
  /** In-app prompt intensity; null follows the API thinking level. */
  promptLevel: ThinkingLevel | null;
  /** Hard provider thinking-token cap; null uses the thinking-tier default. */
  maxThinkingTokens: number | null;
  /** Hard total-output cap; null sends no cap. */
  maxCompletionTokens: number | null;
  /** Independent per-step wait override; null follows the thinking tier. */
  requestTimeoutSeconds: number | null;
}

export type ModelConfigErrors = Partial<
  Record<
    | 'provider'
    | 'baseUrl'
    | 'model'
    | 'maxThinkingTokens'
    | 'maxCompletionTokens'
    | 'requestTimeoutSeconds',
    string
  >
>;

export function presetByKey(key: PresetKey): Preset {
  return PRESETS.find((preset) => preset.key === key) ?? PRESETS[PRESETS.length - 1];
}

export function createModelConfig(presetKey: PresetKey): ModelConfigForm {
  const preset = presetByKey(presetKey);
  return {
    preset: preset.key,
    provider: preset.provider,
    baseUrl: preset.baseUrl,
    model: preset.model,
    thinkingLevel: DEFAULT_THINKING_LEVEL,
    thinkingOptions: [...DEFAULT_THINKING_LEVELS],
    // OpenAI-protocol models send reasoning_effort by default; the checkbox
    // remains available for gateways that reject the parameter.
    apiReasoning: preset.provider === 'openai',
    apiKey: '',
    showKey: false,
    promptLevel: null,
    maxThinkingTokens: null,
    maxCompletionTokens: null,
    requestTimeoutSeconds: null,
  };
}

export function validateModelConfig(form: ModelConfigForm): ModelConfigErrors {
  const errors: ModelConfigErrors = {};

  if (form.provider !== 'openai' && form.provider !== 'anthropic') {
    errors.provider = '请选择有效的接口协议。';
  }

  const baseUrl = form.baseUrl.trim();
  if (!baseUrl) {
    errors.baseUrl = '请填写 API Base URL。';
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(baseUrl);
    } catch {
      parsed = null;
    }

    if (!parsed) {
      errors.baseUrl = '地址格式不正确，应以 http:// 或 https:// 开头。';
    } else if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      errors.baseUrl = '仅支持 http 或 https 地址。';
    }
  }

  if (!form.model.trim()) {
    errors.model = '请填写模型 ID。';
  }

  const maxThinkingTokens = form.maxThinkingTokens;
  if (
    maxThinkingTokens !== null &&
    (!Number.isInteger(maxThinkingTokens) ||
      maxThinkingTokens < MAX_THINKING_TOKENS_MIN ||
      maxThinkingTokens > MAX_THINKING_TOKENS_MAX)
  ) {
    errors.maxThinkingTokens = `最大思考 token 须为 ${MAX_THINKING_TOKENS_MIN}–${MAX_THINKING_TOKENS_MAX} 的整数。`;
  }

  const maxCompletionTokens = form.maxCompletionTokens;
  if (
    maxCompletionTokens !== null &&
    (!Number.isInteger(maxCompletionTokens) ||
      maxCompletionTokens < MAX_COMPLETION_TOKENS_MIN ||
      maxCompletionTokens > MAX_COMPLETION_TOKENS_MAX)
  ) {
    errors.maxCompletionTokens = `最大输出 token 须为 ${MAX_COMPLETION_TOKENS_MIN}–${MAX_COMPLETION_TOKENS_MAX} 的整数。`;
  }

  // Cross-field checks only run on values that already passed their own range.
  if (!errors.maxThinkingTokens && !errors.maxCompletionTokens) {
    if (
      maxThinkingTokens !== null &&
      maxCompletionTokens !== null &&
      maxCompletionTokens <= maxThinkingTokens
    ) {
      errors.maxCompletionTokens = '最大输出 token 必须大于最大思考 token。';
    }

    if (
      !errors.maxCompletionTokens &&
      form.provider === 'anthropic' &&
      form.apiReasoning &&
      maxCompletionTokens !== null
    ) {
      // Anthropic requires thinking.budget_tokens < max_tokens so the visible
      // JSON answer still has room; the budget defaults to the tier value.
      const budget = thinkingBudgetTokens(form.thinkingLevel, maxThinkingTokens);
      if (budget !== null && maxCompletionTokens <= budget) {
        errors.maxCompletionTokens = `最大输出 token 必须大于 Anthropic 思考预算（当前 ${budget}）。`;
      }
    }
  }

  const timeout = form.requestTimeoutSeconds;
  if (
    timeout !== null &&
    (!Number.isInteger(timeout) ||
      timeout < REQUEST_TIMEOUT_MIN_SECONDS ||
      timeout > REQUEST_TIMEOUT_MAX_SECONDS)
  ) {
    errors.requestTimeoutSeconds = `最大推理时长须为 ${REQUEST_TIMEOUT_MIN_SECONDS}–${REQUEST_TIMEOUT_MAX_SECONDS} 秒的整数。`;
  }

  return errors;
}

export function toModelSetup(form: ModelConfigForm): ModelSetup {
  return {
    provider: form.provider,
    baseUrl: form.baseUrl.trim(),
    model: form.model.trim(),
    thinkingLevel: form.thinkingLevel,
    apiReasoning: form.apiReasoning,
    apiKey: form.apiKey,
    promptLevel: form.promptLevel,
    maxThinkingTokens: form.maxThinkingTokens,
    maxCompletionTokens: form.maxCompletionTokens,
    requestTimeoutSeconds: form.requestTimeoutSeconds,
  };
}
