import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ArenaState,
  HistoryListResponse,
  MoveView,
  TournamentGameView,
} from '../../shared/protocol';
import type { Arena } from '../arena/arena';
import { createApp } from '../app';
import { ModelProfileStore } from '../models/profiles';
import type { Tournament } from '../tournament/tournament';
import type { TournamentGameCompletion } from '../tournament/tournament';
import { HistoryStore } from './history';

interface Fixture {
  baseUrl: string;
  history: HistoryStore;
  arena: Arena;
  tournament: Tournament;
  close: () => Promise<void>;
}

const fixtures: Fixture[] = [];

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    fixture?.arena.dispose();
    fixture?.tournament.dispose();
    await fixture?.close();
  }
});

const move: MoveView = {
  ply: 1,
  side: 'red',
  ucci: 'h2e2',
  notation: '炮二平五',
  pieceLabel: '炮',
  capturedLabel: null,
  reason: '中炮开局',
  latencyMs: 800,
  tokensIn: 100,
  tokensOut: 20,
  at: 1_700_000_000_000,
};

function arenaState(): ArenaState {
  return {
    revision: 2,
    phase: 'finished',
    matchId: 'match-api',
    fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
    board: Array.from({ length: 90 }, () => null),
    turn: 'black',
    moveNumber: 1,
    ply: 1,
    checked: false,
    lastMove: null,
    moves: [move],
    models: {
      red: {
        provider: 'openai',
        model: 'red-model',
        displayName: 'red-model',
        thinkingLevel: 'quick',
        apiReasoning: false,
        keyConfigured: true,
        thinking: false,
        thinkingSince: null,
        lastLatencyMs: 800,
        reason: '中炮开局',
        totalTokensIn: 100,
        totalTokensOut: 20,
        attempts: 1,
        lastError: null,
      },
      black: null,
    },
    result: { winner: 'red', reason: 'checkmate', text: '红方将死黑方' },
    error: null,
    settings: { moveDelayMs: 0, maxAttempts: 1 },
  };
}

function addArenaRecord(history: HistoryStore): void {
  history.recordArenaGame({
    state: arenaState(),
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_005_000,
  });
}

function game(overrides: Partial<TournamentGameView> = {}): TournamentGameView {
  return {
    id: 'g1',
    pairIndex: 1,
    gameIndex: 1,
    redModelId: 'm1',
    blackModelId: 'm2',
    redName: 'Alpha',
    blackName: 'Beta',
    status: 'failed',
    plies: 12,
    winnerModelId: null,
    result: null,
    error: 'HTTP 500: upstream unavailable',
    failedSide: 'black',
    startedAt: 1_700_000_000_000,
    finishedAt: 1_700_000_008_000,
    durationMs: 8_000,
    tokensIn: 80,
    tokensOut: 10,
    redTokensIn: 50,
    redTokensOut: 5,
    blackTokensIn: 30,
    blackTokensOut: 5,
    ...overrides,
  };
}

function addTournamentRecord(history: HistoryStore): void {
  const completion: TournamentGameCompletion = {
    tournamentId: 'tournament-api',
    gamesPerPair: 2,
    game: game(),
    finalState: arenaState(),
    red: {
      id: 'm1',
      name: 'Alpha',
      provider: 'openai',
      model: 'alpha-model',
      thinkingLevel: 'quick',
      apiReasoning: false,
      keyConfigured: false,
    },
    black: {
      id: 'm2',
      name: 'Beta',
      provider: 'anthropic',
      model: 'beta-model',
      thinkingLevel: 'deep',
      apiReasoning: true,
      keyConfigured: false,
    },
  };
  history.recordTournamentGame(completion);
}

async function startApi(): Promise<Fixture> {
  const history = new HistoryStore({ filePath: null });
  addArenaRecord(history);
  addTournamentRecord(history);

  const { app, arena, tournament } = createApp({
    history,
    profiles: new ModelProfileStore({ filePath: null }),
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  const fixture = { baseUrl, history, arena, tournament, close };
  fixtures.push(fixture);
  return fixture;
}

describe('history HTTP API', () => {
  it('lists summaries, stats and filtered pages without exposing moves', async () => {
    const { baseUrl } = await startApi();

    const response = await fetch(`${baseUrl}/api/history?limit=10`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as HistoryListResponse;
    expect(payload.total).toBe(2);
    expect(payload.stats).toMatchObject({
      total: 2,
      arena: 1,
      tournament: 1,
      championship: 0,
      finished: 1,
      failed: 1,
    });
    expect(payload.records).toHaveLength(2);
    expect(payload.records[0]).not.toHaveProperty('moves');

    const filtered = await fetch(
      `${baseUrl}/api/history?mode=tournament&status=failed&q=alpha`,
    );
    expect(filtered.status).toBe(200);
    const filteredPayload = (await filtered.json()) as HistoryListResponse;
    expect(filteredPayload.total).toBe(1);
    expect(filteredPayload.records[0]?.black.name).toBe('Beta');
    expect(filteredPayload.total).toBe(1);

    const page = await fetch(`${baseUrl}/api/history?limit=1&offset=1`);
    const pagePayload = (await page.json()) as HistoryListResponse;
    expect(pagePayload.records).toHaveLength(1);
    expect(pagePayload.total).toBe(2);

    const invalid = await fetch(`${baseUrl}/api/history?limit=0`);
    expect(invalid.status).toBe(400);
  });

  it('serves a full record by id and deletes records', async () => {
    const { baseUrl, history } = await startApi();
    const summary = history.list({ limit: 1, offset: 0, mode: 'arena', status: null, q: '' })
      .records[0];
    if (!summary) throw new Error('missing seeded record');

    const detail = await fetch(`${baseUrl}/api/history/${summary.id}`);
    expect(detail.status).toBe(200);
    const record = (await detail.json()) as { moves: MoveView[]; result?: unknown; red: unknown };
    expect(record.moves).toHaveLength(1);
    expect(record.result).toMatchObject({ reason: 'checkmate' });
    expect(JSON.stringify(record)).not.toContain('apiKey');

    const missing = await fetch(`${baseUrl}/api/history/not-found`);
    expect(missing.status).toBe(404);

    const deleted = await fetch(`${baseUrl}/api/history/${summary.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ removed: 1, total: 1 });
    expect((await fetch(`${baseUrl}/api/history/${summary.id}`)).status).toBe(404);

    const cleared = await fetch(`${baseUrl}/api/history`, { method: 'DELETE' });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ removed: 1, total: 0 });
    expect((await fetch(`${baseUrl}/api/history`).then((res) => res.json())) as HistoryListResponse)
      .toMatchObject({ total: 0, records: [] });
  });
});
