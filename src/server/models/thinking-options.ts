import type {
  ModelSetup,
  ThinkingLevel,
  ThinkingOptionsResponse,
  ThinkingOptionsSource,
} from '../../shared/protocol';
import {
  DEFAULT_OPENAI_REASONING_EFFORT,
  DEFAULT_THINKING_LEVEL,
  OPENAI_REASONING_EFFORTS,
  THINKING_LEVELS,
} from '../../shared/protocol';
import { resolveEndpoint } from '../providers/endpoint';
import type { ModelProfileLookup } from '../providers/validate';
import { ValidationError, validateModelSetup } from '../providers/validate';

const METADATA_TIMEOUT_MS = 8_000;
const REASONING_PROBE_TIMEOUT_MS = 15_000;
const LEVEL_MAX_LENGTH = 64;
const LEVELS_MAX = 16;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textLevel(value: unknown): ThinkingLevel | null {
  if (typeof value === 'boolean') {
    return value ? 'on' : 'off';
  }
  if (typeof value !== 'string') return null;
  const level = value.trim();
  if (!level || level.length > LEVEL_MAX_LENGTH) return null;
  if (/[\u0000-\u001f\u007f]/.test(level)) return null;
  return level;
}

function uniqueLevels(values: unknown): ThinkingLevel[] {
  if (!Array.isArray(values)) return [];
  const levels: ThinkingLevel[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const level = textLevel(value);
    if (!level) continue;
    const key = level.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    levels.push(level);
    if (levels.length >= LEVELS_MAX) break;
  }
  return levels;
}

function preferredDefault(
  rawDefault: unknown,
  options: ThinkingLevel[],
): ThinkingLevel | null {
  const preferred = textLevel(rawDefault);
  if (preferred) {
    const match = options.find(
      (option) => option.toLocaleLowerCase() === preferred.toLocaleLowerCase(),
    );
    return match ?? preferred;
  }
  return options[0] ?? null;
}

function buildResponse(
  source: ThinkingOptionsSource,
  options: ThinkingLevel[],
  defaultLevel: ThinkingLevel | null,
  note: string,
): ThinkingOptionsResponse {
  if (options.length === 0) {
    return {
      source: 'fallback',
      options: [...THINKING_LEVELS],
      defaultLevel: DEFAULT_THINKING_LEVEL,
      note,
    };
  }
  return { source, options, defaultLevel, note };
}

function fallback(note: string): ThinkingOptionsResponse {
  return buildResponse('fallback', [...THINKING_LEVELS], DEFAULT_THINKING_LEVEL, note);
}

async function getJson(
  url: string,
  init: RequestInit = {},
  timeoutMs = METADATA_TIMEOUT_MS,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: 'application/json',
      'user-agent': 'ChuHeLunYi/1.0 (+local xiangqi model arena)',
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`元数据接口返回 HTTP ${response.status}`);
  }
  return (await response.json()) as unknown;
}

function authHeaders(setup: ModelSetup): Record<string, string> {
  if (!setup.apiKey) return {};
  if (setup.provider === 'anthropic') {
    return {
      'x-api-key': setup.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return { authorization: `Bearer ${setup.apiKey}` };
}

function parseThinkingObject(
  value: unknown,
): { levels: ThinkingLevel[]; defaultLevel: ThinkingLevel | null } {
  const record = asRecord(value);
  if (!record) return { levels: [], defaultLevel: null };
  const levels = uniqueLevels(record.values ?? record.levels ?? record.supported_efforts);
  return {
    levels,
    defaultLevel: preferredDefault(
      record.default ?? record.default_effort ?? record.defaultEffort,
      levels,
    ),
  };
}

function parseMetadataModel(model: Record<string, unknown>): {
  levels: ThinkingLevel[];
  defaultLevel: ThinkingLevel | null;
} {
  const thinking = parseThinkingObject(model.thinking);
  if (thinking.levels.length > 0) return thinking;

  const reasoning = parseThinkingObject(model.reasoning);
  if (reasoning.levels.length > 0) return reasoning;

  const direct = uniqueLevels(
    model.thinkingLevels ??
      model.thinking_levels ??
      model.reasoning_efforts ??
      model.supported_reasoning_efforts,
  );
  if (direct.length > 0) {
    return {
      levels: direct,
      defaultLevel: preferredDefault(
        model.default_thinking_level ?? model.default_reasoning_effort,
        direct,
      ),
    };
  }

  const capabilities = asRecord(model.capabilities);
  if (capabilities) {
    const nestedThinking = parseThinkingObject(capabilities.thinking);
    if (nestedThinking.levels.length > 0) return nestedThinking;
    const nestedReasoning = parseThinkingObject(capabilities.reasoning);
    if (nestedReasoning.levels.length > 0) return nestedReasoning;
  }

  return { levels: [], defaultLevel: null };
}

async function probeOllama(setup: ModelSetup): Promise<ThinkingOptionsResponse | null> {
  let url: URL;
  try {
    url = new URL(setup.baseUrl);
  } catch {
    return null;
  }
  url.pathname =
    url.pathname
      .replace(/\/chat\/completions\/?$/, '')
      .replace(/\/v1\/?$/, '')
      .replace(/\/+$/, '') || '/';
  url.search = '';
  url.hash = '';
  const root = url.toString().replace(/\/$/, '');

  let payload: unknown;
  try {
    payload = await getJson(
      `${root}/api/show`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authHeaders(setup),
        },
        body: JSON.stringify({ model: setup.model }),
      },
      4_000,
    );
  } catch {
    return null;
  }

  const record = asRecord(payload);
  const thinking = parseThinkingObject(record?.thinking);
  if (thinking.levels.length === 0) return null;

  return buildResponse(
    'ollama',
    thinking.levels,
    thinking.defaultLevel,
    `已从 Ollama 读取「${setup.model}」支持的思考档位。`,
  );
}

function metadataUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/models')) return trimmed;
  if (trimmed.endsWith('/chat/completions')) {
    return `${trimmed.slice(0, -'/chat/completions'.length)}/models`;
  }
  return resolveEndpoint(trimmed, 'models');
}

async function probeOpenAiCompatible(
  setup: ModelSetup,
): Promise<ThinkingOptionsResponse | null> {
  let payload: unknown;
  try {
    payload = await getJson(metadataUrl(setup.baseUrl), {
      headers: authHeaders(setup),
    });
  } catch {
    return null;
  }

  const root = asRecord(payload);
  const rawModels = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.models)
        ? root.models
        : [];
  const models = rawModels
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null);

  const needle = setup.model.toLocaleLowerCase();
  const model =
    models.find((item) => typeof item.id === 'string' && item.id.toLocaleLowerCase() === needle) ??
    models.find((item) => typeof item.id === 'string' && item.id.toLocaleLowerCase().endsWith(needle)) ??
    null;

  if (model) {
    const parsed = parseMetadataModel(model);
    if (parsed.levels.length > 0) {
      const params = Array.isArray(model.supported_parameters)
        ? model.supported_parameters.filter((param): param is string => typeof param === 'string')
        : [];
      const source: ThinkingOptionsSource = params.includes('reasoning_effort')
        ? 'openrouter'
        : 'api';
      return buildResponse(
        source,
        parsed.levels,
        parsed.defaultLevel,
        `已从模型 API 读取「${setup.model}」支持的思考档位。`,
      );
    }

    const supported = Array.isArray(model.supported_parameters)
      ? model.supported_parameters.filter((param): param is string => typeof param === 'string')
      : [];
    if (supported.includes('reasoning_effort')) {
      const levels = ['minimal', 'low', 'medium', 'high'];
      return buildResponse(
        'openrouter',
        levels,
        'medium',
        'API 声明支持 reasoning_effort，但未列出具体档位；已显示标准思考档位。',
      );
    }
  }

  return null;
}

function hasReasoningOutput(payload: unknown): boolean {
  const root = asRecord(payload);
  if (!root) return false;

  const choices = Array.isArray(root.choices) ? root.choices : [];
  for (const rawChoice of choices) {
    const choice = asRecord(rawChoice);
    if (!choice) continue;
    const message = asRecord(choice.message);
    const providerFields = asRecord(
      message?.provider_specific_fields ?? choice.provider_specific_fields,
    );
    const candidates: unknown[] = [
      message?.reasoning_content,
      choice.reasoning_content,
      providerFields?.reasoning_content,
      message?.reasoning,
      choice.reasoning,
    ];
    if (
      candidates.some(
        (value) => typeof value === 'string' && value.trim().length > 0,
      )
    ) {
      return true;
    }
  }

  const usage = asRecord(root.usage);
  for (const key of ['completion_tokens_details', 'output_tokens_details']) {
    const details = asRecord(usage?.[key]);
    const reasoningTokens = details?.reasoning_tokens;
    if (
      typeof reasoningTokens === 'number' &&
      Number.isFinite(reasoningTokens) &&
      reasoningTokens > 0
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Some OpenAI-compatible gateways (for example the Paratera LiteLLM proxy) keep
 * `/models` deliberately minimal and never publish reasoning capabilities. When
 * the catalog is silent, send one tiny reasoning request and look for actual
 * reasoning output/tokens. This costs only a handful of tokens and lets those
 * APIs expose the standard reasoning_effort levels instead of falling back to
 * the built-in names.
 */
async function probeReasoningSupport(
  setup: ModelSetup,
): Promise<ThinkingOptionsResponse | null> {
  let endpoint: string;
  try {
    endpoint = resolveEndpoint(setup.baseUrl, 'chat/completions');
  } catch {
    return null;
  }

  let payload: unknown;
  try {
    payload = await getJson(
      endpoint,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authHeaders(setup),
        },
        body: JSON.stringify({
          model: setup.model,
          messages: [
            {
              role: 'user',
              content: 'What is 17 * 23? Reply with the number only.',
            },
          ],
          stream: false,
          max_tokens: 16,
          reasoning_effort: 'medium',
        }),
      },
      REASONING_PROBE_TIMEOUT_MS,
    );
  } catch {
    return null;
  }

  if (!hasReasoningOutput(payload)) return null;

  return buildResponse(
    'api',
    [...OPENAI_REASONING_EFFORTS],
    DEFAULT_OPENAI_REASONING_EFFORT,
    '模型目录未提供推理档位；已通过一次最小推理请求检测到该模型会产生推理输出，已列出通用 reasoning_effort 档位。',
  );
}

/**
 * Best-effort discovery of a model's thinking levels. Ollama exposes them via
 * `/api/show`; OpenRouter and compatible catalogs may expose efforts inside
 * `/models`; otherwise one tiny reasoning request can confirm support for
 * `reasoning_effort`. Unsupported services fall back to the built-in levels.
 */
export async function fetchThinkingOptions(
  setup: ModelSetup,
): Promise<ThinkingOptionsResponse> {
  if (setup.provider !== 'anthropic') {
    const ollama = await probeOllama(setup);
    if (ollama) return ollama;
  }

  const metadata = await probeOpenAiCompatible(setup);
  if (metadata) return metadata;

  if (setup.provider !== 'anthropic') {
    const probed = await probeReasoningSupport(setup);
    if (probed) return probed;

    // Every Chat Completions model can be configured with the standard
    // reasoning_effort values, even when the service publishes no metadata and
    // the probe cannot observe reasoning output.
    return buildResponse(
      'fallback',
      [...OPENAI_REASONING_EFFORTS],
      DEFAULT_OPENAI_REASONING_EFFORT,
      '未能从 API 确认该模型的推理输出；OpenAI 协议模型仍统一提供 minimal / low / medium / high，开启「发送 OpenAI 兼容推理参数」后按 reasoning_effort 发送。',
    );
  }

  return fallback(
    '未能从 API 读取到该模型的思考档位（模型目录未提供档位，推理检测也未发现推理输出），已保留内置档位；仍可正常对弈。',
  );
}

/** Validate a metadata lookup request; profile selections can reuse the stored key. */
export function validateThinkingOptionsRequest(
  body: unknown,
  profiles: ModelProfileLookup | undefined,
): ModelSetup {
  const input = asRecord(body);
  if (!input) {
    throw new ValidationError('请求体必须是 JSON 对象');
  }

  const profileId =
    typeof input.profileId === 'string' ? input.profileId.trim() : '';
  let saved: ModelSetup | null = null;
  if (profileId) {
    if (!profiles) {
      throw new ValidationError('当前服务暂不支持模型库');
    }
    saved = profiles.resolveSetup(profileId);
    if (!saved) {
      throw new ValidationError('所选模型已不存在，请重新选择');
    }
  }

  const hasFields =
    input.provider !== undefined || input.baseUrl !== undefined || input.model !== undefined;
  if (!hasFields && saved) {
    return saved;
  }

  const setup = validateModelSetup(input, '模型');
  if (saved && !setup.apiKey) {
    setup.apiKey = saved.apiKey;
  }
  return setup;
}
