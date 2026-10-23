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
  ChampionshipGroupId,
  ChampionshipKnockoutStage,
  ChampionshipPhase,
  ChampionshipSeriesDecision,
  ChampionshipSeriesStatus,
  ChampionshipSeriesView,
  ChampionshipStage,
  GameResult,
  ModelSetup,
  ResultReason,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_ENTRANTS,
  CHAMPIONSHIP_ENTRANTS_PER_POOL,
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_GROUP_GAMES,
  CHAMPIONSHIP_GROUP_GAMES_PER_GROUP,
  CHAMPIONSHIP_MAX_CONCURRENCY,
  CHAMPIONSHIP_MIN_CONCURRENCY,
  CHAMPIONSHIP_POOLS,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP,
  CHAMPIONSHIP_SEED_POOLS,
  CHAMPIONSHIP_SERIES_COUNT,
  CHAMPIONSHIP_SERIES_DRAW_POINTS,
  CHAMPIONSHIP_SERIES_GAME_LIMIT,
  CHAMPIONSHIP_SERIES_POINTS_TARGET,
  CHAMPIONSHIP_SERIES_WIN_POINTS,
} from '../../shared/protocol';
import { validateModelSetup } from '../providers/validate';
import { createSeriesSkeleton } from './schedule';

/** Phases that may be written to a checkpoint. Finished runs are not resumable. */
export type ChampionshipCheckpointPhase = Exclude<ChampionshipPhase, 'idle' | 'finished'>;

export interface ChampionshipCheckpointEntrant {
  id: string;
  name: string;
  /** 1–4; the user-defined seed pot this entrant belongs to. */
  seedPool: number;
  groupId: ChampionshipGroupId;
  /** Contains the API key. This file is local-only and is never exposed over HTTP. */
  setup: ModelSetup;
}

/**
 * A resumable snapshot of a championship. Games are the source of truth for
 * table points and series counters; the knockout counters are rebuilt on
 * resume so a crash can never duplicate an already-completed win.
 *
 * Version 2 introduced the six-game, three-point knockout series
 * (`leftPoints`/`rightPoints`/`overtime`/`extra`). Version 1 files are still
 * accepted when they are group-only (no knockout games, every series pending):
 * they are migrated by keeping the group results and rebuilding a fresh
 * version-2 bracket skeleton.
 */
export interface ChampionshipCheckpoint {
  version: 2;
  savedAt: number;
  championshipId: string;
  phase: ChampionshipCheckpointPhase;
  stage: ChampionshipStage | null;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  entrants: ChampionshipCheckpointEntrant[];
  games: ChampionshipGameView[];
  series: ChampionshipSeriesView[];
  /** Simultaneous game/series limit; legacy checkpoints resume serially. */
  concurrency?: number;
}

export interface ChampionshipCheckpointStoreOptions {
  /**
   * JSON path. Pass null for an in-memory store (tests/default engine). When
   * omitted, the file is `data/championship.json` under the process working
   * directory and is only used by the production server.
   */
  filePath?: string | null;
}

export const DEFAULT_CHAMPIONSHIP_CHECKPOINT_FILE = path.resolve(
  process.cwd(),
  'data',
  'championship.json',
);

const PHASES = new Set<ChampionshipCheckpointPhase>([
  'running',
  'stopped',
  'error',
  'interrupted',
]);
const STAGES = new Set<ChampionshipStage>([
  'qualifier',
  'group',
  'quarterfinal',
  'semifinal',
  'final',
]);
const GAME_STATUSES = new Set([
  'scheduled',
  'running',
  'finished',
  'failed',
  'canceled',
]);
const SERIES_STATUSES = new Set<ChampionshipSeriesStatus>([
  'pending',
  'running',
  'finished',
  'stopped',
]);
const RESULT_REASONS = new Set([
  'checkmate',
  'stalemate',
  'repetition',
  'dead-position',
  'no-progress',
  'max-plies',
  'timeout',
  'forfeit',
]);
const GROUP_IDS = new Set<ChampionshipGroupId>(CHAMPIONSHIP_GROUPS);
const SERIES_IDS = ['qf1', 'qf2', 'qf3', 'qf4', 'sf1', 'sf2', 'final'] as const;
type SeriesId = (typeof SERIES_IDS)[number];

const SERIES_SPEC: Record<
  SeriesId,
  { stage: ChampionshipKnockoutStage; slot: number }
> = {
  qf1: { stage: 'quarterfinal', slot: 1 },
  qf2: { stage: 'quarterfinal', slot: 2 },
  qf3: { stage: 'quarterfinal', slot: 3 },
  qf4: { stage: 'quarterfinal', slot: 4 },
  sf1: { stage: 'semifinal', slot: 1 },
  sf2: { stage: 'semifinal', slot: 2 },
  final: { stage: 'final', slot: 1 },
};

/** Canonical series ids in bracket order. */
export const CHAMPIONSHIP_SERIES_IDS: readonly string[] = SERIES_IDS;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isStage(value: unknown): value is ChampionshipStage {
  return typeof value === 'string' && STAGES.has(value as ChampionshipStage);
}

function isGroupId(value: unknown): value is ChampionshipGroupId {
  return typeof value === 'string' && GROUP_IDS.has(value as ChampionshipGroupId);
}

function isSeriesId(value: unknown): value is SeriesId {
  return typeof value === 'string' && (SERIES_IDS as readonly string[]).includes(value);
}

function isResultReason(value: unknown): boolean {
  return typeof value === 'string' && RESULT_REASONS.has(value);
}

function parseResult(value: unknown): GameResult | null | undefined {
  if (value === null) return null;
  const result = asRecord(value);
  if (!result) return undefined;
  if (result.winner !== null && result.winner !== 'red' && result.winner !== 'black') {
    return undefined;
  }
  if (!isResultReason(result.reason) || typeof result.text !== 'string') {
    return undefined;
  }
  return {
    winner: result.winner as 'red' | 'black' | null,
    reason: result.reason as ResultReason,
    text: result.text,
  };
}

export function parseChampionshipSeriesDecision(
  value: unknown,
): ChampionshipSeriesDecision | null | undefined {
  if (value === null) return null;
  if (value === 'points' || value === 'overtime' || value === 'ranking') return value;
  return undefined;
}

function parseEntrant(
  value: unknown,
  index: number,
): ChampionshipCheckpointEntrant | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!id || id.length > 80 || !name || name.length > 80) return null;
  if (!isCount(input.seedPool) || input.seedPool < 1 || input.seedPool > CHAMPIONSHIP_POOLS) {
    return null;
  }
  if (!isGroupId(input.groupId)) return null;

  let setup: ModelSetup;
  try {
    setup = validateModelSetup(input.setup, `断点参赛模型 ${index + 1}`);
  } catch {
    return null;
  }

  return {
    id,
    name,
    seedPool: input.seedPool,
    groupId: input.groupId,
    setup,
  };
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

interface ParsedHeader {
  savedAt: number;
  championshipId: string;
  phase: ChampionshipCheckpointPhase;
  stage: ChampionshipStage | null;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

function parseHeader(input: Record<string, unknown>): ParsedHeader | null {
  if (
    typeof input.championshipId !== 'string' ||
    !input.championshipId.trim() ||
    input.championshipId.length > 128
  ) {
    return null;
  }
  if (typeof input.phase !== 'string' || !PHASES.has(input.phase as ChampionshipCheckpointPhase)) {
    return null;
  }
  if (input.stage !== null && !isStage(input.stage)) return null;
  if (!isFiniteNumber(input.savedAt) || !isFiniteNumber(input.startedAt)) return null;
  if (!isNullableNumber(input.finishedAt) || !isNullableString(input.error)) return null;

  return {
    savedAt: input.savedAt,
    championshipId: input.championshipId.trim(),
    phase: input.phase as ChampionshipCheckpointPhase,
    stage: input.stage as ChampionshipStage | null,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    error: input.error,
  };
}

interface ParsedEntrants {
  entrants: ChampionshipCheckpointEntrant[];
  entrantIds: Set<string>;
}

function parseEntrants(value: unknown): ParsedEntrants | null {
  if (!Array.isArray(value) || value.length !== CHAMPIONSHIP_ENTRANTS) return null;

  const entrants: ChampionshipCheckpointEntrant[] = [];
  const entrantIds = new Set<string>();
  const entrantNames = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const entrant = parseEntrant(value[index], index);
    if (!entrant) return null;
    if (entrantIds.has(entrant.id) || entrantNames.has(entrant.name.toLocaleLowerCase())) {
      return null;
    }
    entrantIds.add(entrant.id);
    entrantNames.add(entrant.name.toLocaleLowerCase());
    entrants.push(entrant);
  }

  // Exactly four entrants per group, one from every seed pool.
  const poolCounts = new Map<number, number>(
    CHAMPIONSHIP_SEED_POOLS.map((pool) => [pool, 0]),
  );
  for (const groupId of CHAMPIONSHIP_GROUPS) {
    const members = entrants.filter((entrant) => entrant.groupId === groupId);
    if (members.length !== CHAMPIONSHIP_ENTRANTS_PER_POOL) return null;
    if (new Set(members.map((member) => member.seedPool)).size !== CHAMPIONSHIP_POOLS) {
      return null;
    }
  }
  for (const entrant of entrants) {
    poolCounts.set(entrant.seedPool, (poolCounts.get(entrant.seedPool) ?? 0) + 1);
  }
  for (const pool of CHAMPIONSHIP_SEED_POOLS) {
    if (poolCounts.get(pool) !== CHAMPIONSHIP_ENTRANTS_PER_POOL) return null;
  }

  return { entrants, entrantIds };
}

/**
 * Parse one series node. Shared with the championship archive so both the
 * resumable checkpoint and the historical archive enforce the same six-game,
 * three-point rules.
 */
export function parseChampionshipSeriesView(
  value: unknown,
  entrantIds: ReadonlySet<string>,
): ChampionshipSeriesView | null {
  const input = asRecord(value);
  if (!input) return null;
  if (!isSeriesId(input.id)) return null;
  const spec = SERIES_SPEC[input.id];
  if (input.stage !== spec.stage || input.slot !== spec.slot) return null;
  if (typeof input.label !== 'string' || !input.label.trim()) return null;
  if (
    typeof input.status !== 'string' ||
    !SERIES_STATUSES.has(input.status as ChampionshipSeriesStatus)
  ) {
    return null;
  }

  const left = parseSeriesSide(input.left, entrantIds);
  const right = parseSeriesSide(input.right, entrantIds);
  if (left === undefined || right === undefined) return null;
  if (left && right && left.modelId === right.modelId) return null;

  if (
    !isCount(input.leftWins) ||
    !isCount(input.rightWins) ||
    !isCount(input.draws) ||
    !isCount(input.failed) ||
    !isCount(input.playedGames) ||
    !isCount(input.leftPoints) ||
    !isCount(input.rightPoints) ||
    !isCount(input.maxGames)
  ) {
    return null;
  }
  if (typeof input.overtime !== 'boolean' || typeof input.extra !== 'boolean') {
    return null;
  }
  if (input.maxGames !== CHAMPIONSHIP_SERIES_GAME_LIMIT) return null;

  // Every recorded game is exactly one of: a win, a draw, or a failure.
  if (input.playedGames !== input.leftWins + input.rightWins + input.draws + input.failed) {
    return null;
  }
  // Series points are fully derived from wins (1) and draws (1 for both).
  const expectedLeft =
    input.leftWins * CHAMPIONSHIP_SERIES_WIN_POINTS +
    input.draws * CHAMPIONSHIP_SERIES_DRAW_POINTS;
  const expectedRight =
    input.rightWins * CHAMPIONSHIP_SERIES_WIN_POINTS +
    input.draws * CHAMPIONSHIP_SERIES_DRAW_POINTS;
  if (input.leftPoints !== expectedLeft || input.rightPoints !== expectedRight) {
    return null;
  }

  // Only the identical-ranking tie-break may push a series past the cap.
  if (input.playedGames > input.maxGames && !input.extra) return null;
  if (input.extra && input.playedGames < input.maxGames) return null;
  if (input.overtime) {
    if (
      input.leftPoints < CHAMPIONSHIP_SERIES_POINTS_TARGET ||
      input.rightPoints < CHAMPIONSHIP_SERIES_POINTS_TARGET
    ) {
      return null;
    }
  }

  const noCounters =
    input.leftWins === 0 &&
    input.rightWins === 0 &&
    input.draws === 0 &&
    input.failed === 0 &&
    input.playedGames === 0 &&
    input.leftPoints === 0 &&
    input.rightPoints === 0 &&
    !input.overtime &&
    !input.extra;
  if ((!left || !right) && !noCounters) return null;
  if (input.status === 'running' && (!left || !right)) return null;
  if (input.status === 'finished' && (!left || !right)) return null;

  const decision = parseChampionshipSeriesDecision(input.decision);
  if (decision === undefined) return null;

  if (input.status === 'finished') {
    if (
      typeof input.winnerModelId !== 'string' ||
      !entrantIds.has(input.winnerModelId) ||
      (left && input.winnerModelId !== left.modelId && input.winnerModelId !== right?.modelId) ||
      decision === null
    ) {
      return null;
    }
  } else if (input.winnerModelId !== null || decision !== null) {
    return null;
  }

  return {
    id: input.id,
    stage: spec.stage,
    label: input.label.trim(),
    slot: spec.slot,
    status: input.status as ChampionshipSeriesStatus,
    left,
    right,
    leftWins: input.leftWins,
    rightWins: input.rightWins,
    leftPoints: input.leftPoints,
    rightPoints: input.rightPoints,
    draws: input.draws,
    failed: input.failed,
    playedGames: input.playedGames,
    maxGames: input.maxGames,
    overtime: input.overtime,
    extra: input.extra,
    winnerModelId: input.winnerModelId as string | null,
    decision,
  };
}

function parseSeriesSide(
  value: unknown,
  entrantIds: ReadonlySet<string>,
): ChampionshipSeriesView['left'] | undefined {
  if (value === null) return null;
  const side = asRecord(value);
  if (!side) return undefined;
  if (typeof side.modelId !== 'string' || !entrantIds.has(side.modelId)) return undefined;
  if (typeof side.name !== 'string' || !side.name.trim()) return undefined;
  return { modelId: side.modelId, name: side.name.trim() };
}

/**
 * Parse one game row. Shared with the championship archive; `seriesById` must
 * contain every series referenced by a knockout game.
 */
export function parseChampionshipGameView(
  value: unknown,
  entrantIds: ReadonlySet<string>,
  seriesById: ReadonlyMap<string, ChampionshipSeriesView>,
  gameIds: Set<string>,
): ChampionshipGameView | null {
  const input = asRecord(value);
  if (!input) return null;
  const id = typeof input.id === 'string' ? input.id.trim() : '';
  if (!id || gameIds.has(id)) return null;
  if (!isStage(input.stage)) return null;
  if (typeof input.status !== 'string' || !GAME_STATUSES.has(input.status)) return null;

  if (
    typeof input.redModelId !== 'string' ||
    !entrantIds.has(input.redModelId) ||
    typeof input.blackModelId !== 'string' ||
    !entrantIds.has(input.blackModelId) ||
    input.redModelId === input.blackModelId
  ) {
    return null;
  }
  if (typeof input.redName !== 'string' || typeof input.blackName !== 'string') return null;
  if (!isCount(input.pairIndex) || input.pairIndex < 1) return null;
  if (!isCount(input.gameIndex) || input.gameIndex < 1) return null;
  if (!isCount(input.plies)) return null;
  if (
    input.winnerModelId !== null &&
    (typeof input.winnerModelId !== 'string' || !entrantIds.has(input.winnerModelId))
  ) {
    return null;
  }
  const result = parseResult(input.result);
  if (result === undefined) return null;
  if (!isNullableString(input.error)) return null;
  if (
    input.failedSide !== null &&
    input.failedSide !== 'red' &&
    input.failedSide !== 'black'
  ) {
    return null;
  }
  if (!isNullableNumber(input.startedAt) || !isNullableNumber(input.finishedAt)) return null;
  if (!isNonNegativeNumber(input.durationMs)) return null;
  if (
    !isNonNegativeNumber(input.tokensIn) ||
    !isNonNegativeNumber(input.tokensOut) ||
    !isNonNegativeNumber(input.redTokensIn) ||
    !isNonNegativeNumber(input.redTokensOut) ||
    !isNonNegativeNumber(input.blackTokensIn) ||
    !isNonNegativeNumber(input.blackTokensOut)
  ) {
    return null;
  }

  let groupId: ChampionshipGroupId | null = null;
  let seriesId: string | null = null;
  if (input.stage === 'qualifier') {
    if (
      (input.groupId !== 'A' && input.groupId !== 'B') ||
      input.seriesId !== null
    ) {
      return null;
    }
    groupId = input.groupId;
    if (
      input.pairIndex > CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP ||
      input.gameIndex !== 1
    ) {
      return null;
    }
  } else if (input.stage === 'group') {
    if (!isGroupId(input.groupId) || input.seriesId !== null) return null;
    groupId = input.groupId;
    if (input.pairIndex > CHAMPIONSHIP_GROUP_GAMES_PER_GROUP || input.gameIndex !== 1) {
      return null;
    }
  } else {
    if (input.groupId !== null || typeof input.seriesId !== 'string') return null;
    const series = seriesById.get(input.seriesId);
    if (!series || series.stage !== input.stage) return null;
    seriesId = input.seriesId;
    if (input.pairIndex !== series.slot) return null;
  }

  gameIds.add(id);
  return {
    id,
    pairIndex: input.pairIndex,
    gameIndex: input.gameIndex,
    redModelId: input.redModelId,
    blackModelId: input.blackModelId,
    redName: input.redName,
    blackName: input.blackName,
    status: input.status as ChampionshipGameView['status'],
    plies: input.plies,
    winnerModelId: input.winnerModelId as string | null,
    result,
    error: input.error as string | null,
    failedSide: input.failedSide as 'red' | 'black' | null,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: input.durationMs,
    tokensIn: input.tokensIn,
    tokensOut: input.tokensOut,
    redTokensIn: input.redTokensIn,
    redTokensOut: input.redTokensOut,
    blackTokensIn: input.blackTokensIn,
    blackTokensOut: input.blackTokensOut,
    stage: input.stage,
    groupId,
    seriesId,
  };
}

function parseSeriesList(
  value: unknown,
  entrantIds: ReadonlySet<string>,
): ChampionshipSeriesView[] | null {
  if (!Array.isArray(value) || value.length !== CHAMPIONSHIP_SERIES_COUNT) return null;
  const series: ChampionshipSeriesView[] = [];
  const seriesIds = new Set<string>();
  for (const raw of value) {
    const parsed = parseChampionshipSeriesView(raw, entrantIds);
    if (!parsed || seriesIds.has(parsed.id)) return null;
    seriesIds.add(parsed.id);
    series.push(parsed);
  }
  if (SERIES_IDS.some((id) => !seriesIds.has(id))) return null;
  series.sort(
    (left, right) =>
      SERIES_IDS.indexOf(left.id as SeriesId) - SERIES_IDS.indexOf(right.id as SeriesId),
  );
  return series;
}

function parseGroupGames(
  value: unknown,
  entrantIds: ReadonlySet<string>,
): ChampionshipGameView[] | null {
  if (!Array.isArray(value) || value.length < CHAMPIONSHIP_GROUP_GAMES) return null;
  const games: ChampionshipGameView[] = [];
  const gameIds = new Set<string>();
  const seriesById = new Map<string, ChampionshipSeriesView>();
  for (const raw of value) {
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
  return games;
}

function parseV2(input: Record<string, unknown>): ChampionshipCheckpoint | null {
  const header = parseHeader(input);
  if (!header) return null;
  const entrantData = parseEntrants(input.entrants);
  if (!entrantData) return null;
  const series = parseSeriesList(input.series, entrantData.entrantIds);
  if (!series) return null;
  const seriesById = new Map(series.map((item) => [item.id, item]));

  if (!Array.isArray(input.games)) return null;
  const games: ChampionshipGameView[] = [];
  const gameIds = new Set<string>();
  for (const raw of input.games) {
    const parsed = parseChampionshipGameView(
      raw,
      entrantData.entrantIds,
      seriesById,
      gameIds,
    );
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
    version: 2,
    savedAt: header.savedAt,
    championshipId: header.championshipId,
    phase: header.phase,
    stage: header.stage,
    startedAt: header.startedAt,
    finishedAt: header.finishedAt,
    error: header.error,
    entrants: entrantData.entrants,
    games,
    series,
    concurrency: parseConcurrency(input.concurrency),
  };
}

/**
 * Version 1 accepted only group-only checkpoints: every game is a group game
 * and every bracket node is still an untouched pending series. The bracket is
 * rebuilt from a fresh version-2 skeleton because version 1 used the old
 * BO3/BO5 series format.
 */
function parseLegacyV1(input: Record<string, unknown>): ChampionshipCheckpoint | null {
  const header = parseHeader(input);
  if (!header) return null;
  const entrantData = parseEntrants(input.entrants);
  if (!entrantData) return null;

  if (!Array.isArray(input.games)) return null;
  for (const raw of input.games) {
    const game = asRecord(raw);
    if (!game || game.stage !== 'group' || game.seriesId !== null) return null;
  }
  const games = parseGroupGames(input.games, entrantData.entrantIds);
  if (!games) return null;

  // "All series pending / no knockout activity" — otherwise the old results
  // cannot be mapped onto the new scoring rules and the file is discarded.
  if (!Array.isArray(input.series) || input.series.length !== CHAMPIONSHIP_SERIES_COUNT) {
    return null;
  }
  const legacyIds = new Set<string>();
  for (const raw of input.series) {
    const series = asRecord(raw);
    if (!series) return null;
    if (!isSeriesId(series.id) || legacyIds.has(series.id)) return null;
    const spec = SERIES_SPEC[series.id];
    if (series.stage !== spec.stage || series.slot !== spec.slot) return null;
    if (series.status !== 'pending') return null;
    if (
      !isCount(series.leftWins) ||
      !isCount(series.rightWins) ||
      !isCount(series.draws) ||
      !isCount(series.failed) ||
      !isCount(series.playedGames)
    ) {
      return null;
    }
    if (
      series.leftWins !== 0 ||
      series.rightWins !== 0 ||
      series.draws !== 0 ||
      series.failed !== 0 ||
      series.playedGames !== 0 ||
      series.winnerModelId !== null ||
      series.decision !== null
    ) {
      return null;
    }
    legacyIds.add(series.id);
  }
  if (SERIES_IDS.some((id) => !legacyIds.has(id))) return null;

  return {
    version: 2,
    savedAt: header.savedAt,
    championshipId: header.championshipId,
    phase: header.phase,
    stage: header.stage,
    startedAt: header.startedAt,
    finishedAt: header.finishedAt,
    error: header.error,
    entrants: entrantData.entrants,
    games,
    series: createSeriesSkeleton(),
  };
}

/**
 * Parse and structurally validate a checkpoint file. Any malformed field makes
 * the whole checkpoint unusable: a half-restored bracket is worse than asking
 * the user to start a new edition.
 */
export function parseChampionshipCheckpoint(value: unknown): ChampionshipCheckpoint | null {
  const input = asRecord(value);
  if (!input) return null;
  if (input.version === 2) return parseV2(input);
  if (input.version === 1) return parseLegacyV1(input);
  return null;
}

function cloneCheckpoint(checkpoint: ChampionshipCheckpoint): ChampionshipCheckpoint {
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
    series: checkpoint.series.map((series) => ({
      ...series,
      left: series.left ? { ...series.left } : null,
      right: series.right ? { ...series.right } : null,
    })),
  };
}

/**
 * Atomic JSON checkpoint store. The file contains model runtime setups (API
 * keys) because a restart cannot otherwise authenticate model calls; it is
 * created with owner-only permissions and is never served over HTTP.
 */
export class ChampionshipCheckpointStore {
  private readonly filePath: string | null;
  private latest: ChampionshipCheckpoint | null = null;

  constructor(options: ChampionshipCheckpointStoreOptions = {}) {
    this.filePath =
      options.filePath === undefined
        ? DEFAULT_CHAMPIONSHIP_CHECKPOINT_FILE
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

  load(): ChampionshipCheckpoint | null {
    return this.latest ? cloneCheckpoint(this.latest) : null;
  }

  /** Persist a snapshot. Returns false when the local file cannot be written. */
  save(checkpoint: ChampionshipCheckpoint): boolean {
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
        '[championship] failed to save checkpoint:',
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
        '[championship] failed to clear checkpoint:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private reload(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      const checkpoint = parseChampionshipCheckpoint(parsed);
      if (!checkpoint) {
        console.warn(
          '[championship] ignored an invalid or incompatible checkpoint file',
        );
        return;
      }
      this.latest = checkpoint;
    } catch (error) {
      console.warn(
        '[championship] failed to read checkpoint; starting without resume:',
        error instanceof Error ? error.message : error,
      );
    }
  }
}
