import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ChampionshipGroupId,
  ChampionshipSetupDraft,
  ChampionshipSetupDraw,
  ChampionshipSetupResponse,
  ChampionshipSetupSaveRequest,
  QualifierGroupId,
} from '../shared/protocol';
import { CHAMPIONSHIP_GROUPS } from '../shared/protocol';
import { createApp, type AppBundle } from './app';
import { CHAMPIONSHIP_SETUP_DRAFT_COUNT, ChampionshipSetupStore } from './championship/setup';
import { HistoryStore } from './history/history';
import { ModelProfileStore } from './models/profiles';

interface ApiFixture {
  baseUrl: string;
  bundle: AppBundle;
  setupStore: ChampionshipSetupStore;
  close: () => Promise<void>;
}

const fixtures: ApiFixture[] = [];

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    fixture?.bundle.arena.dispose();
    fixture?.bundle.tournament.dispose();
    fixture?.bundle.championship.dispose();
    fixture?.bundle.qualifier.dispose();
    await fixture?.close();
  }
});

async function startApi(): Promise<ApiFixture> {
  const setupStore = new ChampionshipSetupStore({ filePath: null });
  const bundle = createApp({
    setupStore,
    history: new HistoryStore({ filePath: null }),
    profiles: new ModelProfileStore({ filePath: null }),
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

  const fixture: ApiFixture = { baseUrl, bundle, setupStore, close };
  fixtures.push(fixture);
  return fixture;
}

function setupDraft(
  index: number,
  overrides: Partial<ChampionshipSetupDraft> = {},
): ChampionshipSetupDraft {
  const seeded = index < 12;
  const qualifierGroup: QualifierGroupId | null = seeded ? null : index < 17 ? 'A' : 'B';
  return {
    id: `entrant-${index + 1}`,
    profileId: null,
    name: `模型 ${index + 1}`,
    preset: 'deepseek',
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    model: `model-${index + 1}`,
    thinkingLevel: 'balanced',
    thinkingOptions: ['quick', 'balanced', 'deep'],
    apiReasoning: false,
    apiKey: `secret-${index + 1}`,
    seedPool: seeded ? Math.floor(index / 4) + 1 : 4,
    qualifierGroup,
    ...overrides,
  };
}

function setupDrafts(): ChampionshipSetupDraft[] {
  return Array.from({ length: CHAMPIONSHIP_SETUP_DRAFT_COUNT }, (_, index) =>
    setupDraft(index),
  );
}

function setupDraw(drafts: readonly ChampionshipSetupDraft[] = setupDrafts()): ChampionshipSetupDraw {
  const byPool = new Map<number, ChampionshipSetupDraft[]>();
  for (const pool of [1, 2, 3, 4]) {
    byPool.set(
      pool,
      drafts.filter((draft) => draft.seedPool === pool).slice(0, 4),
    );
  }
  const groups = CHAMPIONSHIP_GROUPS.map((id, groupIndex) => ({
    id,
    slots: [1, 2, 3, 4].map((pool) => {
      const draft = byPool.get(pool)![groupIndex]!;
      return { pool, draftId: draft.id, name: draft.name };
    }),
  }));
  const groupByDraftId: Record<string, ChampionshipGroupId> = {};
  for (const group of groups) {
    for (const slot of group.slots) {
      groupByDraftId[slot.draftId] = group.id;
    }
  }
  return { groups, groupByDraftId };
}

function saveRequest(overrides: Partial<ChampionshipSetupSaveRequest> = {}): ChampionshipSetupSaveRequest {
  return {
    drafts: setupDrafts(),
    draw: setupDraw(),
    concurrency: 4,
    ...overrides,
  };
}

function putSetup(
  baseUrl: string,
  body: unknown,
): Promise<Response> {
  return fetch(`${baseUrl}/api/championship/setup`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('championship setup API', () => {
  it('serves an empty setup before anything is saved', async () => {
    const { baseUrl } = await startApi();

    const response = await fetch(`${baseUrl}/api/championship/setup`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toEqual({ setup: null });
  });

  it('exposes the injected store on the app bundle', async () => {
    const { bundle, setupStore } = await startApi();
    expect(bundle.setupStore).toBe(setupStore);
  });

  it('saves a valid setup and serves it back', async () => {
    const { baseUrl, setupStore } = await startApi();
    const request = saveRequest();

    const savedResponse = await putSetup(baseUrl, request);
    expect(savedResponse.status).toBe(200);
    const saved = (await savedResponse.json()) as ChampionshipSetupResponse;
    expect(saved.setup).toMatchObject({ version: 1, concurrency: 4 });
    expect(typeof saved.setup?.savedAt).toBe('number');
    expect(saved.setup?.drafts).toHaveLength(CHAMPIONSHIP_SETUP_DRAFT_COUNT);
    expect(setupStore.has()).toBe(true);

    const readResponse = await fetch(`${baseUrl}/api/championship/setup`);
    expect(readResponse.status).toBe(200);
    const read = (await readResponse.json()) as ChampionshipSetupResponse;
    expect(read.setup?.savedAt).toBe(saved.setup?.savedAt);
    expect(read.setup?.drafts.map((draft) => draft.id)).toEqual(
      request.drafts.map((draft) => draft.id),
    );
    expect(read.setup?.draw?.groups).toHaveLength(CHAMPIONSHIP_GROUPS.length);
  });

  it('accepts a saved setup with no draw yet', async () => {
    const { baseUrl } = await startApi();
    const response = await putSetup(baseUrl, saveRequest({ draw: null }));
    expect(response.status).toBe(200);
    expect(((await response.json()) as ChampionshipSetupResponse).setup?.draw).toBeNull();
  });

  it.each<[string, (baseUrl: string) => Promise<Response>]>([
    [
      'too few drafts',
      (baseUrl) => putSetup(baseUrl, { ...saveRequest(), drafts: setupDrafts().slice(0, 21) }),
    ],
    [
      'invalid concurrency',
      (baseUrl) => putSetup(baseUrl, { ...saveRequest(), concurrency: 99 }),
    ],
    [
      'invalid provider',
      (baseUrl) => {
        const drafts = setupDrafts();
        drafts[0] = { ...drafts[0]!, provider: 'gemini' as never };
        return putSetup(baseUrl, { ...saveRequest(), drafts });
      },
    ],
    [
      'duplicate pool in a draw group',
      (baseUrl) => {
        const draw = setupDraw();
        draw.groups[0]!.slots[1]!.pool = draw.groups[0]!.slots[0]!.pool;
        return putSetup(baseUrl, { ...saveRequest(), draw });
      },
    ],
    [
      'missing fields',
      (baseUrl) => putSetup(baseUrl, { drafts: setupDrafts(), concurrency: 4 }),
    ],
  ])('rejects a body with %s', async (_label, makeRequest) => {
    const { baseUrl } = await startApi();
    const response = await makeRequest(baseUrl);
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
    expect(await (await fetch(`${baseUrl}/api/championship/setup`)).json()).toEqual({
      setup: null,
    });
  });

  it('rejects malformed JSON and never overwrites the previous snapshot', async () => {
    const { baseUrl } = await startApi();
    expect((await putSetup(baseUrl, saveRequest())).status).toBe(200);

    const malformed = await putSetup(baseUrl, '{not json');
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toHaveProperty('error');

    const invalid = await putSetup(baseUrl, { ...saveRequest(), concurrency: 0 });
    expect(invalid.status).toBe(400);

    const read = (await (await fetch(`${baseUrl}/api/championship/setup`)).json()) as
      ChampionshipSetupResponse;
    expect(read.setup?.concurrency).toBe(4);
    expect(read.setup?.drafts).toHaveLength(CHAMPIONSHIP_SETUP_DRAFT_COUNT);
  });
});
