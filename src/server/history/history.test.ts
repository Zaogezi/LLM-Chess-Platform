import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ArenaState,
  ChampionshipGameView,
  MoveView,
  TournamentGameView,
  TournamentModelView,
} from '../../shared/protocol';
import { XiangqiGame } from '../xiangqi/index';
import type { ArenaCompletion } from '../arena/arena';
import type { ChampionshipGameCompletion } from '../championship/championship';
import type { TournamentGameCompletion } from '../tournament/tournament';
import { HistoryQueryError, HistoryStore, validateHistoryQuery } from './history';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempFile(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'xiangqi-history-'));
  tempDirs.push(dir);
  return path.join(dir, 'history.jsonl');
}

const move: MoveView = {
  ply: 1,
  side: 'red',
  ucci: 'h2e2',
  notation: '炮二平五',
  pieceLabel: '炮',
  capturedLabel: null,
  reason: '中炮开局',
  latencyMs: 1200,
  tokensIn: 120,
  tokensOut: 30,
  at: 1_700_000_000_000,
};

function arenaState(): ArenaState {
  const game = XiangqiGame.initial();
  return {
    revision: 3,
    phase: 'finished',
    matchId: 'match-1',
    fen: game.fen,
    board: game.board,
    turn: 'black',
    moveNumber: 1,
    ply: 1,
    checked: false,
    lastMove: { fromUcci: 'h2', toUcci: 'e2', side: 'red' },
    moves: [move],
    models: {
      red: {
        provider: 'openai',
        model: 'red-model',
        displayName: 'red-model',
        thinkingLevel: 'deep',
        apiReasoning: true,
        keyConfigured: true,
        thinking: false,
        thinkingSince: null,
        lastLatencyMs: 1200,
        reason: '中炮开局',
        totalTokensIn: 120,
        totalTokensOut: 30,
        attempts: 1,
        lastError: null,
      },
      black: {
        provider: 'anthropic',
        model: 'black-model',
        displayName: 'black-model',
        thinkingLevel: 'quick',
        apiReasoning: false,
        keyConfigured: false,
        thinking: false,
        thinkingSince: null,
        lastLatencyMs: null,
        reason: null,
        totalTokensIn: 80,
        totalTokensOut: 20,
        attempts: 0,
        lastError: null,
      },
    },
    result: { winner: 'red', reason: 'checkmate', text: '红方将死黑方' },
    error: null,
    settings: { moveDelayMs: 0, maxAttempts: 3 },
  };
}

function arenaCompletion(endedAt = 1_700_000_010_000): ArenaCompletion {
  return {
    state: arenaState(),
    startedAt: endedAt - 10_000,
    endedAt,
  };
}

function tournamentModel(id: string, name: string): TournamentModelView {
  return {
    id,
    name,
    provider: 'openai',
    model: `${name.toLowerCase()}-model`,
    thinkingLevel: 'balanced',
    apiReasoning: false,
    keyConfigured: false,
  };
}

function tournamentGame(overrides: Partial<TournamentGameView> = {}): TournamentGameView {
  return {
    id: 'g1',
    pairIndex: 1,
    gameIndex: 1,
    redModelId: 'm1',
    blackModelId: 'm2',
    redName: 'Alpha',
    blackName: 'Beta',
    status: 'finished',
    plies: 1,
    winnerModelId: 'm1',
    result: { winner: 'red', reason: 'checkmate', text: '红方将死黑方' },
    error: null,
    failedSide: null,
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_005_000,
    durationMs: 5_000,
    tokensIn: 200,
    tokensOut: 50,
    redTokensIn: 120,
    redTokensOut: 30,
    blackTokensIn: 80,
    blackTokensOut: 20,
    ...overrides,
  };
}

function tournamentCompletion(
  overrides: Partial<TournamentGameView> = {},
): TournamentGameCompletion {
  return {
    tournamentId: 'tournament-1',
    gamesPerPair: 2,
    game: tournamentGame(overrides),
    finalState: arenaState(),
    red: tournamentModel('m1', 'Alpha'),
    black: tournamentModel('m2', 'Beta'),
  };
}

function championshipGame(overrides: Partial<ChampionshipGameView> = {}): ChampionshipGameView {
  return {
    ...tournamentGame(overrides),
    stage: 'group',
    groupId: 'A',
    seriesId: null,
    ...overrides,
  };
}

function championshipCompletion(
  overrides: Partial<ChampionshipGameView> = {},
): ChampionshipGameCompletion {
  return {
    championshipId: 'championship-1',
    game: championshipGame(overrides),
    finalState: arenaState(),
    red: { ...tournamentModel('m1', 'Alpha'), seedPool: 1, groupId: 'A' },
    black: { ...tournamentModel('m2', 'Beta'), seedPool: 2, groupId: 'A' },
  };
}

describe('HistoryStore', () => {
  it('records arena games without secrets and maps winners/tokens', () => {
    const store = new HistoryStore({ filePath: null });
    const record = store.recordArenaGame(arenaCompletion());

    expect(record).not.toBeNull();
    expect(record).toMatchObject({
      mode: 'arena',
      status: 'finished',
      winnerSide: 'red',
      plies: 1,
      red: { name: 'red-model', thinkingLevel: 'deep', apiReasoning: true },
      black: { name: 'black-model' },
      redTokensIn: 120,
      redTokensOut: 30,
      blackTokensIn: 80,
      blackTokensOut: 20,
      tokensIn: 200,
      tokensOut: 50,
      durationMs: 10_000,
      tournament: null,
    });
    expect(JSON.stringify(store.get(record!.id))).not.toContain('apiKey');
  });

  it('records tournament games with round and pairing context', () => {
    const store = new HistoryStore({ filePath: null });
    const record = store.recordTournamentGame(tournamentCompletion());

    expect(record).toMatchObject({
      mode: 'tournament',
      status: 'finished',
      winnerSide: 'red',
      tournament: {
        tournamentId: 'tournament-1',
        pairIndex: 1,
        gameIndex: 1,
        gamesPerPair: 2,
      },
      red: { name: 'Alpha', model: 'alpha-model' },
      black: { name: 'Beta', model: 'beta-model' },
    });
  });

  it('records failed tournament games and keeps them out of finished stats', () => {
    const store = new HistoryStore({ filePath: null });
    store.recordArenaGame(arenaCompletion());
    const failed = store.recordTournamentGame(
      tournamentCompletion({
        status: 'failed',
        result: null,
        winnerModelId: null,
        failedSide: 'black',
        error: 'HTTP 401',
      }),
    );

    expect(failed).toMatchObject({ status: 'failed', failedSide: 'black', error: 'HTTP 401' });
    expect(store.stats()).toMatchObject({
      total: 2,
      arena: 1,
      tournament: 1,
      championship: 0,
      finished: 1,
      failed: 1,
    });
  });

  it('records championship games with group/series context', () => {
    const store = new HistoryStore({ filePath: null });
    const groupGame = store.recordChampionshipGame(championshipCompletion());
    const seriesGame = store.recordChampionshipGame(
      championshipCompletion({
        id: 'g49',
        stage: 'quarterfinal',
        groupId: null,
        seriesId: 'qf1',
        gameIndex: 4,
        status: 'failed',
        result: null,
        winnerModelId: null,
        failedSide: 'red',
        error: 'HTTP 500',
      }),
    );

    expect(groupGame).toMatchObject({
      mode: 'championship',
      tournament: null,
      championship: {
        championshipId: 'championship-1',
        stage: 'group',
        groupId: 'A',
        seriesId: null,
        pairIndex: 1,
        gameIndex: 1,
      },
      red: { name: 'Alpha' },
      black: { name: 'Beta' },
    });
    expect(seriesGame).toMatchObject({
      mode: 'championship',
      status: 'failed',
      championship: {
        stage: 'quarterfinal',
        groupId: null,
        seriesId: 'qf1',
        pairIndex: 1,
        gameIndex: 4,
      },
    });
    expect(store.stats()).toMatchObject({
      total: 2,
      arena: 0,
      tournament: 0,
      championship: 2,
      finished: 1,
      failed: 1,
    });
    const filtered = store.list({
      limit: 10,
      offset: 0,
      mode: 'championship',
      status: null,
      q: 'championship-1',
    });
    expect(filtered.total).toBe(2);
  });

  it('filters, searches and paginates newest first', () => {
    const store = new HistoryStore({ filePath: null });
    store.recordArenaGame(arenaCompletion(1_700_000_010_000));
    store.recordArenaGame(arenaCompletion(1_700_000_020_000));
    store.recordTournamentGame(tournamentCompletion({ error: 'timeout' }));

    const all = store.list({ limit: 10, offset: 0, mode: null, status: null, q: '' });
    expect(all.total).toBe(3);
    expect(all.records[0]?.mode).toBe('tournament');
    expect(all.limit).toBe(10);

    const page = store.list({ limit: 1, offset: 1, mode: null, status: null, q: '' });
    expect(page.total).toBe(3);
    expect(page.records).toHaveLength(1);

    const searched = store.list({
      limit: 10,
      offset: 0,
      mode: 'arena',
      status: null,
      q: 'RED-MODEL',
    });
    expect(searched.total).toBe(2);
    expect(searched.records.every((record) => record.mode === 'arena')).toBe(true);

    const failed = store.list({
      limit: 10,
      offset: 0,
      mode: 'tournament',
      status: 'failed',
      q: 'timeout',
    });
    expect(failed.total).toBe(0);
  });

  it('persists across store instances and supports remove/clear', () => {
    const file = tempFile();
    const first = new HistoryStore({ filePath: file });
    const kept = first.recordArenaGame(arenaCompletion(1_700_000_010_000));
    const removed = first.recordArenaGame(arenaCompletion(1_700_000_020_000));
    expect(kept && removed).toBeTruthy();
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2);

    const second = new HistoryStore({ filePath: file });
    expect(second.size).toBe(2);
    expect(second.get(kept!.id)).toMatchObject({ mode: 'arena' });
    expect(second.remove(removed!.id)).toBe(1);
    expect(second.size).toBe(1);

    const third = new HistoryStore({ filePath: file });
    expect(third.size).toBe(1);
    expect(third.clear()).toBe(1);
    expect(third.size).toBe(0);

    const fourth = new HistoryStore({ filePath: file });
    expect(fourth.size).toBe(0);
  });

  it('skips malformed archive lines and tolerates a missing file', () => {
    const file = tempFile();
    const store = new HistoryStore({ filePath: file });
    store.recordArenaGame(arenaCompletion());
    const lines = readFileSync(file, 'utf8');
    writeFileSync(file, `${lines}{not json}\n`, 'utf8');

    const reloaded = new HistoryStore({ filePath: file });
    expect(reloaded.size).toBe(1);
    expect(new HistoryStore({ filePath: path.join(path.dirname(file), 'missing.jsonl') }).size).toBe(0);
  });
});

describe('validateHistoryQuery', () => {
  it('applies defaults and accepts filters', () => {
    expect(validateHistoryQuery({})).toEqual({
      limit: 20,
      offset: 0,
      mode: null,
      status: null,
      q: '',
    });
    expect(() =>
      validateHistoryQuery({ limit: '5', offset: '2', mode: 'tar', status: 'x' }),
    ).toThrow(HistoryQueryError);
    expect(
      validateHistoryQuery({ limit: '5', offset: '2', mode: 'tournament', status: 'failed', q: ' Alpha ' }),
    ).toEqual({ limit: 5, offset: 2, mode: 'tournament', status: 'failed', q: 'Alpha' });
    expect(validateHistoryQuery({ mode: 'championship' }).mode).toBe('championship');
  });

  it.each([
    [{ limit: '0' }],
    [{ limit: '101' }],
    [{ limit: '1.5' }],
    [{ offset: '-1' }],
    [{ mode: 'unknown' }],
    [{ status: 'canceled' }],
  ])('rejects invalid query %#', (query) => {
    expect(() => validateHistoryQuery(query)).toThrow(HistoryQueryError);
  });
});
