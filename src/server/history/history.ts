import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type {
  ArenaState,
  HistoryChampionshipRef,
  HistoryGameRecord,
  HistoryGameSummary,
  HistoryListResponse,
  HistoryMode,
  HistoryPlayer,
  HistoryStats,
  HistoryStatus,
  MoveView,
  Side,
  TournamentGameView,
  TournamentModelView,
} from '../../shared/protocol';
import {
  DEFAULT_THINKING_LEVEL,
  HISTORY_PAGE_SIZE_DEFAULT,
  HISTORY_PAGE_SIZE_MAX,
} from '../../shared/protocol';
import type { ArenaCompletion } from '../arena/arena';
import type { ChampionshipGameCompletion } from '../championship/championship';
import type { QualifierGameCompletion } from '../championship/qualifier';
import type { TournamentGameCompletion } from '../tournament/tournament';

export interface HistoryStoreOptions {
  /**
   * JSONL file path. Pass null for an in-memory store (tests). When omitted,
   * records are kept in `data/history.jsonl` under the process working dir.
   */
  filePath?: string | null;
}

export interface HistoryQuery {
  limit: number;
  offset: number;
  mode: HistoryMode | null;
  status: HistoryStatus | null;
  q: string;
}

const DEFAULT_FILE = path.resolve(process.cwd(), 'data', 'history.jsonl');

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isPlayer(value: unknown): value is HistoryPlayer {
  const player = asRecord(value);
  return Boolean(
    player &&
      typeof player.name === 'string' &&
      (player.provider === 'openai' || player.provider === 'anthropic') &&
      typeof player.model === 'string' &&
      typeof player.thinkingLevel === 'string' &&
      player.thinkingLevel.trim().length > 0 &&
      typeof player.apiReasoning === 'boolean',
  );
}

function isMove(value: unknown): value is MoveView {
  const move = asRecord(value);
  return Boolean(
    move &&
      typeof move.ply === 'number' &&
      (move.side === 'red' || move.side === 'black') &&
      typeof move.ucci === 'string' &&
      typeof move.notation === 'string' &&
      typeof move.reason === 'string',
  );
}

function isChampionshipRef(value: unknown): value is HistoryChampionshipRef {
  if (value === undefined || value === null) return true;
  const ref = asRecord(value);
  if (!ref) return false;
  const stage = ref.stage;
  const knownStage =
    stage === 'qualifier' ||
    stage === 'group' ||
    stage === 'quarterfinal' ||
    stage === 'semifinal' ||
    stage === 'final';
  if (!knownStage) return false;
  const groupId = ref.groupId;
  const knownGroup =
    groupId === null ||
    groupId === 'A' ||
    groupId === 'B' ||
    groupId === 'C' ||
    groupId === 'D';
  if (!knownGroup) return false;
  // Qualifying games always belong to one of the two qualifying groups and
  // never to a knockout series.
  if (stage === 'qualifier' && ((groupId !== 'A' && groupId !== 'B') || ref.seriesId !== null)) {
    return false;
  }
  return Boolean(
    typeof ref.championshipId === 'string' &&
      (ref.seriesId === null || typeof ref.seriesId === 'string') &&
      typeof ref.pairIndex === 'number' &&
      typeof ref.gameIndex === 'number',
  );
}

function isStoredRecord(value: unknown): value is HistoryGameRecord {
  const record = asRecord(value);
  return Boolean(
    record &&
      typeof record.id === 'string' &&
      (record.mode === 'arena' ||
        record.mode === 'tournament' ||
        record.mode === 'championship') &&
      (record.status === 'finished' || record.status === 'failed') &&
      typeof record.startedAt === 'number' &&
      typeof record.endedAt === 'number' &&
      isPlayer(record.red) &&
      isPlayer(record.black) &&
      isChampionshipRef(record.championship) &&
      Array.isArray(record.moves) &&
      record.moves.every(isMove),
  );
}

function toSummary(record: HistoryGameRecord): HistoryGameSummary {
  const { moves: _moves, ...summary } = record;
  return summary;
}

function arenaPlayer(
  view: ArenaState['models']['red'],
  side: Side,
): HistoryPlayer {
  if (!view) {
    return {
      name: side === 'red' ? '红方' : '黑方',
      provider: 'openai',
      model: '未知模型',
      thinkingLevel: DEFAULT_THINKING_LEVEL,
      apiReasoning: false,
    };
  }
  return {
    name: view.displayName || view.model,
    provider: view.provider,
    model: view.model,
    thinkingLevel: view.thinkingLevel,
    apiReasoning: view.apiReasoning,
  };
}

function tournamentPlayer(view: TournamentModelView): HistoryPlayer {
  return {
    name: view.name,
    provider: view.provider,
    model: view.model,
    thinkingLevel: view.thinkingLevel,
    apiReasoning: view.apiReasoning,
  };
}

function copyMoves(moves: readonly MoveView[]): MoveView[] {
  return moves.map((move) => ({ ...move }));
}

/**
 * Append-only JSONL archive of completed games. Records live in memory for
 * fast querying and are persisted across restarts. API keys never enter this
 * store: callers only provide public model summaries and played moves.
 */
export class HistoryStore {
  private readonly filePath: string | null;
  private records: HistoryGameRecord[] = [];

  constructor(options: HistoryStoreOptions = {}) {
    this.filePath =
      options.filePath === undefined ? DEFAULT_FILE : options.filePath;
    this.load();
  }

  get size(): number {
    return this.records.length;
  }

  recordArenaGame(completion: ArenaCompletion): HistoryGameRecord | null {
    const state = completion.state;
    if (state.phase !== 'finished' || !state.result) return null;

    const endedAt = completion.endedAt;
    const startedAt = Math.min(completion.startedAt, endedAt);
    const result = state.result;
    const red = arenaPlayer(state.models.red, 'red');
    const black = arenaPlayer(state.models.black, 'black');
    const redTokensIn = state.models.red?.totalTokensIn ?? 0;
    const redTokensOut = state.models.red?.totalTokensOut ?? 0;
    const blackTokensIn = state.models.black?.totalTokensIn ?? 0;
    const blackTokensOut = state.models.black?.totalTokensOut ?? 0;

    return this.add({
      id: randomUUID(),
      mode: 'arena',
      status: 'finished',
      startedAt,
      endedAt,
      durationMs: Math.max(0, endedAt - startedAt),
      red,
      black,
      result: { ...result },
      winnerSide: result.winner,
      failedSide: null,
      error: null,
      plies: state.ply,
      tokensIn: redTokensIn + blackTokensIn,
      tokensOut: redTokensOut + blackTokensOut,
      redTokensIn,
      redTokensOut,
      blackTokensIn,
      blackTokensOut,
      tournament: null,
      championship: null,
      moves: copyMoves(state.moves),
    });
  }

  recordTournamentGame(completion: TournamentGameCompletion): HistoryGameRecord | null {
    const game = completion.game;
    if (game.status !== 'finished' && game.status !== 'failed') return null;

    const endedAt = game.finishedAt ?? Date.now();
    const startedAt = game.startedAt ?? endedAt;
    return this.add({
      id: randomUUID(),
      mode: 'tournament',
      status: game.status,
      startedAt,
      endedAt,
      durationMs: Math.max(0, game.durationMs),
      red: tournamentPlayer(completion.red),
      black: tournamentPlayer(completion.black),
      result: game.result ? { ...game.result } : null,
      winnerSide: game.result?.winner ?? null,
      failedSide: game.failedSide,
      error: game.error,
      plies: game.plies,
      tokensIn: game.tokensIn,
      tokensOut: game.tokensOut,
      redTokensIn: game.redTokensIn,
      redTokensOut: game.redTokensOut,
      blackTokensIn: game.blackTokensIn,
      blackTokensOut: game.blackTokensOut,
      tournament: {
        tournamentId: completion.tournamentId,
        pairIndex: game.pairIndex,
        gameIndex: game.gameIndex,
        gamesPerPair: completion.gamesPerPair,
      },
      championship: null,
      moves: copyMoves(completion.finalState.moves),
    });
  }

  recordChampionshipGame(
    completion: ChampionshipGameCompletion,
  ): HistoryGameRecord | null {
    const game = completion.game;
    if (game.status !== 'finished' && game.status !== 'failed') return null;

    const endedAt = game.finishedAt ?? Date.now();
    const startedAt = game.startedAt ?? endedAt;
    return this.add({
      id: randomUUID(),
      mode: 'championship',
      status: game.status,
      startedAt,
      endedAt,
      durationMs: Math.max(0, game.durationMs),
      red: tournamentPlayer(completion.red),
      black: tournamentPlayer(completion.black),
      result: game.result ? { ...game.result } : null,
      winnerSide: game.result?.winner ?? null,
      failedSide: game.failedSide,
      error: game.error,
      plies: game.plies,
      tokensIn: game.tokensIn,
      tokensOut: game.tokensOut,
      redTokensIn: game.redTokensIn,
      redTokensOut: game.redTokensOut,
      blackTokensIn: game.blackTokensIn,
      blackTokensOut: game.blackTokensOut,
      tournament: null,
      championship: {
        championshipId: completion.championshipId,
        stage: game.stage,
        groupId: game.groupId,
        seriesId: game.seriesId,
        pairIndex: game.pairIndex,
        gameIndex: game.gameIndex,
      },
      moves: copyMoves(completion.finalState.moves),
    });
  }

  /**
   * Qualifying-round games are archived as championship games with
   * `stage: 'qualifier'`; the ref id is the qualifying-round id.
   */
  recordQualifierGame(
    completion: QualifierGameCompletion,
  ): HistoryGameRecord | null {
    const game = completion.game;
    if (game.status !== 'finished' && game.status !== 'failed') return null;
    if (game.groupId !== 'A' && game.groupId !== 'B') return null;

    const endedAt = game.finishedAt ?? Date.now();
    const startedAt = game.startedAt ?? endedAt;
    return this.add({
      id: randomUUID(),
      mode: 'championship',
      status: game.status,
      startedAt,
      endedAt,
      durationMs: Math.max(0, game.durationMs),
      red: tournamentPlayer(completion.red),
      black: tournamentPlayer(completion.black),
      result: game.result ? { ...game.result } : null,
      winnerSide: game.result?.winner ?? null,
      failedSide: game.failedSide,
      error: game.error,
      plies: game.plies,
      tokensIn: game.tokensIn,
      tokensOut: game.tokensOut,
      redTokensIn: game.redTokensIn,
      redTokensOut: game.redTokensOut,
      blackTokensIn: game.blackTokensIn,
      blackTokensOut: game.blackTokensOut,
      tournament: null,
      championship: {
        championshipId: completion.qualifierId,
        stage: 'qualifier',
        groupId: game.groupId,
        seriesId: null,
        pairIndex: game.pairIndex,
        gameIndex: game.gameIndex,
      },
      moves: copyMoves(completion.finalState.moves),
    });
  }

  list(query: HistoryQuery): HistoryListResponse {
    const needle = query.q.trim().toLocaleLowerCase();
    const filtered = this.records.filter((record) => {
      if (query.mode && record.mode !== query.mode) return false;
      if (query.status && record.status !== query.status) return false;
      if (!needle) return true;
      const haystack = [
        record.red.name,
        record.red.model,
        record.black.name,
        record.black.model,
        record.result?.text ?? '',
        record.result?.reason ?? '',
        record.error ?? '',
        record.tournament?.tournamentId ?? '',
        record.championship?.championshipId ?? '',
        record.championship?.groupId ?? '',
        record.championship?.stage ?? '',
        record.championship?.seriesId ?? '',
      ]
        .join(' ')
        .toLocaleLowerCase();
      return haystack.includes(needle);
    });

    return {
      records: filtered
        .slice(query.offset, query.offset + query.limit)
        .map(toSummary),
      total: filtered.length,
      limit: query.limit,
      offset: query.offset,
      stats: this.computeStats(),
    };
  }

  get(id: string): HistoryGameRecord | null {
    const found = this.records.find((record) => record.id === id);
    return found
      ? { ...found, red: { ...found.red }, black: { ...found.black }, moves: copyMoves(found.moves) }
      : null;
  }

  remove(id: string): number {
    const index = this.records.findIndex((record) => record.id === id);
    if (index < 0) return 0;
    this.records.splice(index, 1);
    this.rewrite();
    return 1;
  }

  clear(): number {
    const removed = this.records.length;
    this.records = [];
    this.rewrite();
    return removed;
  }

  stats(): HistoryStats {
    return this.computeStats();
  }

  private add(record: HistoryGameRecord): HistoryGameRecord {
    this.records.unshift(record);
    this.append(record);
    return record;
  }

  private computeStats(): HistoryStats {
    let arena = 0;
    let tournament = 0;
    let championship = 0;
    let finished = 0;
    let failed = 0;
    let totalPlies = 0;
    let firstAt: number | null = null;
    let lastAt: number | null = null;

    for (const record of this.records) {
      if (record.mode === 'arena') arena += 1;
      else if (record.mode === 'tournament') tournament += 1;
      else championship += 1;
      if (record.status === 'finished') finished += 1;
      else failed += 1;
      totalPlies += record.plies;
      firstAt =
        firstAt === null ? record.startedAt : Math.min(firstAt, record.startedAt);
      lastAt = lastAt === null ? record.endedAt : Math.max(lastAt, record.endedAt);
    }

    return {
      total: this.records.length,
      arena,
      tournament,
      championship,
      finished,
      failed,
      totalPlies,
      firstAt,
      lastAt,
    };
  }

  private load(): void {
    if (!this.filePath || !existsSync(this.filePath)) return;

    let content: string;
    try {
      content = readFileSync(this.filePath, 'utf8');
    } catch (error) {
      console.error(
        '[history] failed to read archive:',
        error instanceof Error ? error.message : error,
      );
      return;
    }

    let skipped = 0;
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isStoredRecord(parsed)) {
          skipped += 1;
          continue;
        }
        this.records.push(parsed);
      } catch {
        skipped += 1;
      }
    }
    if (skipped > 0) {
      console.warn(`[history] skipped ${skipped} malformed archive line(s)`);
    }
    this.records.sort((a, b) => b.endedAt - a.endedAt);
  }

  private append(record: HistoryGameRecord): void {
    if (!this.filePath) return;
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (error) {
      console.error(
        '[history] failed to append record:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  private rewrite(): void {
    if (!this.filePath) return;
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const content = this.records
        .map((record) => JSON.stringify(record))
        .join('\n');
      writeFileSync(this.filePath, content ? `${content}\n` : '', 'utf8');
    } catch (error) {
      console.error(
        '[history] failed to rewrite archive:',
        error instanceof Error ? error.message : error,
      );
    }
  }
}

/** Query validation lives beside the store so HTTP and tests share it. */
export function validateHistoryQuery(query: unknown): HistoryQuery {
  const record = asRecord(query) ?? {};
  const limit = parseInteger(
    record.limit,
    HISTORY_PAGE_SIZE_DEFAULT,
    1,
    HISTORY_PAGE_SIZE_MAX,
    '每页数量',
  );
  const offset = parseInteger(record.offset, 0, 0, 1_000_000, '偏移量');
  const mode = parseMode(record.mode);
  const status = parseStatus(record.status);
  const q = typeof record.q === 'string' ? record.q.trim().slice(0, 100) : '';
  return { limit, offset, mode, status, q };
}

function parseInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (value === undefined || value === null || value === '') return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new HistoryQueryError(`${label}必须是 ${min} 到 ${max} 之间的整数`);
  }
  return number;
}

function parseMode(value: unknown): HistoryMode | null {
  if (value === undefined || value === null || value === '' || value === 'all') return null;
  if (value === 'arena' || value === 'tournament' || value === 'championship') return value;
  throw new HistoryQueryError('mode 必须是 arena、tournament、championship 或 all');
}

function parseStatus(value: unknown): HistoryStatus | null {
  if (value === undefined || value === null || value === '' || value === 'all') return null;
  if (value === 'finished' || value === 'failed') return value;
  throw new HistoryQueryError('status 必须是 finished、failed 或 all');
}

export class HistoryQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryQueryError';
  }
}
