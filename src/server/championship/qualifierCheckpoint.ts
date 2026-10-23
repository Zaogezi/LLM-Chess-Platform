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
  ChampionshipGameView,
  ChampionshipSeriesView,
  ModelSetup,
  QualifierGroupId,
  QualifierPhase,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES,
  CHAMPIONSHIP_QUALIFIER_GROUPS,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
  CHAMPIONSHIP_MAX_CONCURRENCY,
  CHAMPIONSHIP_MIN_CONCURRENCY,
} from '../../shared/protocol';
import { validateModelSetup } from '../providers/validate';
import { parseChampionshipGameView } from './checkpoint';

/** Phases that may be written to a qualifying-round checkpoint. */
export type QualifierCheckpointPhase = Exclude<QualifierPhase, 'idle' | 'finished'>;

export interface QualifierCheckpointEntrant {
  id: string;
  name: string;
  groupId: QualifierGroupId;
  /** Contains the API key. This file is local-only and never exposed over HTTP. */
  setup: ModelSetup;
}

/**
 * A resumable snapshot of the qualifying round. The full 20-game schedule is
 * written upfront, so restoring only needs to put unfinished games back to
 * `scheduled`; completed games keep their result.
 */
export interface QualifierCheckpoint {
  version: 1;
  savedAt: number;
  qualifierId: string;
  phase: QualifierCheckpointPhase;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  entrants: QualifierCheckpointEntrant[];
  games: ChampionshipGameView[];
  /** Simultaneous game limit; legacy checkpoints resume serially. */
  concurrency?: number;
}

export interface QualifierCheckpointStoreOptions {
  /**
   * JSON path. Pass null for an in-memory store (tests/engine default). When
   * omitted, the file is `data/qualifier.json` under the process working
   * directory and is only used by the production server.
   */
  filePath?: string | null;
}

export const DEFAULT_QUALIFIER_CHECKPOINT_FILE = path.resolve(
  process.cwd(),
  'data',
  'qualifier.json',
);

const PHASES = new Set<QualifierCheckpointPhase>([
  'running',
  'stopped',
  'error',
  'interrupted',
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isGroupId(value: unknown): value is QualifierGroupId {
  return value === 'A' || value === 'B';
}

function parseEntrant(
  value: unknown,
  index: number,
): QualifierCheckpointEntrant | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!id || id.length > 80 || !name || name.length > 80) return null;
  if (!isGroupId(input.groupId)) return null;

  let setup: ModelSetup;
  try {
    setup = validateModelSetup(input.setup, `入围赛断点模型 ${index + 1}`);
  } catch {
    return null;
  }

  return { id, name, groupId: input.groupId, setup };
}

function parseConcurrency(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < CHAMPIONSHIP_MIN_CONCURRENCY ||
    value > CHAMPIONSHIP_MAX_CONCURRENCY
  ) {
    return undefined;
  }
  return value;
}

function parseEntrants(value: unknown): QualifierCheckpointEntrant[] | null {
  if (!Array.isArray(value) || value.length !== CHAMPIONSHIP_QUALIFIER_ENTRANTS) {
    return null;
  }

  const entrants: QualifierCheckpointEntrant[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const entrant = parseEntrant(value[index], index);
    if (!entrant) return null;
    if (ids.has(entrant.id) || names.has(entrant.name.toLocaleLowerCase())) {
      return null;
    }
    ids.add(entrant.id);
    names.add(entrant.name.toLocaleLowerCase());
    entrants.push(entrant);
  }

  for (const groupId of CHAMPIONSHIP_QUALIFIER_GROUPS) {
    const members = entrants.filter((entrant) => entrant.groupId === groupId);
    if (members.length !== CHAMPIONSHIP_QUALIFIER_GROUP_SIZE) return null;
  }

  return entrants;
}

/**
 * Parse and structurally validate a qualifying-round checkpoint. A malformed
 * file is discarded rather than half-restored.
 */
export function parseQualifierCheckpoint(value: unknown): QualifierCheckpoint | null {
  const input = asRecord(value);
  if (!input || input.version !== 1) return null;

  if (
    typeof input.qualifierId !== 'string' ||
    !input.qualifierId.trim() ||
    input.qualifierId.length > 128
  ) {
    return null;
  }
  if (
    typeof input.phase !== 'string' ||
    !PHASES.has(input.phase as QualifierCheckpointPhase)
  ) {
    return null;
  }
  if (!isFiniteNumber(input.savedAt) || !isFiniteNumber(input.startedAt)) return null;
  if (!isNullableNumber(input.finishedAt)) return null;
  if (input.error !== null && typeof input.error !== 'string') return null;

  const entrants = parseEntrants(input.entrants);
  if (!entrants) return null;
  const entrantIds = new Set(entrants.map((entrant) => entrant.id));

  if (!Array.isArray(input.games)) return null;
  const games: ChampionshipGameView[] = [];
  const gameIds = new Set<string>();
  const seriesById = new Map<string, ChampionshipSeriesView>();
  for (const raw of input.games) {
    const parsed = parseChampionshipGameView(
      raw,
      entrantIds,
      seriesById,
      gameIds,
    );
    if (!parsed || parsed.stage !== 'qualifier') return null;
    games.push(parsed);
  }

  if (games.length !== CHAMPIONSHIP_QUALIFIER_GROUP_GAMES) return null;
  for (const groupId of CHAMPIONSHIP_QUALIFIER_GROUPS) {
    const groupGames = games.filter((game) => game.groupId === groupId);
    if (groupGames.length !== CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP) return null;
    if (
      new Set(groupGames.map((game) => game.pairIndex)).size !==
      CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP
    ) {
      return null;
    }
  }

  if (
    !Array.isArray(input.entrants) ||
    input.entrants.length !== CHAMPIONSHIP_QUALIFIER_ENTRANTS
  ) {
    return null;
  }

  return {
    version: 1,
    savedAt: input.savedAt,
    qualifierId: input.qualifierId.trim(),
    phase: input.phase as QualifierCheckpointPhase,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    error: input.error as string | null,
    entrants,
    games,
    concurrency: parseConcurrency(input.concurrency),
  };
}

function cloneCheckpoint(checkpoint: QualifierCheckpoint): QualifierCheckpoint {
  return {
    ...checkpoint,
    entrants: checkpoint.entrants.map((entrant) => ({
      ...entrant,
      setup: { ...entrant.setup },
    })),
    games: checkpoint.games.map((game) => ({
      ...game,
      result: game.result ? { ...game.result } : null,
    })),
  };
}

/**
 * Atomic JSON checkpoint store for the qualifying round. The file contains
 * model runtime setups (API keys) so a restart can continue without asking for
 * keys again; it is created with owner-only permissions and never served.
 */
export class QualifierCheckpointStore {
  private readonly filePath: string | null;
  private latest: QualifierCheckpoint | null = null;

  constructor(options: QualifierCheckpointStoreOptions = {}) {
    this.filePath =
      options.filePath === undefined
        ? DEFAULT_QUALIFIER_CHECKPOINT_FILE
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

  load(): QualifierCheckpoint | null {
    return this.latest ? cloneCheckpoint(this.latest) : null;
  }

  /** Persist a snapshot. Returns false when the local file cannot be written. */
  save(checkpoint: QualifierCheckpoint): boolean {
    if (!this.filePath) {
      this.latest = cloneCheckpoint(checkpoint);
      return true;
    }

    const directory = path.dirname(this.filePath);
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      mkdirSync(directory, { recursive: true });
      writeFileSync(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      renameSync(temporary, this.filePath);
      try {
        chmodSync(this.filePath, 0o600);
      } catch {
        // Windows may not support POSIX modes; the file remains local.
      }
      this.latest = cloneCheckpoint(checkpoint);
      return true;
    } catch (error) {
      try {
        rmSync(temporary, { force: true });
      } catch {
        // Best-effort cleanup of a failed temporary file.
      }
      console.error(
        '[qualifier] failed to save checkpoint:',
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }

  clear(): void {
    this.latest = null;
    if (!this.filePath) return;
    try {
      rmSync(this.filePath, { force: true });
    } catch (error) {
      console.error(
        '[qualifier] failed to clear checkpoint:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private reload(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      const checkpoint = parseQualifierCheckpoint(parsed);
      if (!checkpoint) {
        console.warn('[qualifier] ignored an invalid or incompatible checkpoint file');
        return;
      }
      this.latest = checkpoint;
    } catch (error) {
      console.warn(
        '[qualifier] failed to read checkpoint; starting without resume:',
        error instanceof Error ? error.message : error,
      );
    }
  }
}
