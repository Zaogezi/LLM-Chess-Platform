import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ChampionshipArchive,
  ChampionshipArchiveListResponse,
  ChampionshipState,
} from '../shared/protocol';
import type { ModelProvider } from './providers/index';
import type { Arena } from './arena/arena';
import { createApp } from './app';
import { ChampionshipArchiveStore } from './championship/archive';
import { Championship } from './championship/championship';
import { HistoryStore } from './history/history';
import { ModelProfileStore } from './models/profiles';
import { XiangqiGame } from './xiangqi/index';

interface ApiFixture {
  baseUrl: string;
  arena: Arena;
  championship: Championship;
  archiveStore: ChampionshipArchiveStore;
  close: () => Promise<void>;
}

const fixtures: ApiFixture[] = [];

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    fixture?.arena.dispose();
    fixture?.championship.dispose();
    await fixture?.close();
  }
});

function entrant(name: string, seedPool: number) {
  return {
    name,
    seedPool,
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    model: `${name.toLowerCase()}-model`,
    apiKey: `secret-${name}`,
    thinkingLevel: 'quick',
    apiReasoning: false,
  };
}

function startPayload() {
  const pools = [1, 2, 3, 4].map((seedPool) =>
    Array.from({ length: 4 }, (_, index) => entrant(`P${seedPool}X${index + 1}`, seedPool)),
  );
  const entrants = pools.flat();
  const groups = ['A', 'B', 'C', 'D'].map((id, groupIndex) => ({
    id,
    entrantNames: pools.map((pool) => pool[groupIndex]!.name),
  }));
  return { entrants, groups };
}

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
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    });
  },
};

async function startApi(): Promise<ApiFixture> {
  const archiveStore = new ChampionshipArchiveStore({ filePath: null });
  const championship = new Championship({
    providerFactory: () => hangingProvider,
    createInitialGame: () => XiangqiGame.initial(),
    gameSettings: { moveDelayMs: 0, maxAttempts: 1 },
    onArchive: (archive: ChampionshipArchive) => {
      archiveStore.save(archive);
    },
  });
  const { app, arena } = createApp({
    championship,
    archiveStore,
    providerFactory: () => hangingProvider,
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
  const fixture = { baseUrl, arena, championship, archiveStore, close };
  fixtures.push(fixture);
  return fixture;
}

async function readState(baseUrl: string): Promise<ChampionshipState> {
  const response = await fetch(`${baseUrl}/api/championship/state`);
  expect(response.status).toBe(200);
  return (await response.json()) as ChampionshipState;
}

describe('championship HTTP API', () => {
  it('starts, sanitizes, and stops a 16-entrant championship', async () => {
    const { baseUrl } = await startApi();

    const initial = await readState(baseUrl);
    expect(initial).toMatchObject({
      phase: 'idle',
      championModelId: null,
      entrants: [],
      groups: [],
      series: [],
      games: [],
    });

    const invalid = await fetch(`${baseUrl}/api/championship/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entrants: [], groups: [] }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toHaveProperty('error');

    const startedResponse = await fetch(`${baseUrl}/api/championship/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startPayload()),
    });
    expect(startedResponse.status).toBe(200);
    const started = (await startedResponse.json()) as ChampionshipState;
    expect(['running', 'finished']).toContain(started.phase);
    expect(started.entrants).toHaveLength(16);
    expect(started.groups).toHaveLength(4);
    expect(started.groups.every((group) => group.entrantIds.length === 4)).toBe(true);
    expect(started.groupGamesTotal).toBe(24);
    expect(started.games).toHaveLength(24);
    expect(JSON.stringify(started)).not.toContain('secret-');

    const secondStart = await fetch(`${baseUrl}/api/championship/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startPayload()),
    });
    expect(secondStart.status).toBe(409);

    const stopResponse = await fetch(`${baseUrl}/api/championship/stop`, { method: 'POST' });
    expect(stopResponse.status).toBe(200);
    const stopped = (await stopResponse.json()) as ChampionshipState;
    expect(stopped.phase).toBe('stopped');
    expect(stopped.championModelId).toBeNull();
    expect(stopped.games.every((game) => game.status === 'canceled')).toBe(true);
    expect(JSON.stringify(stopped)).not.toContain('secret-');

    const secondStop = await fetch(`${baseUrl}/api/championship/stop`, { method: 'POST' });
    expect(secondStop.status).toBe(409);
  });

  it('serves the board of the running championship game for the spectator page', async () => {
    const { baseUrl } = await startApi();

    const startedResponse = await fetch(`${baseUrl}/api/championship/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...startPayload(), concurrency: 4 }),
    });
    expect(startedResponse.status).toBe(200);

    let currentId: string | null = null;
    let runningState: ChampionshipState | null = null;
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const state = await readState(baseUrl);
      if (state.currentGameId) {
        currentId = state.currentGameId;
        runningState = state;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(currentId).toBeTruthy();
    expect(runningState?.concurrency).toBe(4);
    expect(runningState?.currentGameIds).toContain(currentId);

    const response = await fetch(`${baseUrl}/api/championship/games/${currentId}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('secret-');
    const snapshot = JSON.parse(text) as {
      live: boolean;
      game: { id: string; status: string; stage: string };
      arena: { phase: string; board: unknown[] } | null;
    };
    expect(snapshot.live).toBe(true);
    expect(snapshot.game.id).toBe(currentId);
    expect(snapshot.game.status).toBe('running');
    expect(snapshot.game.stage).toBe('group');
    expect(snapshot.arena?.phase).toBe('running');
    expect(snapshot.arena?.board).toHaveLength(90);

    const stopResponse = await fetch(`${baseUrl}/api/championship/stop`, { method: 'POST' });
    expect(stopResponse.status).toBe(200);

    const missing = await fetch(`${baseUrl}/api/championship/games/nope`);
    expect(missing.status).toBe(404);
  });

  it('resumes a stopped championship over HTTP and rejects an idle resume', async () => {
    const { baseUrl } = await startApi();

    const idleResume = await fetch(`${baseUrl}/api/championship/resume`, {
      method: 'POST',
    });
    expect(idleResume.status).toBe(409);

    const startedResponse = await fetch(`${baseUrl}/api/championship/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startPayload()),
    });
    expect(startedResponse.status).toBe(200);

    const stopResponse = await fetch(`${baseUrl}/api/championship/stop`, {
      method: 'POST',
    });
    expect(stopResponse.status).toBe(200);
    const stopped = (await stopResponse.json()) as ChampionshipState;
    expect(stopped.phase).toBe('stopped');
    expect(stopped.resumable).toBe(true);
    expect(stopped.checkpointSavedAt).not.toBeNull();
    expect(JSON.stringify(stopped)).not.toContain('secret-');

    const resumeResponse = await fetch(`${baseUrl}/api/championship/resume`, {
      method: 'POST',
    });
    expect(resumeResponse.status).toBe(200);
    const resumed = (await resumeResponse.json()) as ChampionshipState;
    expect(resumed.phase).toBe('running');
    expect(resumed.championshipId).toBe(stopped.championshipId);
    expect(resumed.resumable).toBe(false);

    const secondStop = await fetch(`${baseUrl}/api/championship/stop`, {
      method: 'POST',
    });
    expect(secondStop.status).toBe(200);
    expect(((await secondStop.json()) as ChampionshipState).resumable).toBe(true);
  });

  it('serves the championship archive list and detail, and 404s unknown ids', async () => {
    const { baseUrl } = await startApi();

    const emptyResponse = await fetch(`${baseUrl}/api/championship/archives`);
    expect(emptyResponse.status).toBe(200);
    expect((await emptyResponse.json()) as ChampionshipArchiveListResponse).toEqual({
      archives: [],
      total: 0,
    });

    const startedResponse = await fetch(`${baseUrl}/api/championship/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startPayload()),
    });
    expect(startedResponse.status).toBe(200);
    const stopResponse = await fetch(`${baseUrl}/api/championship/stop`, {
      method: 'POST',
    });
    expect(stopResponse.status).toBe(200);
    const stopped = (await stopResponse.json()) as ChampionshipState;

    const listResponse = await fetch(`${baseUrl}/api/championship/archives`);
    expect(listResponse.status).toBe(200);
    const listJson = await listResponse.text();
    expect(listJson).not.toContain('secret-');
    expect(listJson).not.toContain('apiKey');
    const list = JSON.parse(listJson) as ChampionshipArchiveListResponse;
    expect(list.total).toBe(1);
    expect(list.archives[0]).toMatchObject({
      championshipId: stopped.championshipId,
      phase: 'stopped',
      championModelId: null,
      championName: null,
      entrantNames: expect.arrayContaining(['P1X1']),
    });

    const detailResponse = await fetch(
      `${baseUrl}/api/championship/archives/${stopped.championshipId}`,
    );
    expect(detailResponse.status).toBe(200);
    const detailJson = await detailResponse.text();
    expect(detailJson).not.toContain('secret-');
    expect(detailJson).not.toContain('apiKey');
    const detail = JSON.parse(detailJson) as ChampionshipArchive;
    expect(detail).toMatchObject({
      version: 1,
      championshipId: stopped.championshipId,
      phase: 'stopped',
      groupGamesTotal: 24,
      seriesTotal: 7,
    });
    expect(detail.entrants).toHaveLength(16);
    expect(detail.groups).toHaveLength(4);
    expect(detail.series).toHaveLength(7);
    expect(detail.games).toHaveLength(24);

    const missingResponse = await fetch(
      `${baseUrl}/api/championship/archives/does-not-exist`,
    );
    expect(missingResponse.status).toBe(404);
    expect(await missingResponse.json()).toHaveProperty('error');
  });

  it('streams the initial championship state over SSE', async () => {
    const { baseUrl } = await startApi();
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/championship/events`, {
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
    const dataLine = buffer.split('\n').find((line) => line.startsWith('data: '));
    expect(dataLine).toBeTruthy();
    const state = JSON.parse(dataLine!.slice('data: '.length)) as ChampionshipState;
    expect(state.phase).toBe('idle');
    expect(state.games).toEqual([]);
  });
});
