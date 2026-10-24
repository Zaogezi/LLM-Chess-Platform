import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {
  ChampionshipGroupId,
  ChampionshipSetupDraft,
  ChampionshipSetupDraw,
  ChampionshipSetupDrawGroup,
  ChampionshipSetupDrawSlot,
  ChampionshipSetupSaveRequest,
  ChampionshipSetupSnapshot,
  ProviderKind,
  QualifierGroupId,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_ENTRANTS,
  CHAMPIONSHIP_ENTRANTS_PER_POOL,
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_MAX_CONCURRENCY,
  CHAMPIONSHIP_MIN_CONCURRENCY,
  CHAMPIONSHIP_POOLS,
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_SEED_POOLS,
} from '../../shared/protocol';

/**
 * Version of the persisted championship setup file. The setup is only the
 * pre-start form (seats + draw + concurrency); a running championship keeps its
 * own checkpoint. Bumping this makes old files unreadable on purpose.
 */
export const CHAMPIONSHIP_SETUP_VERSION = 1;

/**
 * The fixed 22 seats: 12 seeded seats (pools 1–3, four each) plus the ten
 * qualifying seats. This mirrors `CHAMPIONSHIP_DRAFT_COUNT` in the client lib.
 */
export const CHAMPIONSHIP_SETUP_DRAFT_COUNT =
  CHAMPIONSHIP_ENTRANTS -
  CHAMPIONSHIP_ENTRANTS_PER_POOL +
  CHAMPIONSHIP_QUALIFIER_ENTRANTS;

/** `data/championship-setup.json`; only the production server writes it. */
export const DEFAULT_CHAMPIONSHIP_SETUP_FILE = path.resolve(
  process.cwd(),
  'data',
  'championship-setup.json',
);

export interface ChampionshipSetupStoreOptions {
  /**
   * JSON path. Pass null for an in-memory store (tests/engine default). When
   * omitted, the file is `data/championship-setup.json` under the process
   * working directory and is only used by the production server.
   */
  filePath?: string | null;
}

const PROVIDERS = new Set<ProviderKind>(['openai', 'anthropic']);
const GROUP_IDS = new Set<ChampionshipGroupId>(CHAMPIONSHIP_GROUPS);
const SEED_POOLS = new Set<number>(CHAMPIONSHIP_SEED_POOLS);
const QUALIFIER_GROUPS = new Set<QualifierGroupId>(['A', 'B']);

/** Upper bounds keep a corrupted or hostile file from ballooning into memory. */
const MAX_ID_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const MAX_PRESET_LENGTH = 64;
const MAX_BASE_URL_LENGTH = 2048;
const MAX_MODEL_LENGTH = 512;
const MAX_LEVEL_LENGTH = 64;
const MAX_API_KEY_LENGTH = 8192;
const MAX_THINKING_OPTIONS = 64;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
  );
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function isProvider(value: unknown): value is ProviderKind {
  return typeof value === 'string' && PROVIDERS.has(value as ProviderKind);
}

function isGroupId(value: unknown): value is ChampionshipGroupId {
  return typeof value === 'string' && GROUP_IDS.has(value as ChampionshipGroupId);
}

function isSeedPool(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && SEED_POOLS.has(value)
  );
}

function isQualifierGroup(value: unknown): value is QualifierGroupId {
  return typeof value === 'string' && QUALIFIER_GROUPS.has(value as QualifierGroupId);
}

function isThinkingOptions(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_THINKING_OPTIONS &&
    value.every((level) => isBoundedString(level, MAX_LEVEL_LENGTH))
  );
}

/** Parse and validate one seat. Missing/mistyped fields invalidate the seat. */
function parseDraft(value: unknown): ChampionshipSetupDraft | null {
  const input = asRecord(value);
  if (!input) return null;
  if (!isNonEmptyString(input.id, MAX_ID_LENGTH)) return null;
  if (input.profileId !== null && !isBoundedString(input.profileId, MAX_ID_LENGTH)) {
    return null;
  }
  if (!isBoundedString(input.name, MAX_NAME_LENGTH)) return null;
  if (!isBoundedString(input.preset, MAX_PRESET_LENGTH)) return null;
  if (!isProvider(input.provider)) return null;
  if (!isBoundedString(input.baseUrl, MAX_BASE_URL_LENGTH)) return null;
  if (!isBoundedString(input.model, MAX_MODEL_LENGTH)) return null;
  if (!isBoundedString(input.thinkingLevel, MAX_LEVEL_LENGTH)) return null;
  if (!isThinkingOptions(input.thinkingOptions)) return null;
  if (typeof input.apiReasoning !== 'boolean') return null;
  if (!isBoundedString(input.apiKey, MAX_API_KEY_LENGTH)) return null;
  if (!isSeedPool(input.seedPool)) return null;
  if (input.qualifierGroup !== null && !isQualifierGroup(input.qualifierGroup)) {
    return null;
  }

  return {
    id: input.id,
    profileId: input.profileId as string | null,
    name: input.name,
    preset: input.preset,
    provider: input.provider,
    baseUrl: input.baseUrl,
    model: input.model,
    thinkingLevel: input.thinkingLevel,
    thinkingOptions: [...input.thinkingOptions],
    apiReasoning: input.apiReasoning,
    apiKey: input.apiKey,
    seedPool: input.seedPool,
    qualifierGroup: input.qualifierGroup as QualifierGroupId | null,
  };
}

function parseDrafts(value: unknown): ChampionshipSetupDraft[] | null {
  if (!Array.isArray(value) || value.length !== CHAMPIONSHIP_SETUP_DRAFT_COUNT) {
    return null;
  }
  const drafts: ChampionshipSetupDraft[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const draft = parseDraft(raw);
    if (!draft || ids.has(draft.id)) return null;
    ids.add(draft.id);
    drafts.push(draft);
  }
  return drafts;
}

function parseDrawSlot(value: unknown): ChampionshipSetupDrawSlot | null {
  const input = asRecord(value);
  if (!input) return null;
  if (!isSeedPool(input.pool)) return null;
  if (!isNonEmptyString(input.draftId, MAX_ID_LENGTH)) return null;
  if (!isBoundedString(input.name, MAX_NAME_LENGTH)) return null;
  return { pool: input.pool, draftId: input.draftId, name: input.name };
}

function parseDrawGroup(value: unknown): ChampionshipSetupDrawGroup | null {
  const input = asRecord(value);
  if (!input || !isGroupId(input.id)) return null;
  if (
    !Array.isArray(input.slots) ||
    input.slots.length !== CHAMPIONSHIP_ENTRANTS_PER_POOL
  ) {
    return null;
  }

  const slots: ChampionshipSetupDrawSlot[] = [];
  const pools = new Set<number>();
  for (const raw of input.slots) {
    const slot = parseDrawSlot(raw);
    // Each group holds exactly one entrant from every seed pool.
    if (!slot || pools.has(slot.pool)) return null;
    pools.add(slot.pool);
    slots.push(slot);
  }
  if (pools.size !== CHAMPIONSHIP_POOLS) return null;

  slots.sort((left, right) => left.pool - right.pool);
  return { id: input.id, slots };
}

/**
 * Parse the optional draw. Returns `undefined` for an invalid shape and `null`
 * for "no draw yet", matching the tri-state used elsewhere in the server.
 */
export function parseChampionshipSetupDraw(
  value: unknown,
): ChampionshipSetupDraw | null | undefined {
  if (value === null) return null;
  const input = asRecord(value);
  if (!input) return undefined;
  if (
    !Array.isArray(input.groups) ||
    input.groups.length !== CHAMPIONSHIP_GROUPS.length
  ) {
    return undefined;
  }

  const groups: ChampionshipSetupDrawGroup[] = [];
  const seenGroups = new Set<ChampionshipGroupId>();
  const seenDrafts = new Set<string>();
  for (const raw of input.groups) {
    const group = parseDrawGroup(raw);
    if (!group || seenGroups.has(group.id)) return undefined;
    for (const slot of group.slots) {
      // No entrant may be drawn into two groups.
      if (seenDrafts.has(slot.draftId)) return undefined;
      seenDrafts.add(slot.draftId);
    }
    seenGroups.add(group.id);
    groups.push(group);
  }
  if (CHAMPIONSHIP_GROUPS.some((id) => !seenGroups.has(id))) return undefined;

  // Canonical A→D order so a restored file always renders the same board.
  groups.sort(
    (left, right) =>
      CHAMPIONSHIP_GROUPS.indexOf(left.id) - CHAMPIONSHIP_GROUPS.indexOf(right.id),
  );

  const groupByDraftId: Record<string, ChampionshipGroupId> = {};
  for (const group of groups) {
    for (const slot of group.slots) {
      groupByDraftId[slot.draftId] = group.id;
    }
  }

  return { groups, groupByDraftId };
}

function parseConcurrency(value: unknown): number | null {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < CHAMPIONSHIP_MIN_CONCURRENCY ||
    value > CHAMPIONSHIP_MAX_CONCURRENCY
  ) {
    return null;
  }
  return value;
}

/** Validate a PUT body / snapshot payload without any version or timestamp. */
export function parseChampionshipSetupSaveRequest(
  value: unknown,
): ChampionshipSetupSaveRequest | null {
  const input = asRecord(value);
  if (!input) return null;

  const drafts = parseDrafts(input.drafts);
  if (!drafts) return null;
  const draw = parseChampionshipSetupDraw(input.draw);
  if (draw === undefined) return null;
  const concurrency = parseConcurrency(input.concurrency);
  if (concurrency === null) return null;

  return { drafts, draw, concurrency };
}

/**
 * Parse a persisted setup file. Any malformed field discards the whole file:
 * restoring half a setup would silently mix old and default seats.
 */
export function parseChampionshipSetupSnapshot(
  value: unknown,
): ChampionshipSetupSnapshot | null {
  const input = asRecord(value);
  if (!input || input.version !== CHAMPIONSHIP_SETUP_VERSION) return null;
  if (!isFiniteNumber(input.savedAt)) return null;

  const request = parseChampionshipSetupSaveRequest(input);
  if (!request) return null;

  return {
    version: CHAMPIONSHIP_SETUP_VERSION,
    savedAt: input.savedAt,
    drafts: request.drafts,
    draw: request.draw,
    concurrency: request.concurrency,
  };
}

function cloneDraw(draw: ChampionshipSetupDraw): ChampionshipSetupDraw {
  return {
    groups: draw.groups.map((group) => ({
      id: group.id,
      slots: group.slots.map((slot) => ({ ...slot })),
    })),
    groupByDraftId: { ...draw.groupByDraftId },
  };
}

function cloneSnapshot(snapshot: ChampionshipSetupSnapshot): ChampionshipSetupSnapshot {
  return {
    version: CHAMPIONSHIP_SETUP_VERSION,
    savedAt: snapshot.savedAt,
    drafts: snapshot.drafts.map((draft) => ({
      ...draft,
      thinkingOptions: [...draft.thinkingOptions],
    })),
    draw: snapshot.draw ? cloneDraw(snapshot.draw) : null,
    concurrency: snapshot.concurrency,
  };
}

/**
 * Atomic JSON store for the pre-start championship setup. The file contains
 * inline model API keys (a seat without a library profile carries its own key),
 * so it is written with owner-only permissions and is never exposed over HTTP
 * except through the local setup endpoint.
 */
export class ChampionshipSetupStore {
  private readonly filePath: string | null;
  private latest: ChampionshipSetupSnapshot | null = null;

  constructor(options: ChampionshipSetupStoreOptions = {}) {
    this.filePath =
      options.filePath === undefined
        ? DEFAULT_CHAMPIONSHIP_SETUP_FILE
        : options.filePath === null
          ? null
          : path.resolve(options.filePath);
    this.reload();
  }

  get path(): string | null {
    return this.filePath;
  }

  has(): boolean {
    return this.latest !== null;
  }

  load(): ChampionshipSetupSnapshot | null {
    return this.latest ? cloneSnapshot(this.latest) : null;
  }

  /**
   * Validate and persist a setup. Returns the saved snapshot (with a fresh
   * `savedAt`), or null when the request is invalid or the file cannot be
   * written.
   */
  save(request: ChampionshipSetupSaveRequest): ChampionshipSetupSnapshot | null {
    const parsed = parseChampionshipSetupSaveRequest(request);
    if (!parsed) return null;

    const snapshot: ChampionshipSetupSnapshot = {
      version: CHAMPIONSHIP_SETUP_VERSION,
      savedAt: Date.now(),
      drafts: parsed.drafts,
      draw: parsed.draw,
      concurrency: parsed.concurrency,
    };

    return this.persist(snapshot) ? cloneSnapshot(snapshot) : null;
  }

  clear(): void {
    this.latest = null;
    if (!this.filePath) return;
    try {
      rmSync(this.filePath, { force: true });
    } catch (error) {
      console.error(
        '[championship] failed to clear setup:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private persist(snapshot: ChampionshipSetupSnapshot): boolean {
    if (!this.filePath) {
      this.latest = cloneSnapshot(snapshot);
      return true;
    }

    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporary, this.filePath);
      try {
        chmodSync(this.filePath, 0o600);
      } catch {
        // Windows may not support POSIX modes; the file remains local.
      }
      this.latest = cloneSnapshot(snapshot);
      return true;
    } catch (error) {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // Best-effort cleanup of a failed temporary file.
      }
      console.error(
        '[championship] failed to save setup:',
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }

  private reload(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      const snapshot = parseChampionshipSetupSnapshot(parsed);
      if (!snapshot) {
        console.warn('[championship] ignored an invalid championship setup file');
        return;
      }
      this.latest = snapshot;
    } catch (error) {
      console.warn(
        '[championship] failed to read saved setup:',
        error instanceof Error ? error.message : error,
      );
    }
  }
}
