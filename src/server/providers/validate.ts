import type {
  GameSettings,
  ModelSetup,
  ProviderKind,
  Side,
  ThinkingLevel,
} from '../../shared/protocol';
import {
  DEFAULT_SETTINGS,
  DEFAULT_THINKING_LEVEL,
  MAX_COMPLETION_TOKENS_MAX,
  MAX_COMPLETION_TOKENS_MIN,
  MAX_THINKING_TOKENS_MAX,
  MAX_THINKING_TOKENS_MIN,
  REQUEST_TIMEOUT_MAX_SECONDS,
  REQUEST_TIMEOUT_MIN_SECONDS,
  THINKING_LEVELS,
  thinkingBudgetTokens,
} from '../../shared/protocol';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const PROVIDERS: readonly ProviderKind[] = ['openai', 'anthropic'];

/** Structural lookup implemented by the server-side model library. */
export interface ModelProfileLookup {
  resolveSetup(id: string): ModelSetup | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('接口地址必须是文本');
  }
  const raw = value.trim();
  if (!raw) {
    throw new ValidationError('请填写模型接口地址（Base URL）');
  }
  if (raw.length > 2048) {
    throw new ValidationError('接口地址过长');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('接口地址格式无效，请填写完整的 http(s) URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ValidationError('接口地址只支持 http 或 https');
  }
  if (url.username || url.password) {
    throw new ValidationError('接口地址中不能包含用户名或密码');
  }
  if (url.search || url.hash) {
    throw new ValidationError('接口地址不能包含查询参数或锚点');
  }

  const normalized = url.toString().replace(/\/+$/, '');
  if (!normalized) {
    throw new ValidationError('接口地址无效');
  }
  return normalized;
}

const THINKING_LEVEL_MAX_LENGTH = 64;
const THINKING_LEVELS_MAX = 16;

export function validateThinkingLevel(value: unknown): ThinkingLevel {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_THINKING_LEVEL;
  }
  if (typeof value !== 'string') {
    throw new ValidationError('思考强度必须是模型 API 返回的档位名称');
  }
  const level = value.trim();
  if (!level) {
    return DEFAULT_THINKING_LEVEL;
  }
  if (level.length > THINKING_LEVEL_MAX_LENGTH) {
    throw new ValidationError(`思考档位名称过长，最多 ${THINKING_LEVEL_MAX_LENGTH} 个字符`);
  }
  if (/[\u0000-\u001f\u007f]/.test(level)) {
    throw new ValidationError('思考档位名称包含无效字符');
  }
  return level;
}

/** Validate a library of levels discovered from a model API. */
export function validateThinkingLevels(value: unknown): ThinkingLevel[] {
  if (value === undefined || value === null) {
    return [...THINKING_LEVELS];
  }
  if (!Array.isArray(value)) {
    throw new ValidationError('思考档位列表必须是数组');
  }
  if (value.length === 0) {
    return [...THINKING_LEVELS];
  }
  if (value.length > THINKING_LEVELS_MAX) {
    throw new ValidationError(`思考档位最多 ${THINKING_LEVELS_MAX} 个`);
  }

  const levels: ThinkingLevel[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const level = validateThinkingLevel(raw);
    const key = level.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    levels.push(level);
  }
  return levels.length > 0 ? levels : [...THINKING_LEVELS];
}

export function validateApiReasoning(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  throw new ValidationError('API 推理参数开关必须是布尔值');
}

/** Whether the prompt must ask for the JSON `reason` field (default true). */
export function validateRequireReason(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  throw new ValidationError('要求输出理由开关必须是布尔值');
}

/** `null` means "follow the thinking tier" rather than an explicit limit. */
export function validateRequestTimeoutSeconds(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(
      `最大推理时长须为 ${REQUEST_TIMEOUT_MIN_SECONDS}–${REQUEST_TIMEOUT_MAX_SECONDS} 秒的整数`,
    );
  }
  if (value < REQUEST_TIMEOUT_MIN_SECONDS || value > REQUEST_TIMEOUT_MAX_SECONDS) {
    throw new ValidationError(
      `最大推理时长须在 ${REQUEST_TIMEOUT_MIN_SECONDS}–${REQUEST_TIMEOUT_MAX_SECONDS} 秒之间`,
    );
  }
  return value;
}

/** `null` means the prompt follows the API thinking level. */
export function validatePromptLevel(value: unknown): ThinkingLevel | null {
  if (value === undefined || value === null || value === '') return null;
  return validateThinkingLevel(value);
}

/** `null` means the provider/tier default thinking budget is used. */
export function validateMaxThinkingTokens(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(
      `最大思考 token 须为 ${MAX_THINKING_TOKENS_MIN}–${MAX_THINKING_TOKENS_MAX} 的整数`,
    );
  }
  if (value < MAX_THINKING_TOKENS_MIN || value > MAX_THINKING_TOKENS_MAX) {
    throw new ValidationError(
      `最大思考 token 须在 ${MAX_THINKING_TOKENS_MIN}–${MAX_THINKING_TOKENS_MAX} 之间`,
    );
  }
  return value;
}

/** `null` means no explicit completion-token cap is sent. */
export function validateMaxCompletionTokens(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ValidationError(
      `最大输出 token 须为 ${MAX_COMPLETION_TOKENS_MIN}–${MAX_COMPLETION_TOKENS_MAX} 的整数`,
    );
  }
  if (value < MAX_COMPLETION_TOKENS_MIN || value > MAX_COMPLETION_TOKENS_MAX) {
    throw new ValidationError(
      `最大输出 token 须在 ${MAX_COMPLETION_TOKENS_MIN}–${MAX_COMPLETION_TOKENS_MAX} 之间`,
    );
  }
  return value;
}

/**
 * Cross-field sanity check: a completion cap below the thinking budget would
 * leave no room for the visible JSON answer (Anthropic rejects it outright).
 */
export function validateTokenCaps(
  provider: ProviderKind,
  thinkingLevel: ThinkingLevel,
  apiReasoning: boolean,
  maxThinkingTokens: number | null,
  maxCompletionTokens: number | null,
): void {
  if (
    maxThinkingTokens !== null &&
    maxCompletionTokens !== null &&
    maxCompletionTokens <= maxThinkingTokens
  ) {
    throw new ValidationError('最大输出 token 必须大于最大思考 token');
  }
  if (provider !== 'anthropic' || !apiReasoning || maxCompletionTokens === null) {
    return;
  }
  const budget = thinkingBudgetTokens(thinkingLevel, maxThinkingTokens);
  if (budget !== null && maxCompletionTokens <= budget) {
    throw new ValidationError(
      `最大输出 token 必须大于 Anthropic 思考预算（当前 ${budget}）`,
    );
  }
}

function modelLabel(sideOrLabel: Side | string): string {
  if (sideOrLabel === 'red') return '红方';
  if (sideOrLabel === 'black') return '黑方';
  return sideOrLabel;
}

export function validateModelSetup(value: unknown, sideOrLabel: Side | string): ModelSetup {
  const input = record(value);
  if (!input) {
    throw new ValidationError(`${modelLabel(sideOrLabel)}配置缺失`);
  }

  const provider = input.provider;
  if (typeof provider !== 'string' || !PROVIDERS.includes(provider as ProviderKind)) {
    throw new ValidationError('接入协议必须是 openai 或 anthropic');
  }

  const model = typeof input.model === 'string' ? input.model.trim() : '';
  if (!model) {
    throw new ValidationError('请填写模型 ID');
  }
  if (model.length > 200) {
    throw new ValidationError('模型 ID 过长');
  }

  const apiKey = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
  if (apiKey.length > 8192) {
    throw new ValidationError('API Key 过长');
  }

  const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
  if (displayName.length > 80) {
    throw new ValidationError('模型显示名称过长');
  }

  const apiReasoning =
    input.apiReasoning === undefined || input.apiReasoning === null
      ? provider === 'openai'
      : validateApiReasoning(input.apiReasoning);

  const requestTimeoutSeconds = validateRequestTimeoutSeconds(input.requestTimeoutSeconds);
  const thinkingLevel = validateThinkingLevel(input.thinkingLevel);
  const promptLevel = validatePromptLevel(input.promptLevel);
  const maxThinkingTokens = validateMaxThinkingTokens(input.maxThinkingTokens);
  const maxCompletionTokens = validateMaxCompletionTokens(input.maxCompletionTokens);
  const requireReason = validateRequireReason(input.requireReason);
  validateTokenCaps(
    provider as ProviderKind,
    thinkingLevel,
    apiReasoning,
    maxThinkingTokens,
    maxCompletionTokens,
  );

  return {
    provider: provider as ProviderKind,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    model,
    apiKey,
    ...(displayName ? { displayName } : {}),
    thinkingLevel,
    apiReasoning,
    ...(promptLevel !== null ? { promptLevel } : {}),
    ...(maxThinkingTokens !== null ? { maxThinkingTokens } : {}),
    ...(maxCompletionTokens !== null ? { maxCompletionTokens } : {}),
    ...(requireReason ? {} : { requireReason: false }),
    ...(requestTimeoutSeconds !== null ? { requestTimeoutSeconds } : {}),
  };
}

/**
 * Resolve one side of a game. A `profileId` uses the saved model's endpoint and
 * secret on the server; thinking intensity may still be overridden per game.
 */
function resolveSideRequest(
  value: unknown,
  sideOrLabel: Side | string,
  profiles: ModelProfileLookup | undefined,
): ModelSetup {
  const input = record(value);
  if (input && Object.prototype.hasOwnProperty.call(input, 'profileId')) {
    if (!profiles) {
      throw new ValidationError(`${modelLabel(sideOrLabel)}暂不支持模型库选择`);
    }
    const profileId = typeof input.profileId === 'string' ? input.profileId.trim() : '';
    if (!profileId) {
      throw new ValidationError(`${modelLabel(sideOrLabel)}请选择要使用的模型`);
    }
    if (profileId.length > 128) {
      throw new ValidationError('模型引用无效');
    }
    const saved = profiles.resolveSetup(profileId);
    if (!saved) {
      throw new ValidationError(`${modelLabel(sideOrLabel)}选择的模型已不存在，请到模型库确认`);
    }
    const requestTimeoutSeconds =
      input.requestTimeoutSeconds === undefined
        ? saved.requestTimeoutSeconds ?? null
        : validateRequestTimeoutSeconds(input.requestTimeoutSeconds);
    const thinkingLevel =
      input.thinkingLevel === undefined
        ? saved.thinkingLevel ?? DEFAULT_THINKING_LEVEL
        : validateThinkingLevel(input.thinkingLevel);
    const apiReasoning =
      input.apiReasoning === undefined
        ? Boolean(saved.apiReasoning)
        : validateApiReasoning(input.apiReasoning);
    const promptLevel =
      input.promptLevel === undefined
        ? saved.promptLevel ?? null
        : validatePromptLevel(input.promptLevel);
    const maxThinkingTokens =
      input.maxThinkingTokens === undefined
        ? saved.maxThinkingTokens ?? null
        : validateMaxThinkingTokens(input.maxThinkingTokens);
    const maxCompletionTokens =
      input.maxCompletionTokens === undefined
        ? saved.maxCompletionTokens ?? null
        : validateMaxCompletionTokens(input.maxCompletionTokens);
    const requireReason =
      input.requireReason === undefined
        ? saved.requireReason !== false
        : validateRequireReason(input.requireReason);
    validateTokenCaps(
      saved.provider,
      thinkingLevel,
      apiReasoning,
      maxThinkingTokens,
      maxCompletionTokens,
    );
    return {
      ...saved,
      thinkingLevel,
      apiReasoning,
      ...(promptLevel !== null ? { promptLevel } : {}),
      ...(maxThinkingTokens !== null ? { maxThinkingTokens } : {}),
      ...(maxCompletionTokens !== null ? { maxCompletionTokens } : {}),
      requireReason,
      ...(requestTimeoutSeconds !== null ? { requestTimeoutSeconds } : {}),
    };
  }
  return validateModelSetup(value, sideOrLabel);
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function validateSettings(value: unknown): GameSettings {
  if (value === undefined || value === null) {
    return { ...DEFAULT_SETTINGS };
  }
  const input = record(value);
  if (!input) {
    throw new ValidationError('settings 必须是对象');
  }

  const rawDelay = numberOrUndefined(input.moveDelayMs);
  const rawAttempts = numberOrUndefined(input.maxAttempts);

  if (input.moveDelayMs !== undefined && rawDelay === undefined) {
    throw new ValidationError('落子间隔必须是数字');
  }
  if (input.maxAttempts !== undefined && rawAttempts === undefined) {
    throw new ValidationError('最大尝试次数必须是数字');
  }

  const moveDelayMs = Math.round(rawDelay ?? DEFAULT_SETTINGS.moveDelayMs);
  const maxAttempts = Math.round(rawAttempts ?? DEFAULT_SETTINGS.maxAttempts);

  if (moveDelayMs < 0 || moveDelayMs > 5000) {
    throw new ValidationError('落子间隔必须在 0 到 5000 毫秒之间');
  }
  if (maxAttempts < 1 || maxAttempts > 5) {
    throw new ValidationError('最大尝试次数必须在 1 到 5 之间');
  }

  return { moveDelayMs, maxAttempts };
}

export interface ValidatedStartRequest {
  red: ModelSetup;
  black: ModelSetup;
  settings: GameSettings;
}

export function validateStartRequest(
  body: unknown,
  profiles?: ModelProfileLookup,
): ValidatedStartRequest {
  const input = record(body);
  if (!input) {
    throw new ValidationError('请求体必须是 JSON 对象');
  }
  return {
    red: resolveSideRequest(input.red, 'red', profiles),
    black: resolveSideRequest(input.black, 'black', profiles),
    settings: validateSettings(input.settings),
  };
}
