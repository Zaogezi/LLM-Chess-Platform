import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {
  ModelProfileView,
  ModelSetup,
  ProviderKind,
  ThinkingLevel,
} from '../../shared/protocol';
import {
  DEFAULT_THINKING_LEVEL,
  MODEL_PROFILE_NAME_MAX,
  MODEL_PROFILES_MAX,
} from '../../shared/protocol';
import {
  ValidationError,
  validateModelSetup,
  validateThinkingLevels,
} from '../providers/validate';

export interface ModelProfileStoreOptions {
  /**
   * JSON file path. Pass null for an in-memory store (tests). When omitted,
   * profiles are kept in `data/models.json` under the process working dir.
   */
  filePath?: string | null;
}

/** Server-only record. `apiKey` must never leave this module as-is. */
interface StoredModelProfile {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  apiReasoning: boolean;
  createdAt: number;
  updatedAt: number;
}

interface ModelProfileFile {
  version: 1;
  profiles: StoredModelProfile[];
}

export interface ValidatedProfileFields {
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  apiReasoning: boolean;
}

export interface ValidatedProfileCreate extends ValidatedProfileFields {
  apiKey: string;
}

export type ApiKeyUpdate =
  | { mode: 'keep' }
  | { mode: 'clear' }
  | { mode: 'replace'; value: string };

export interface ValidatedProfileUpdate extends ValidatedProfileFields {
  apiKey: ApiKeyUpdate;
}

const DEFAULT_FILE = path.resolve(process.cwd(), 'data', 'models.json');

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validateName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ValidationError('模型名称必须是文本');
  }
  const name = value.trim();
  if (!name) {
    throw new ValidationError('请填写模型名称');
  }
  if (name.length > MODEL_PROFILE_NAME_MAX) {
    throw new ValidationError(`模型名称过长，最多 ${MODEL_PROFILE_NAME_MAX} 个字符`);
  }
  return name;
}

function validateFields(value: unknown): ValidatedProfileFields {
  const input = asRecord(value);
  if (!input) {
    throw new ValidationError('模型配置必须是 JSON 对象');
  }
  const setup = validateModelSetup(input, '模型');
  const levels = ensureLevelSelected(
    validateThinkingLevels(input.thinkingLevels),
    setup.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
  );
  return {
    name: validateName(input.name),
    provider: setup.provider,
    baseUrl: setup.baseUrl,
    model: setup.model,
    thinkingLevel: levels.selected,
    thinkingLevels: levels.levels,
    apiReasoning: Boolean(setup.apiReasoning),
  };
}

/** Make sure the selected level is selectable in the saved option list. */
function ensureLevelSelected(
  levels: ThinkingLevel[],
  selected: ThinkingLevel,
): { levels: ThinkingLevel[]; selected: ThinkingLevel } {
  const match = levels.find(
    (level) => level.toLocaleLowerCase() === selected.toLocaleLowerCase(),
  );
  if (match) {
    return { levels, selected: match };
  }
  const next = [selected, ...levels];
  return {
    levels: next.slice(0, 16),
    selected,
  };
}

function validateApiKeyText(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`${field}必须是文本`);
  }
  const apiKey = value.trim();
  if (apiKey.length > 8192) {
    throw new ValidationError('API Key 过长');
  }
  return apiKey;
}

export function validateProfileCreate(value: unknown): ValidatedProfileCreate {
  const fields = validateFields(value);
  const input = asRecord(value)!;
  return {
    ...fields,
    apiKey:
      input.apiKey === undefined || input.apiKey === null
        ? ''
        : validateApiKeyText(input.apiKey, 'API Key'),
  };
}

export function validateProfileUpdate(value: unknown): ValidatedProfileUpdate {
  const fields = validateFields(value);
  const input = asRecord(value)!;

  let clearApiKey = false;
  if (input.clearApiKey !== undefined && input.clearApiKey !== null) {
    if (typeof input.clearApiKey !== 'boolean') {
      throw new ValidationError('清除密钥标记必须是布尔值');
    }
    clearApiKey = input.clearApiKey;
  }

  const hasApiKey = input.apiKey !== undefined && input.apiKey !== null;
  const apiKeyText = hasApiKey ? validateApiKeyText(input.apiKey, 'API Key') : '';

  if (clearApiKey && apiKeyText.length > 0) {
    throw new ValidationError('不能同时填写新 API Key 和清除密钥');
  }

  const apiKey: ApiKeyUpdate = clearApiKey
    ? { mode: 'clear' }
    : hasApiKey
      ? { mode: 'replace', value: apiKeyText }
      : { mode: 'keep' };

  return { ...fields, apiKey };
}

function keyHint(apiKey: string): string | null {
  if (!apiKey) return null;
  const visible = apiKey.length >= 8 ? apiKey.slice(-4) : '';
  return visible ? `••••${visible}` : '••••';
}

function toView(profile: StoredModelProfile): ModelProfileView {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    baseUrl: profile.baseUrl,
    model: profile.model,
    thinkingLevel: profile.thinkingLevel,
    thinkingLevels: [...profile.thinkingLevels],
    apiReasoning: profile.apiReasoning,
    keyConfigured: Boolean(profile.apiKey),
    keyHint: keyHint(profile.apiKey),
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function isStoredProfile(value: unknown): value is StoredModelProfile {
  const profile = asRecord(value);
  return Boolean(
    profile &&
      typeof profile.id === 'string' &&
      profile.id.length > 0 &&
      typeof profile.name === 'string' &&
      profile.name.trim().length > 0 &&
      (profile.provider === 'openai' || profile.provider === 'anthropic') &&
      typeof profile.baseUrl === 'string' &&
      typeof profile.model === 'string' &&
      profile.model.trim().length > 0 &&
      typeof profile.apiKey === 'string' &&
      typeof profile.thinkingLevel === 'string' &&
      profile.thinkingLevel.trim().length > 0 &&
      (profile.thinkingLevels === undefined || Array.isArray(profile.thinkingLevels)) &&
      typeof profile.apiReasoning === 'boolean' &&
      typeof profile.createdAt === 'number' &&
      typeof profile.updatedAt === 'number',
  );
}

/**
 * Persistent model library. Secrets are held only here and in the server-side
 * request resolver; `list()` always returns redacted views.
 */
export class ModelProfileStore {
  private readonly filePath: string | null;
  private profiles: StoredModelProfile[] = [];

  constructor(options: ModelProfileStoreOptions = {}) {
    this.filePath =
      options.filePath === undefined
        ? DEFAULT_FILE
        : options.filePath === null
          ? null
          : path.resolve(options.filePath);
    this.load();
  }

  get size(): number {
    return this.profiles.length;
  }

  list(): ModelProfileView[] {
    return this.profiles.map(toView);
  }

  find(id: string): ModelProfileView | null {
    const profile = this.profiles.find((item) => item.id === id);
    return profile ? toView(profile) : null;
  }

  has(id: string): boolean {
    return this.profiles.some((item) => item.id === id);
  }

  /**
   * Server-only resolution for starting games. The returned setup contains the
   * stored API key and must never be serialized into a public response.
   */
  resolveSetup(id: string): ModelSetup | null {
    const profile = this.profiles.find((item) => item.id === id);
    if (!profile) return null;
    return {
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      apiKey: profile.apiKey,
      displayName: profile.name,
      thinkingLevel: profile.thinkingLevel,
      apiReasoning: profile.apiReasoning,
    };
  }

  create(input: ValidatedProfileCreate): ModelProfileView {
    if (this.profiles.length >= MODEL_PROFILES_MAX) {
      throw new ValidationError(`模型库最多保存 ${MODEL_PROFILES_MAX} 个模型`);
    }
    this.assertNameAvailable(input.name, null);

    const now = Date.now();
    const profile: StoredModelProfile = {
      id: randomUUID(),
      name: input.name,
      provider: input.provider,
      baseUrl: input.baseUrl,
      model: input.model,
      apiKey: input.apiKey,
      thinkingLevel: input.thinkingLevel,
      thinkingLevels: [...input.thinkingLevels],
      apiReasoning: input.apiReasoning,
      createdAt: now,
      updatedAt: now,
    };

    this.profiles.push(profile);
    this.persist();
    return toView(profile);
  }

  update(id: string, input: ValidatedProfileUpdate): ModelProfileView | null {
    const profile = this.profiles.find((item) => item.id === id);
    if (!profile) return null;
    this.assertNameAvailable(input.name, id);

    profile.name = input.name;
    profile.provider = input.provider;
    profile.baseUrl = input.baseUrl;
    profile.model = input.model;
    profile.thinkingLevel = input.thinkingLevel;
    profile.thinkingLevels = [...input.thinkingLevels];
    profile.apiReasoning = input.apiReasoning;
    if (input.apiKey.mode === 'replace') {
      profile.apiKey = input.apiKey.value;
    } else if (input.apiKey.mode === 'clear') {
      profile.apiKey = '';
    }
    profile.updatedAt = Date.now();

    this.persist();
    return toView(profile);
  }

  remove(id: string): boolean {
    const index = this.profiles.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.profiles.splice(index, 1);
    this.persist();
    return true;
  }

  private assertNameAvailable(name: string, exceptId: string | null): void {
    const normalized = name.toLocaleLowerCase();
    const duplicate = this.profiles.find(
      (profile) => profile.id !== exceptId && profile.name.toLocaleLowerCase() === normalized,
    );
    if (duplicate) {
      throw new ValidationError(`模型名称已存在：${duplicate.name}`);
    }
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      console.error(
        '[models] failed to read model library; starting empty:',
        error instanceof Error ? error.message : error,
      );
      return;
    }

    const file = asRecord(parsed);
    const rawProfiles = file?.profiles;
    if (!Array.isArray(rawProfiles)) {
      console.error('[models] invalid model library file; starting empty');
      return;
    }

    const loaded: StoredModelProfile[] = [];
    for (const raw of rawProfiles) {
      if (!isStoredProfile(raw)) {
        console.warn('[models] skipped an invalid saved model entry');
        continue;
      }
      if (loaded.some((profile) => profile.name.toLocaleLowerCase() === raw.name.toLocaleLowerCase())) {
        console.warn('[models] skipped a duplicate saved model name:', raw.name);
        continue;
      }
      try {
        const selected = ensureLevelSelected(
          validateThinkingLevels(raw.thinkingLevels),
          raw.thinkingLevel,
        );
        loaded.push({
          id: raw.id,
          name: raw.name.trim(),
          provider: raw.provider,
          baseUrl: raw.baseUrl,
          model: raw.model.trim(),
          apiKey: raw.apiKey,
          thinkingLevel: selected.selected,
          thinkingLevels: selected.levels,
          apiReasoning: raw.apiReasoning,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        });
      } catch {
        console.warn('[models] skipped a saved model with invalid thinking levels');
      }
    }
    this.profiles = loaded.slice(0, MODEL_PROFILES_MAX);
  }

  private persist(): void {
    if (!this.filePath) return;

    const directory = path.dirname(this.filePath);
    mkdirSync(directory, { recursive: true });

    const payload: ModelProfileFile = { version: 1, profiles: this.profiles };
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporary, this.filePath);
      try {
        chmodSync(this.filePath, 0o600);
      } catch {
        // Windows may not support POSIX file modes; the file remains local.
      }
    } catch (error) {
      console.error(
        '[models] failed to persist model library:',
        error instanceof Error ? error.message : error,
      );
      throw new Error('保存模型库失败，请检查数据目录权限');
    }
  }
}
