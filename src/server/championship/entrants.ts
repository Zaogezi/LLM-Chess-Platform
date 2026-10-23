import type { ModelSetup } from '../../shared/protocol';
import type { ModelProfileLookup } from '../providers/validate';
import {
  ValidationError,
  validateApiReasoning,
  validateModelSetup,
  validateThinkingLevel,
} from '../providers/validate';

/** Shared limits for every championship-related entrant name/profile reference. */
export const ENTRANT_NAME_MAX = 80;
export const PROFILE_ID_MAX = 128;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

export function validateEntrantName(raw: unknown, label: string): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) {
    throw new ValidationError(`请为${label}填写名称`);
  }
  if (name.length > ENTRANT_NAME_MAX) {
    throw new ValidationError(`${label}的名称过长`);
  }
  return name;
}

/**
 * Resolve one entrant's runtime setup from either a saved model-library
 * reference (`profileId`) or an inline model configuration. Per-entrant
 * thinking overrides are applied on top of the resolved profile.
 */
export function resolveEntrantSetup(
  item: Record<string, unknown>,
  label: string,
  name: string,
  profiles: ModelProfileLookup | undefined,
): ModelSetup {
  if (!hasOwn(item, 'profileId')) {
    return validateModelSetup(item, label);
  }
  if (!profiles) {
    throw new ValidationError(`${label}暂不支持模型库选择`);
  }
  const profileId = typeof item.profileId === 'string' ? item.profileId.trim() : '';
  if (!profileId) {
    throw new ValidationError(`请为${label}选择模型库配置`);
  }
  if (profileId.length > PROFILE_ID_MAX) {
    throw new ValidationError(`${label}的模型引用无效`);
  }
  const saved = profiles.resolveSetup(profileId);
  if (!saved) {
    throw new ValidationError(`${label}（${name}）的模型库配置已不存在，请重新选择`);
  }
  return {
    ...saved,
    thinkingLevel:
      item.thinkingLevel === undefined
        ? saved.thinkingLevel
        : validateThinkingLevel(item.thinkingLevel),
    apiReasoning:
      item.apiReasoning === undefined
        ? Boolean(saved.apiReasoning)
        : validateApiReasoning(item.apiReasoning),
  };
}
