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
  ChampionshipArchive,
  ChampionshipArchivePhase,
  ChampionshipArchiveSummary,
  ChampionshipEntrantView,
  ChampionshipGameView,
  ChampionshipGroupId,
  ChampionshipGroupView,
  ChampionshipSeriesView,
  ProviderKind,
  TournamentStanding,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_ENTRANTS,
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_GROUP_GAMES,
  CHAMPIONSHIP_GROUP_GAMES_PER_GROUP,
  CHAMPIONSHIP_SERIES_COUNT,
} from '../../shared/protocol';
import {
  parseChampionshipGameView,
  parseChampionshipSeriesView,
} from './checkpoint';

export const DEFAULT_CHAMPIONSHIP_ARCHIVE_FILE = path.resolve(
  process.cwd(),
  'data',
  'championships.json',
);

export interface ChampionshipArchiveStoreOptions {
  /**
   * JSON path. Pass null for an in-memory store (tests/default engine). When
   * omitted, the file is `data/championships.json` under the process working
   * directory and is only used by the production server.
   */
  filePath?: string | null;
}

const ARCHIVE_PHASES = new Set<ChampionshipArchivePhase>([
  'finished',
  'stopped',
  'error',
  'interrupted',
]);
const GROUP_IDS = new Set<ChampionshipGroupId>(CHAMPIONSHIP_GROUPS);
const PROVIDERS = new Set<ProviderKind>(['openai', 'anthropic']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isGroupId(value: unknown): value is ChampionshipGroupId {
  return typeof value === 'string' && GROUP_IDS.has(value as ChampionshipGroupId);
}

/**
 * Defence in depth: an archive must never carry runtime setup objects or keys.
 * The writer only ever serialises `ChampionshipEntrantView`, but a corrupted or
 * hand-edited file must not be able to smuggle a secret back into memory.
 */
function containsSecretFields(value: unknown, depth = 0): boolean {
  if (depth > 12) return true;
  if (Array.isArray(value)) {
    return value.some((item) => containsSecretFields(item, depth + 1));
  }
  const record = asRecord(value);
  if (!record) return false;
  for (const [key, child] of Object.entries(record)) {
    const normalized = key.toLocaleLowerCase();
    if (normalized === 'apikey' || normalized === 'setup') return true;
    if (containsSecretFields(child, depth + 1)) return true;
  }
  return false;
}

function parseEntrant(value: unknown): ChampionshipEntrantView | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = isNonEmptyString(input.id) ? input.id.trim() : '';
  const name = isNonEmptyString(input.name) ? input.name.trim() : '';
  const model = isNonEmptyString(input.model) ? input.model.trim() : '';
  const thinkingLevel = isNonEmptyString(input.thinkingLevel)
    ? input.thinkingLevel.trim()
    : '';
  if (!id || id.length > 80 || !name || name.length > 80 || !model) return null;
  if (typeof input.provider !== 'string' || !PROVIDERS.has(input.provider as ProviderKind)) {
    return null;
  }
  if (typeof input.apiReasoning !== 'boolean' || typeof input.keyConfigured !== 'boolean') {
    return null;
  }
  if (!isCount(input.seedPool) || input.seedPool < 1 || input.seedPool > 4) return null;
  if (!isGroupId(input.groupId)) return null;

  return {
    id,
    name,
    provider: input.provider as ProviderKind,
    model,
    thinkingLevel,
    apiReasoning: input.apiReasoning,
    keyConfigured: input.keyConfigured,
    seedPool: input.seedPool,
    groupId: input.groupId,
  };
}

function parseStanding(value: unknown): TournamentStanding | null {
  const input = asRecord(value);
  if (!input) return null;
  if (!isCount(input.rank) || input.rank < 1) return null;
  if (!isNonEmptyString(input.modelId) || !isNonEmptyString(input.name)) return null;
  const integerFields = [
    'played',
    'wins',
    'draws',
    'losses',
    'failed',
    'points',
    'redGames',
    'blackGames',
  ] as const;
  for (const field of integerFields) {
    if (!isCount(input[field])) return null;
  }
  if (!isCount(input.tokensIn) || !isCount(input.tokensOut)) return null;

  return {
    rank: input.rank,
    modelId: input.modelId,
    name: input.name,
    played: input.played as number,
    wins: input.wins as number,
    draws: input.draws as number,
    losses: input.losses as number,
    failed: input.failed as number,
    points: input.points as number,
    redGames: input.redGames as number,
    blackGames: input.blackGames as number,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
  };
}

function parseGroup(
  value: unknown,
  entrantIds: ReadonlySet<string>,
): ChampionshipGroupView | null {
  const input = asRecord(value);
  if (!input) return null;
  if (!isGroupId(input.id)) return null;
  if (!Array.isArray(input.entrantIds) || input.entrantIds.length !== 4) return null;
  const memberIds = input.entrantIds.map((id) => (isNonEmptyString(id) ? id : null));
  if (memberIds.some((id) => !id || !entrantIds.has(id))) return null;
  if (new Set(memberIds).size !== 4) return null;

  if (!Array.isArray(input.standings) || input.standings.length !== 4) return null;
  const standings: TournamentStanding[] = [];
  const standingIds = new Set<string>();
  for (const raw of input.standings) {
    const standing = parseStanding(raw);
    if (!standing || !entrantIds.has(standing.modelId)) return null;
    if (standingIds.has(standing.modelId)) return null;
    standingIds.add(standing.modelId);
    standings.push(standing);
  }
  if (memberIds.some((id) => !standingIds.has(id!))) return null;

  if (typeof input.complete !== 'boolean') return null;
  if (!Array.isArray(input.qualifiedModelIds)) return null;
  const qualified = input.qualifiedModelIds.map((id) => (isNonEmptyString(id) ? id : null));
  if (
    qualified.some((id) => !id || !entrantIds.has(id)) ||
    new Set(qualified).size !== qualified.length
  ) {
    return null;
  }
  // A partial group never promotes qualifiers; a complete one always promotes 2.
  if (!input.complete && qualified.length !== 0) return null;
  if (input.complete && qualified.length !== 2) return null;

  return {
    id: input.id,
    entrantIds: memberIds as string[],
    standings,
    complete: input.complete,
    qualifiedModelIds: qualified as string[],
  };
}

function parseSummaryFields(input: Record<string, unknown>): ChampionshipArchiveSummary | null {
  const championshipId = isNonEmptyString(input.championshipId)
    ? input.championshipId.trim()
    : '';
  if (!championshipId || championshipId.length > 128) return null;
  if (
    typeof input.phase !== 'string' ||
    !ARCHIVE_PHASES.has(input.phase as ChampionshipArchivePhase)
  ) {
    return null;
  }
  if (!isFiniteNumber(input.startedAt) || !isFiniteNumber(input.archivedAt)) return null;
  if (input.finishedAt !== null && !isFiniteNumber(input.finishedAt)) return null;
  if (input.championModelId !== null && !isNonEmptyString(input.championModelId)) return null;
  if (input.championName !== null && !isNonEmptyString(input.championName)) return null;
  if ((input.championModelId === null) !== (input.championName === null)) return null;
  if (input.error !== null && typeof input.error !== 'string') return null;
  if (!Array.isArray(input.entrantNames)) return null;
  const entrantNames = input.entrantNames.map((name) =>
    isNonEmptyString(name) ? name.trim() : null,
  );
  if (entrantNames.some((name) => !name)) return null;
  if (new Set(entrantNames).size !== entrantNames.length) return null;

  const counts = [
    'completedGames',
    'processedGames',
    'scheduledGames',
    'seriesProcessed',
    'seriesTotal',
    'groupGamesTotal',
    'groupGamesProcessed',
  ] as const;
  for (const field of counts) {
    if (!isCount(input[field])) return null;
  }
  const completedGames = input.completedGames as number;
  const processedGames = input.processedGames as number;
  const scheduledGames = input.scheduledGames as number;
  const seriesProcessed = input.seriesProcessed as number;
  const seriesTotal = input.seriesTotal as number;
  const groupGamesTotal = input.groupGamesTotal as number;
  const groupGamesProcessed = input.groupGamesProcessed as number;
  if (seriesTotal !== CHAMPIONSHIP_SERIES_COUNT) return null;
  if (groupGamesTotal !== CHAMPIONSHIP_GROUP_GAMES) return null;
  if (scheduledGames < groupGamesTotal) return null;
  if (processedGames > scheduledGames) return null;
  if (completedGames > processedGames) return null;
  if (seriesProcessed > seriesTotal) return null;
  if (groupGamesProcessed > groupGamesTotal) return null;

  return {
    championshipId,
    phase: input.phase as ChampionshipArchivePhase,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt as number | null,
    archivedAt: input.archivedAt,
    championModelId: input.championModelId as string | null,
    championName: input.championName as string | null,
    error: input.error as string | null,
    entrantNames: entrantNames as string[],
    completedGames,
    processedGames,
    scheduledGames,
    seriesProcessed,
    seriesTotal,
  };
}

/** Build the compact list row from a full archive. */
export function toChampionshipArchiveSummary(
  archive: ChampionshipArchive,
): ChampionshipArchiveSummary {
  return {
    championshipId: archive.championshipId,
    phase: archive.phase,
    startedAt: archive.startedAt,
    finishedAt: archive.finishedAt,
    archivedAt: archive.archivedAt,
    championModelId: archive.championModelId,
    championName: archive.championName,
    error: archive.error,
    entrantNames: [...archive.entrantNames],
    completedGames: archive.completedGames,
    processedGames: archive.processedGames,
    scheduledGames: archive.scheduledGames,
    seriesProcessed: archive.seriesProcessed,
    seriesTotal: archive.seriesTotal,
  };
}

/**
 * Parse and structurally validate one archived edition. The returned object is
 * rebuilt field by field, so unknown (and potentially secret) properties are
 * dropped instead of being persisted again.
 */
export function parseChampionshipArchive(value: unknown): ChampionshipArchive | null {
  if (containsSecretFields(value)) return null;
  const input = asRecord(value);
  if (!input || input.version !== 1) return null;

  const summary = parseSummaryFields(input);
  if (!summary) return null;

  if (!Array.isArray(input.entrants) || input.entrants.length !== CHAMPIONSHIP_ENTRANTS) {
    return null;
  }
  const entrants: ChampionshipEntrantView[] = [];
  const entrantIds = new Set<string>();
  for (const raw of input.entrants) {
    const entrant = parseEntrant(raw);
    if (!entrant || entrantIds.has(entrant.id)) return null;
    entrantIds.add(entrant.id);
    entrants.push(entrant);
  }
  if (
    entrants.length !== summary.entrantNames.length ||
    entrants.some((entrant, index) => entrant.name !== summary.entrantNames[index])
  ) {
    return null;
  }

  if (!Array.isArray(input.groups) || input.groups.length !== CHAMPIONSHIP_GROUPS.length) {
    return null;
  }
  const groups: ChampionshipGroupView[] = [];
  const groupIds = new Set<ChampionshipGroupId>();
  const seenMembers = new Set<string>();
  for (const raw of input.groups) {
    const group = parseGroup(raw, entrantIds);
    if (!group || groupIds.has(group.id)) return null;
    groupIds.add(group.id);
    for (const id of group.entrantIds) {
      if (seenMembers.has(id)) return null;
      seenMembers.add(id);
    }
    groups.push(group);
  }
  if (CHAMPIONSHIP_GROUPS.some((id) => !groupIds.has(id))) return null;
  if (seenMembers.size !== CHAMPIONSHIP_ENTRANTS) return null;
  groups.sort(
    (left, right) =>
      CHAMPIONSHIP_GROUPS.indexOf(left.id) - CHAMPIONSHIP_GROUPS.indexOf(right.id),
  );

  if (!Array.isArray(input.series) || input.series.length !== CHAMPIONSHIP_SERIES_COUNT) {
    return null;
  }
  const series: ChampionshipSeriesView[] = [];
  const seriesIds = new Set<string>();
  for (const raw of input.series) {
    const parsed = parseChampionshipSeriesView(raw, entrantIds);
    if (!parsed || seriesIds.has(parsed.id)) return null;
    seriesIds.add(parsed.id);
    series.push(parsed);
  }
  if (series.length !== CHAMPIONSHIP_SERIES_COUNT) return null;
  const seriesById = new Map(series.map((item) => [item.id, item]));

  if (!Array.isArray(input.games)) return null;
  const games: ChampionshipGameView[] = [];
  const gameIds = new Set<string>();
  for (const raw of input.games) {
    const parsed = parseChampionshipGameView(raw, entrantIds, seriesById, gameIds);
    if (!parsed) return null;
    games.push(parsed);
  }
  const groupGames = games.filter((game) => game.stage === 'group');
  if (groupGames.length !== CHAMPIONSHIP_GROUP_GAMES) return null;
  for (const groupId of CHAMPIONSHIP_GROUPS) {
    const group = groupGames.filter((game) => game.groupId === groupId);
    if (group.length !== CHAMPIONSHIP_GROUP_GAMES_PER_GROUP) return null;
    if (new Set(group.map((game) => game.pairIndex)).size !== group.length) return null;
  }
  const seriesGameKeys = new Set<string>();
  for (const game of games) {
    if (!game.seriesId) continue;
    const key = `${game.seriesId}:${game.gameIndex}`;
    if (seriesGameKeys.has(key)) return null;
    seriesGameKeys.add(key);
  }

  return {
    ...summary,
    version: 1,
    entrants,
    groups,
    series,
    games,
    groupGamesTotal: input.groupGamesTotal as number,
    groupGamesProcessed: input.groupGamesProcessed as number,
  };
}

function cloneArchive(archive: ChampionshipArchive): ChampionshipArchive {
  return {
    ...archive,
    entrantNames: [...archive.entrantNames],
    entrants: archive.entrants.map((entrant) => ({ ...entrant })),
    groups: archive.groups.map((group) => ({
      ...group,
      entrantIds: [...group.entrantIds],
      standings: group.standings.map((standing) => ({ ...standing })),
      qualifiedModelIds: [...group.qualifiedModelIds],
    })),
    series: archive.series.map((series) => ({
      ...series,
      left: series.left ? { ...series.left } : null,
      right: series.right ? { ...series.right } : null,
    })),
    games: archive.games.map((game) => ({
      ...game,
      result: game.result ? { ...game.result } : null,
    })),
  };
}

/**
 * Persistent archive of past championship editions, backed by
 * `data/championships.json` in production and memory-only when `filePath` is
 * null (tests and the default engine). Writes are atomic (temp file + rename)
 * and corrupt files are ignored with a warning instead of crashing the server.
 */
export class ChampionshipArchiveStore {
  private readonly filePath: string | null;
  private archives: ChampionshipArchive[] = [];

  constructor(options: ChampionshipArchiveStoreOptions = {}) {
    this.filePath =
      options.filePath === undefined
        ? DEFAULT_CHAMPIONSHIP_ARCHIVE_FILE
        : options.filePath === null
          ? null
          : path.resolve(options.filePath);
    this.reload();
  }

  get path(): string | null {
    return this.filePath;
  }

  get size(): number {
    return this.archives.length;
  }

  /** Compact rows for the 对局管理 championship archive list, newest first. */
  list(): ChampionshipArchiveSummary[] {
    return [...this.archives]
      .sort(
        (left, right) =>
          right.archivedAt - left.archivedAt ||
          right.startedAt - left.startedAt ||
          left.championshipId.localeCompare(right.championshipId),
      )
      .map(toChampionshipArchiveSummary);
  }

  get(championshipId: string): ChampionshipArchive | null {
    const archive = this.archives.find((item) => item.championshipId === championshipId);
    return archive ? cloneArchive(archive) : null;
  }

  /** Insert or replace one edition by `championshipId`. */
  save(archive: ChampionshipArchive): boolean {
    const parsed = parseChampionshipArchive(archive);
    if (!parsed) {
      console.warn('[championship] ignored an invalid archive entry');
      return false;
    }
    this.archives = this.archives.filter(
      (item) => item.championshipId !== parsed.championshipId,
    );
    this.archives.push(cloneArchive(parsed));
    return this.persist();
  }

  clear(): void {
    this.archives = [];
    if (!this.filePath) return;
    try {
      rmSync(this.filePath, { force: true });
    } catch (error) {
      console.error(
        '[championship] failed to clear archive:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private persist(): boolean {
    if (!this.filePath) return true;

    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(this.archives, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporary, this.filePath);
      try {
        chmodSync(this.filePath, 0o600);
      } catch {
        // Windows may not support POSIX modes; the file remains local.
      }
      return true;
    } catch (error) {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // Best-effort cleanup of a failed temporary file.
      }
      console.error(
        '[championship] failed to save archive:',
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }

  private reload(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.filePath, 'utf8'));
    } catch (error) {
      console.warn(
        '[championship] failed to read archive; starting with an empty archive:',
        error instanceof Error ? error.message : error,
      );
      return;
    }
    if (!Array.isArray(parsed)) {
      console.warn('[championship] ignored an invalid archive file');
      return;
    }

    const byId = new Map<string, ChampionshipArchive>();
    let invalid = 0;
    for (const raw of parsed) {
      const archive = parseChampionshipArchive(raw);
      if (!archive) {
        invalid += 1;
        continue;
      }
      const existing = byId.get(archive.championshipId);
      if (!existing || existing.archivedAt <= archive.archivedAt) {
        byId.set(archive.championshipId, archive);
      }
    }
    if (invalid > 0) {
      console.warn(`[championship] ignored ${invalid} invalid archive entr(ies)`);
    }
    this.archives = [...byId.values()];
  }
}
