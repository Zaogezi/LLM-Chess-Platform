import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  HistoryGameRecord,
  HistoryListResponse,
  QualifierState,
} from '../shared/protocol';
import type { ModelProvider } from './providers/index';
import { createApp, type AppBundle } from './app';
import { Qualifier } from './championship/qualifier';
import { QualifierCheckpointStore } from './championship/qualifierCheckpoint';
import { HistoryStore } from './history/history';
import { ModelProfileStore } from './models/profiles';
import { XiangqiGame } from './xiangqi/index';

const MATE_RED_WINS = '3Rk4/3R5/9/9/9/9/9/9/9/4K4 b - - 0 1';

const GROUP_NAMES: Record<'A' | 'B', readonly string[]> = {
  A: ['A1', 'A2', 'A3', 'A4', 'A5'],
  B: ['B1', 'B2', 'B3', 'B4', 'B5'],
};

interface ApiFixture {
  baseUrl: string;
  bundle: AppBundle;
  close: () => Promise<void>;
}

const fixtures: ApiFixture[] = [];

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    fixture?.bundle.qualifier.dispose();
    fixture?.bundle.arena.dispose();
    fixture?.bundle.tournament.dispose();
    fixture?.bundle.championship.dispose();
    await fixture?.close();
  }
});

function entrant(name: string) {
  return {
    name,
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    model: `${name.toLocaleLowerCase()}-model`,
    apiKey: `secret-${name}`,
    thinkingLevel: 'quick',
    apiReasoning: false,
  };
}

function startPayload(concurrency?: number) {
  const body: Record<string, unknown> = {
    entrants: [...GROUP_NAMES.A, ...GROUP_NAMES.B].map((name) => entrant(name)),
    groups: [
      { id: 'A', entrantNames: [...GROUP_NAMES.A] },
      { id: 'B', entrantNames: [...GROUP_NAMES.B] },
    ],
  };
  if (concurrency !== undefined) body.concurrency = concurrency;
  return body;
}

const hangingProvider: ModelProvider = {
  provider: 'openai',
  complete(_setup, _request, signal) {
    return new Promise((_resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(new Error('hanging provider was never aborted')),
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

const unusedProvider: ModelProvider = {
  provider: 'openai',
  async complete() {
    throw new Error('terminal positions must not call a model');
  },
};

async function startApi(options: { terminal?: boolean } = {}): Promise<ApiFixture> {
  const history = new HistoryStore({ filePath: null });
  const profiles = new ModelProfileStore({ filePath: null });
  const terminal = options.terminal === true;
  const provider = terminal ? unusedProvider : hangingProvider;
  const qualifier = new Qualifier({
    providerFactory: () => provider,
    createInitialGame: terminal
      ? () => XiangqiGame.fromFen(MATE_RED_WINS)
      : () => XiangqiGame.initial(),
    gameSettings: { moveDelayMs: 0, maxAttempts: 1 },
    checkpointStore: new QualifierCheckpointStore({ filePath: null }),
    onGameComplete: (completion) => {
      history.recordQualifierGame(completion);
    },
  });
  const bundle = createApp({
    qualifier,
    providerFactory: () => provider,
    history,
    profiles,
  });
  const server: Server = createServer(bundle.app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server failed');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  const fixture = { baseUrl, bundle, close };
  fixtures.push(fixture);
  return fixture;
}

async function readState(baseUrl: string): Promise<QualifierState> {
  const response = await fetch(`${baseUrl}/api/championship/qualifier/state`);
  expect(response.status).toBe(200);
  return (await response.json()) as QualifierState;
}

async function waitForState(
  baseUrl: string,
  predicate: (state: QualifierState) => boolean,
  timeoutMs = 8_000,
): Promise<QualifierState> {
  const deadline = Date.now() + timeoutMs;
  let last: QualifierState | null = null;
  while (Date.now() < deadline) {
    last = await readState(baseUrl);
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(
    `timed out waiting for qualifier state; phase=${last?.phase} completed=${last?.completedGames}`,
  );
}

async function post(baseUrl: string, route: string, body?: unknown): Promise<Response> {
  return fetch(`${baseUrl}/api/championship/qualifier/${route}`, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

describe('qualifier HTTP API', () => {
  it('starts idle, rejects invalid payloads and a repeated start, and stops', async () => {
    const { baseUrl } = await startApi();

    const initial = await readState(baseUrl);
    expect(initial).toMatchObject({
      phase: 'idle',
      qualifierId: null,
      entrants: [],
      groups: [],
      games: [],
      groupGamesTotal: 20,
      groupGamesProcessed: 0,
      processedGames: 0,
      completedGames: 0,
      concurrency: 1,
      qualifiedModelIds: [],
      error: null,
      startedAt: null,
      finishedAt: null,
      resumable: false,
      checkpointSavedAt: null,
    });

    const idleResume = await post(baseUrl, 'resume');
    expect(idleResume.status).toBe(409);
    const idleStop = await post(baseUrl, 'stop');
    expect(idleStop.status).toBe(409);

    const invalid = await post(baseUrl, 'start', { entrants: [], groups: [] });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toHaveProperty('error');

    const startedResponse = await post(baseUrl, 'start', startPayload());
    expect(startedResponse.status).toBe(200);
    const started = (await startedResponse.json()) as QualifierState;
    expect(started.phase).toBe('running');
    expect(started.qualifierId).not.toBeNull();
    expect(started.entrants).toHaveLength(10);
    expect(started.entrants.map((item) => item.id)).toEqual([
      'm1',
      'm2',
      'm3',
      'm4',
      'm5',
      'm6',
      'm7',
      'm8',
      'm9',
      'm10',
    ]);
    expect(started.entrants.filter((item) => item.groupId === 'A')).toHaveLength(5);
    expect(started.entrants.filter((item) => item.groupId === 'B')).toHaveLength(5);
    expect(started.entrants.every((item) => item.keyConfigured)).toBe(true);
    expect(started.groups).toHaveLength(2);
    expect(started.groups.map((group) => group.id)).toEqual(['A', 'B']);
    expect(started.groups.every((group) => group.entrantIds.length === 5)).toBe(true);
    expect(started.games).toHaveLength(20);
    expect(started.concurrency).toBe(1);
    expect(started.currentGameIds).toEqual(['g1']);
    expect(JSON.stringify(started)).not.toContain('secret-');
    expect(JSON.stringify(started)).not.toContain('apiKey');

    const secondStart = await post(baseUrl, 'start', startPayload());
    expect(secondStart.status).toBe(409);

    const stopResponse = await post(baseUrl, 'stop');
    expect(stopResponse.status).toBe(200);
    const stopped = (await stopResponse.json()) as QualifierState;
    expect(stopped.phase).toBe('stopped');
    expect(stopped.resumable).toBe(true);
    expect(stopped.checkpointSavedAt).not.toBeNull();
    expect(stopped.currentGameIds).toEqual([]);
    expect(stopped.games.every((game) => game.status === 'canceled')).toBe(true);
    expect(stopped.error).toBeNull();
    expect(stopped.qualifiedModelIds).toEqual([]);
    expect(JSON.stringify(stopped)).not.toContain('secret-');

    const secondStop = await post(baseUrl, 'stop');
    expect(secondStop.status).toBe(409);
  });

  it('serves the live qualifying board and 404s an unknown game', async () => {
    const { baseUrl } = await startApi();

    const startedResponse = await post(baseUrl, 'start', startPayload(4));
    expect(startedResponse.status).toBe(200);
    const started = (await startedResponse.json()) as QualifierState;
    expect(started.concurrency).toBe(4);
    expect(started.currentGameIds).toHaveLength(4);

    let running: QualifierState | null = null;
    let currentId: string | null = null;
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      const state = await readState(baseUrl);
      const runningId = state.currentGameIds[0];
      if (runningId) {
        currentId = runningId;
        running = state;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(currentId).toBeTruthy();
    expect(running?.currentGameIds).toContain(currentId);

    const response = await fetch(
      `${baseUrl}/api/championship/qualifier/games/${currentId}`,
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('secret-');
    const snapshot = JSON.parse(text) as {
      live: boolean;
      game: { id: string; status: string; stage: string; groupId: string | null };
      arena: { phase: string; board: unknown[] } | null;
    };
    expect(snapshot.live).toBe(true);
    expect(snapshot.game.id).toBe(currentId);
    expect(snapshot.game.status).toBe('running');
    expect(snapshot.game.stage).toBe('qualifier');
    expect(['A', 'B']).toContain(snapshot.game.groupId);
    expect(snapshot.arena?.phase).toBe('running');
    expect(snapshot.arena?.board).toHaveLength(90);

    const missing = await fetch(`${baseUrl}/api/championship/qualifier/games/nope`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toHaveProperty('error');

    const stopResponse = await post(baseUrl, 'stop');
    expect(stopResponse.status).toBe(200);
  });

  it('resumes a stopped qualifier over HTTP', async () => {
    const { baseUrl } = await startApi();

    const startedResponse = await post(baseUrl, 'start', startPayload());
    expect(startedResponse.status).toBe(200);
    const started = (await startedResponse.json()) as QualifierState;
    const stopResponse = await post(baseUrl, 'stop');
    expect(stopResponse.status).toBe(200);
    const stopped = (await stopResponse.json()) as QualifierState;
    expect(stopped.phase).toBe('stopped');
    expect(stopped.resumable).toBe(true);

    const resumeResponse = await post(baseUrl, 'resume');
    expect(resumeResponse.status).toBe(200);
    const resumed = (await resumeResponse.json()) as QualifierState;
    expect(resumed.phase).toBe('running');
    expect(resumed.qualifierId).toBe(started.qualifierId);
    expect(resumed.resumable).toBe(false);
    expect(resumed.currentGameIds.length).toBeGreaterThan(0);

    const secondStop = await post(baseUrl, 'stop');
    expect(secondStop.status).toBe(200);
    const stoppedAgain = (await secondStop.json()) as QualifierState;
    expect(stoppedAgain.phase).toBe('stopped');
    expect(stoppedAgain.resumable).toBe(true);
  });

  it('finishes a qualifying round over HTTP and archives 20 history records', async () => {
    const { baseUrl } = await startApi({ terminal: true });

    const startedResponse = await post(baseUrl, 'start', startPayload(8));
    expect(startedResponse.status).toBe(200);
    const final = await waitForState(baseUrl, (state) => state.phase === 'finished');

    expect(final.error).toBeNull();
    expect(final.completedGames).toBe(20);
    expect(final.groupGamesProcessed).toBe(20);
    expect(final.qualifiedModelIds).toEqual(['m1', 'm6', 'm2', 'm7']);
    expect(final.qualifierId).not.toBeNull();
    expect(JSON.stringify(final)).not.toContain('secret-');

    const stopAfterFinish = await post(baseUrl, 'stop');
    expect(stopAfterFinish.status).toBe(409);

    const historyResponse = await fetch(
      `${baseUrl}/api/history?limit=50&offset=0&mode=championship`,
    );
    expect(historyResponse.status).toBe(200);
    const historyText = await historyResponse.text();
    expect(historyText).not.toContain('secret-');
    expect(historyText).not.toContain('apiKey');
    const history = JSON.parse(historyText) as HistoryListResponse;
    expect(history.total).toBe(20);
    expect(history.records).toHaveLength(20);
    for (const record of history.records) {
      expect(record.mode).toBe('championship');
      expect(record.status).toBe('finished');
      expect(record.championship).toMatchObject({
        championshipId: final.qualifierId,
        stage: 'qualifier',
        seriesId: null,
      });
      expect(['A', 'B']).toContain(record.championship?.groupId);
    }

    const searchedResponse = await fetch(
      `${baseUrl}/api/history?q=${encodeURIComponent(final.qualifierId!)}`,
    );
    expect(searchedResponse.status).toBe(200);
    const searched = (await searchedResponse.json()) as HistoryListResponse;
    expect(searched.total).toBe(20);

    const detailResponse = await fetch(
      `${baseUrl}/api/history/${encodeURIComponent(history.records[0]!.id)}`,
    );
    expect(detailResponse.status).toBe(200);
    const detail = (await detailResponse.json()) as HistoryGameRecord;
    expect(detail.championship?.stage).toBe('qualifier');
    expect(Array.isArray(detail.moves)).toBe(true);
  });

  it('streams the initial qualifier state over SSE', async () => {
    const { baseUrl } = await startApi();
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/championship/qualifier/events`, {
      signal: controller.signal,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    if (!reader) throw new Error('missing SSE body');
    const decoder = new TextDecoder();
    let buffer = '';
    const timeout = setTimeout(() => controller.abort(), 2_000);
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
    const state = JSON.parse(dataLine!.slice('data: '.length)) as QualifierState;
    expect(state.phase).toBe('idle');
    expect(state.games).toEqual([]);
    expect(state.groups).toEqual([]);
    expect(state.groupGamesTotal).toBe(20);
  });
});
