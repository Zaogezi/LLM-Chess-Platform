import type { ModelSetup, ProviderKind, Side, ThinkingLevel } from '../shared/protocol';
import { DEFAULT_THINKING_LEVELS, DEFAULT_THINKING_LEVEL } from '../shared/protocol';

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
}

export type ModelConfigErrors = Partial<Record<'provider' | 'baseUrl' | 'model', string>>;

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
  };
}
