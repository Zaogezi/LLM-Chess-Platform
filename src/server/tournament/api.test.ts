import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelProvider } from '../providers/index';
import { XiangqiGame } from '../xiangqi/index';
import type { Arena } from '../arena/arena';
import { createApp } from '../app';
import { HistoryStore } from '../history/history';
import { ModelProfileStore } from '../models/profiles';
import { Tournament } from './tournament';

const MATE_RED_TO_MOVE = '3k5/9/9/9/9/9/9/9/3r5/3rKa3 w - - 0 1';

interface ApiFixture {
  baseUrl: string;
  arena: Arena;
  tournament: Tournament;
  close: () => Promise<void>;
}

const fixtures: ApiFixture[] = [];

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    fixture?.arena.dispose();
    fixture?.tournament.dispose();
    await fixture?.close();
  }
});

async function startApi(tournament: Tournament, provider: ModelProvider): Promise<ApiFixture> {
  const { app, arena } = createApp({
    providerFactory: () => provider,
    tournament,
    history: new HistoryStore({ filePath: null }),
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
  const fixture: ApiFixture = { baseUrl, arena, tournament, close };
  fixtures.push(fixture);
  return fixture;
}

const unusedProvider: ModelProvider = {
  provider: 'openai',
  async complete() {
    throw new Error('provider must not be called for terminal positions');
  },
};

function startPayload() {
  return {
    models: [
      {
        name: 'Alpha',
        provider: 'openai',
        baseUrl: 'https://alpha.example.test/v1',
        model: 'alpha-model',
        apiKey: 'alpha-secret-key',
      },
      {
        name: 'Beta',
        provider: 'anthropic',
        baseUrl: 'https://beta.example.test/v1',
        model: 'beta-model',
        apiKey: 'beta-secret-key',
      },
    ],
    gamesPerPair: 2,
  };
}

async function readTournamentState(baseUrl: string) {
  const response = await fetch(`${baseUrl}/api/tournament/state`);
  expect(response.status).toBe(200);
  return (await response.json()) as import('../../shared/protocol').TournamentState;
}

async function waitForFinished(baseUrl: string, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readTournamentState(baseUrl);
    if (state.phase === 'finished') return state;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('tournament did not finish in time');
}

describe('tournament HTTP API', () => {
  it('starts a round robin, serves sanitized state and reports standings', async () => {
    const tournament = new Tournament({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_TO_MOVE),
    });
    const { baseUrl } = await startApi(tournament, unusedProvider);

    const initial = await readTournamentState(baseUrl);
    expect(initial).toMatchObject({ phase: 'idle', totalGames: 0, models: [], games: [] });

    const response = await fetch(`${baseUrl}/api/tournament/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startPayload()),
    });
    expect(response.status).toBe(200);
    const started = (await response.json()) as import('../../shared/protocol').TournamentState;
    expect(['running', 'finished']).toContain(started.phase);
    expect(started.models.map((model) => model.name)).toEqual(['Alpha', 'Beta']);
    expect(started.totalGames).toBe(2);
    expect(JSON.stringify(started)).not.toContain('secret-key');

    const finished = await waitForFinished(baseUrl);
    expect(finished.completedGames).toBe(2);
    expect(finished.standings.map((row) => [row.name, row.wins, row.losses, row.points])).toEqual([
      ['Alpha', 1, 1, 3],
      ['Beta', 1, 1, 3],
    ]);
    expect(finished.games[0]?.result?.reason).toBe('checkmate');
  });

  it('validates start bodies and rejects a second start while running', async () => {
    const hangingProvider: ModelProvider = {
      provider: 'openai',
      complete(_setup, _request, signal) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({
            text: '{"move":"h2e2","reason":"late"}',
            tokensIn: 1,
            tokensOut: 1,
          }), 10_000);
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new DOMException('aborted', 'AbortError'));
          }, { once: true });
        });
      },
    };
    const tournament = new Tournament({
      providerFactory: () => hangingProvider,
      createInitialGame: () => XiangqiGame.initial(),
    });
    const { baseUrl } = await startApi(tournament, hangingProvider);

    const bad = await fetch(`${baseUrl}/api/tournament/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ models: [], gamesPerPair: 2 }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toHaveProperty('error');

    const first = await fetch(`${baseUrl}/api/tournament/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startPayload()),
    });
    expect(first.status).toBe(200);

    const second = await fetch(`${baseUrl}/api/tournament/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startPayload()),
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toHaveProperty('error');

    const stopResponse = await fetch(`${baseUrl}/api/tournament/stop`, { method: 'POST' });
    expect(stopResponse.status).toBe(200);
    const stopped = (await stopResponse.json()) as import('../../shared/protocol').TournamentState;
    expect(stopped.phase).toBe('stopped');
    expect(stopped.games.every((game) => game.status === 'canceled')).toBe(true);

    const secondStop = await fetch(`${baseUrl}/api/tournament/stop`, { method: 'POST' });
    expect(secondStop.status).toBe(409);
  });

  it('serves the board of the running game for the spectator page', async () => {
    const hangingProvider: ModelProvider = {
      provider: 'openai',
      complete(_setup, _request, signal) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () =>
              resolve({
                text: '{"move":"h2e2","reason":"late"}',
                tokensIn: 1,
                tokensOut: 1,
              }),
            10_000,
          );
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('aborted', 'AbortError'));
            },
            { once: true },
          );
        });
      },
    };
    const tournament = new Tournament({
      providerFactory: () => hangingProvider,
      createInitialGame: () => XiangqiGame.initial(),
    });
    const { baseUrl } = await startApi(tournament, hangingProvider);

    const startResponse = await fetch(`${baseUrl}/api/tournament/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...startPayload(), gamesPerPair: 1 }),
    });
    expect(startResponse.status).toBe(200);

    let currentId: string | null = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const state = await readTournamentState(baseUrl);
      if (state.currentGameId) {
        currentId = state.currentGameId;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(currentId).toBeTruthy();

    const snapshotResponse = await fetch(
      `${baseUrl}/api/tournament/games/${currentId}`,
    );
    expect(snapshotResponse.status).toBe(200);
    const text = await snapshotResponse.text();
    expect(text).not.toContain('secret-key');
    const snapshot = JSON.parse(text) as {
      live: boolean;
      game: { id: string; status: string; redName: string };
      arena: {
        phase: string;
        board: unknown[];
        models: Record<string, { displayName: string }>;
      } | null;
    };
    expect(snapshot.live).toBe(true);
    expect(snapshot.game.id).toBe(currentId);
    expect(snapshot.game.status).toBe('running');
    expect(snapshot.arena?.phase).toBe('running');
    expect(snapshot.arena?.board).toHaveLength(90);
    expect(snapshot.game.redName.length).toBeGreaterThan(0);

    await fetch(`${baseUrl}/api/tournament/stop`, { method: 'POST' });

    const missing = await fetch(`${baseUrl}/api/tournament/games/nope`);
    expect(missing.status).toBe(404);
  });

  it('keeps the final board of the most recently finished game', async () => {
    const tournament = new Tournament({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_TO_MOVE),
    });
    const { baseUrl } = await startApi(tournament, unusedProvider);

    const startResponse = await fetch(`${baseUrl}/api/tournament/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...startPayload(), gamesPerPair: 1 }),
    });
    expect(startResponse.status).toBe(200);

    const finished = await waitForFinished(baseUrl);
    const lastGame = finished.games[finished.games.length - 1]!;
    const response = await fetch(`${baseUrl}/api/tournament/games/${lastGame.id}`);
    expect(response.status).toBe(200);
    const snapshot = (await response.json()) as {
      live: boolean;
      game: { status: string };
      arena: { phase: string; board: unknown[]; moves: unknown[] } | null;
    };
    expect(snapshot.live).toBe(false);
    expect(snapshot.game.status).toBe('finished');
    expect(snapshot.arena?.phase).toBe('finished');
    expect(snapshot.arena?.board).toHaveLength(90);
    expect(Array.isArray(snapshot.arena?.moves)).toBe(true);
  });

  it('streams tournament SSE state snapshots', async () => {
    const tournament = new Tournament({ providerFactory: () => unusedProvider });
    const { baseUrl } = await startApi(tournament, unusedProvider);
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/tournament/events`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing SSE body');
    const decoder = new TextDecoder();
    let buffer = '';
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      while (!buffer.includes('\n\n') || buffer.startsWith('retry:')) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const firstStateIndex = buffer.indexOf('event: state');
        if (firstStateIndex >= 0 && buffer.indexOf('\n\n', firstStateIndex) >= 0) break;
      }
    } finally {
      clearTimeout(timeout);
      controller.abort();
      await reader.cancel().catch(() => undefined);
    }

    expect(buffer).toContain('event: state');
    const dataLine = buffer
      .split('\n')
      .find((line) => line.startsWith('data: '));
    expect(dataLine).toBeTruthy();
    const state = JSON.parse(dataLine!.slice('data: '.length)) as {
      phase: string;
      games: unknown[];
    };
    expect(state.phase).toBe('idle');
    expect(state.games).toEqual([]);
  });
});
