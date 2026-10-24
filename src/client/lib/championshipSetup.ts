import type {
  ChampionshipGroupId,
  ChampionshipSetupDraft,
  ChampionshipSetupDraw,
  ChampionshipSetupSnapshot,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_ENTRANTS,
  CHAMPIONSHIP_ENTRANTS_PER_POOL,
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_MAX_CONCURRENCY,
  CHAMPIONSHIP_MIN_CONCURRENCY,
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_SEED_POOLS,
} from '../../shared/protocol';
import type { PresetKey } from '../presets';
import type { ChampionshipDraft, ChampionshipDraw } from './championship';

/**
 * The fixed number of seats on the championship setup board: 12 seeded seats
 * plus the ten qualifying seats. Kept local to avoid importing the client
 * championship lib for a value.
 */
export const CHAMPIONSHIP_SETUP_DRAFT_COUNT =
  CHAMPIONSHIP_ENTRANTS -
  CHAMPIONSHIP_ENTRANTS_PER_POOL +
  CHAMPIONSHIP_QUALIFIER_ENTRANTS;

const PRESET_KEYS: ReadonlySet<string> = new Set<PresetKey>([
  'deepseek',
  'openai',
  'anthropic',
  'moonshot',
  'zhipu',
  'openrouter',
  'ollama',
  'custom',
]);

const PROVIDERS = new Set<string>(['openai', 'anthropic']);
const GROUP_IDS = new Set<string>(CHAMPIONSHIP_GROUPS);
const SEED_POOLS = new Set<number>(CHAMPIONSHIP_SEED_POOLS);
const QUALIFIER_GROUPS = new Set<string>(['A', 'B']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isGroupId(value: unknown): value is ChampionshipGroupId {
  return typeof value === 'string' && GROUP_IDS.has(value);
}

function isSeedPool(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && SEED_POOLS.has(value);
}

function isConcurrency(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= CHAMPIONSHIP_MIN_CONCURRENCY &&
    value <= CHAMPIONSHIP_MAX_CONCURRENCY
  );
}

/** Older snapshots omit these fields entirely; only present values are checked. */
function isOptionalPromptLevel(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length > 0)
  );
}

function isOptionalTokenCap(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value > 0)
  );
}

/** Fall back to `custom` when a snapshot carries an unknown preset key. */
function toPresetKey(preset: string): PresetKey {
  return PRESET_KEYS.has(preset) ? (preset as PresetKey) : 'custom';
}

/** One editable seat as it is sent to (and restored from) the server. */
export function toSetupDrafts(
  drafts: readonly ChampionshipDraft[],
): ChampionshipSetupDraft[] {
  return drafts.map((draft) => ({
    id: draft.id,
    profileId: draft.profileId,
    name: draft.name,
    preset: draft.preset,
    provider: draft.provider,
    baseUrl: draft.baseUrl,
    model: draft.model,
    thinkingLevel: draft.thinkingLevel,
    thinkingOptions: [...draft.thinkingOptions],
    apiReasoning: draft.apiReasoning,
    apiKey: draft.apiKey,
    promptLevel: draft.promptLevel ?? null,
    maxThinkingTokens: draft.maxThinkingTokens ?? null,
    maxCompletionTokens: draft.maxCompletionTokens ?? null,
    requestTimeoutSeconds: draft.requestTimeoutSeconds ?? null,
    seedPool: draft.seedPool,
    qualifierGroup: draft.qualifierGroup,
  }));
}

/**
 * Restore the editable seats from a snapshot. UI-only flags (`showKey`) reset
 * to their defaults so a restored page never reveals a key by itself.
 */
export function fromSetupDrafts(
  setupDrafts: readonly ChampionshipSetupDraft[],
): ChampionshipDraft[] {
  return setupDrafts.map((draft) => ({
    id: draft.id,
    profileId: draft.profileId,
    name: draft.name,
    preset: toPresetKey(draft.preset),
    provider: draft.provider,
    baseUrl: draft.baseUrl,
    model: draft.model,
    thinkingLevel: draft.thinkingLevel,
    thinkingOptions: [...draft.thinkingOptions],
    apiReasoning: draft.apiReasoning,
    apiKey: draft.apiKey,
    showKey: false,
    promptLevel: draft.promptLevel ?? null,
    maxThinkingTokens: draft.maxThinkingTokens ?? null,
    maxCompletionTokens: draft.maxCompletionTokens ?? null,
    requestTimeoutSeconds: draft.requestTimeoutSeconds ?? null,
    seedPool: draft.seedPool,
    qualifierGroup: draft.qualifierGroup,
  }));
}

function isSetupDraft(value: unknown): value is ChampionshipSetupDraft {
  if (!isRecord(value)) return false;
  if (!isString(value.id) || value.id.trim().length === 0) return false;
  if (value.profileId !== null && !isString(value.profileId)) return false;
  if (
    !isString(value.name) ||
    !isString(value.preset) ||
    typeof value.provider !== 'string' ||
    !PROVIDERS.has(value.provider)
  ) {
    return false;
  }
  if (
    !isString(value.baseUrl) ||
    !isString(value.model) ||
    !isString(value.thinkingLevel) ||
    !isString(value.apiKey)
  ) {
    return false;
  }
  if (!Array.isArray(value.thinkingOptions)) return false;
  if (!value.thinkingOptions.every(isString)) return false;
  if (typeof value.apiReasoning !== 'boolean') return false;
  if (!isOptionalPromptLevel(value.promptLevel)) return false;
  if (!isOptionalTokenCap(value.maxThinkingTokens)) return false;
  if (!isOptionalTokenCap(value.maxCompletionTokens)) return false;
  if (
    value.requestTimeoutSeconds !== undefined &&
    value.requestTimeoutSeconds !== null &&
    (typeof value.requestTimeoutSeconds !== 'number' ||
      !Number.isInteger(value.requestTimeoutSeconds))
  ) {
    return false;
  }
  if (!isSeedPool(value.seedPool)) return false;
  if (
    value.qualifierGroup !== null &&
    (typeof value.qualifierGroup !== 'string' || !QUALIFIER_GROUPS.has(value.qualifierGroup))
  ) {
    return false;
  }
  return true;
}

function isSetupDrawSlot(
  value: unknown,
): value is { pool: number; draftId: string; name: string } {
  return (
    isRecord(value) &&
    isSeedPool(value.pool) &&
    isString(value.draftId) &&
    value.draftId.trim().length > 0 &&
    isString(value.name)
  );
}

/**
 * Validate a restored draw and rebuild the reverse index instead of trusting
 * the persisted one. Returns null when the draw is absent or malformed.
 */
export function ensureDraw(value: unknown): ChampionshipDraw | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.groups) || value.groups.length !== CHAMPIONSHIP_GROUPS.length) {
    return null;
  }

  const groups: ChampionshipDraw['groups'] = [];
  const seenGroups = new Set<ChampionshipGroupId>();
  const seenDrafts = new Set<string>();
  const groupByDraftId: Record<string, ChampionshipGroupId> = {};

  for (const rawGroup of value.groups) {
    if (!isRecord(rawGroup) || !isGroupId(rawGroup.id)) return null;
    if (seenGroups.has(rawGroup.id)) return null;
    if (
      !Array.isArray(rawGroup.slots) ||
      rawGroup.slots.length !== CHAMPIONSHIP_ENTRANTS_PER_POOL
    ) {
      return null;
    }

    const slots: ChampionshipDraw['groups'][number]['slots'] = [];
    const pools = new Set<number>();
    for (const rawSlot of rawGroup.slots) {
      if (!isSetupDrawSlot(rawSlot)) return null;
      if (pools.has(rawSlot.pool)) return null;
      if (seenDrafts.has(rawSlot.draftId)) return null;
      pools.add(rawSlot.pool);
      seenDrafts.add(rawSlot.draftId);
      slots.push({ pool: rawSlot.pool, draftId: rawSlot.draftId, name: rawSlot.name });
    }
    if (pools.size !== CHAMPIONSHIP_SEED_POOLS.length) return null;

    slots.sort((left, right) => left.pool - right.pool);
    seenGroups.add(rawGroup.id);
    groups.push({ id: rawGroup.id, slots });
  }

  if (seenGroups.size !== CHAMPIONSHIP_GROUPS.length) return null;
  groups.sort(
    (left, right) =>
      CHAMPIONSHIP_GROUPS.indexOf(left.id) - CHAMPIONSHIP_GROUPS.indexOf(right.id),
  );
  for (const group of groups) {
    for (const slot of group.slots) {
      groupByDraftId[slot.draftId] = group.id;
    }
  }

  return { groups, groupByDraftId };
}

/** Light structural validation of a setup snapshot returned by the API. */
export function isValidSetupSnapshot(
  value: unknown,
): value is ChampionshipSetupSnapshot {
  if (!isRecord(value)) return false;
  if (value.version !== 1) return false;
  if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) return false;
  if (!Array.isArray(value.drafts) || value.drafts.length !== CHAMPIONSHIP_SETUP_DRAFT_COUNT) {
    return false;
  }
  if (!value.drafts.every(isSetupDraft)) return false;
  if (value.draw !== null && ensureDraw(value.draw) === null) return false;
  return isConcurrency(value.concurrency);
}
