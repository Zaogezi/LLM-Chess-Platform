import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ArenaState } from '../shared/protocol';
import type { CompletionRequest, ModelProvider } from './providers/index';
import type { Arena } from './arena/arena';
import { createApp } from './app';
import { HistoryStore } from './history/history';
import { ModelProfileStore, validateProfileCreate } from './models/profiles';

interface ApiFixture {
  baseUrl: string;
  arena: Arena;
  profiles: ModelProfileStore;
  close: () => Promise<void>;
}

const fixtures: ApiFixture[] = [];

afterEach(async () => {
  while (fixtures.length) {
    const fixture = fixtures.pop();
    fixture?.arena.dispose();
    await fixture?.close();
  }
});

function firstLegal(request: CompletionRequest): string {
  const content = request.messages.at(-1)?.content ?? '';
  const match = content.match(/^\s*-\s+([a-i][0-9][a-i][0-9])\s+/m);
  // Availability probes have no chess position; they only need a non-empty
  // fake provider reply. Gameplay requests still use the prompt's move list.
  return match?.[1] ?? 'h2e2';
}

async function startApi(): Promise<ApiFixture> {
  const provider: ModelProvider = {
    provider: 'openai',
    async complete(_setup, request) {
      return {
        text: JSON.stringify({ move: firstLegal(request), reason: '接口测试' }),
        tokensIn: 5,
        tokensOut: 3,
      };
    },
  };

  const profiles = new ModelProfileStore({ filePath: null });
  const { app, arena } = createApp({
    providerFactory: () => provider,
    history: new HistoryStore({ filePath: null }),
    profiles,
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
  const fixture: ApiFixture = { baseUrl, arena, profiles, close };
  fixtures.push(fixture);
  return fixture;
}

function startPayload() {
  return {
    red: {
      provider: 'openai',
      baseUrl: 'https://red.example.test/v1',
      model: 'red-model',
      apiKey: 'super-secret-red-key',
    },
    black: {
      provider: 'anthropic',
      baseUrl: 'https://black.example.test/v1',
      model: 'black-model',
      apiKey: 'super-secret-black-key',
    },
    settings: { moveDelayMs: 5000, maxAttempts: 3 },
  };
}

describe('HTTP API', () => {
  it('serves health, state and a sanitized start/pause/reset cycle', async () => {
    const { baseUrl } = await startApi();

    const health = await fetch(`${baseUrl}/api/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true });

    const initialResponse = await fetch(`${baseUrl}/api/state`);
    const initial = (await initialResponse.json()) as ArenaState;
    expect(initialResponse.headers.get('cache-control')).toContain('no-store');
    expect(initial.phase).toBe('idle');
    expect(initial.board).toHaveLength(90);
    expect(initial.models).toEqual({ red: null, black: null });

    const startedResponse = await fetch(`${baseUrl}/api/game/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(startPayload()),
    });
    expect(startedResponse.status).toBe(200);
    const started = (await startedResponse.json()) as ArenaState;
    expect(started.phase).toBe('running');
    expect(started.models.red?.model).toBe('red-model');
    expect(started.models.red?.thinkingLevel).toBe('balanced');
    expect(started.models.red?.apiReasoning).toBe(true);
    expect(started.models.black?.apiReasoning).toBe(false);
    expect(started.models.black?.keyConfigured).toBe(true);
    expect(JSON.stringify(started)).not.toContain('super-secret');

    const pauseResponse = await fetch(`${baseUrl}/api/game/pause`, { method: 'POST' });
    expect(pauseResponse.status).toBe(200);
    expect(((await pauseResponse.json()) as ArenaState).phase).toBe('paused');

    const secondPause = await fetch(`${baseUrl}/api/game/pause`, { method: 'POST' });
    expect(secondPause.status).toBe(409);

    const resetResponse = await fetch(`${baseUrl}/api/game/reset`, { method: 'POST' });
    const reset = (await resetResponse.json()) as ArenaState;
    expect(reset.phase).toBe('idle');
    expect(reset.models).toEqual({ red: null, black: null });
  });

  it('validates start bodies and unknown API routes', async () => {
    const { baseUrl } = await startApi();

    const bad = await fetch(`${baseUrl}/api/game/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ red: { provider: 'openai' } }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toHaveProperty('error');

    const malformed = await fetch(`${baseUrl}/api/game/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toHaveProperty('error');

    const missing = await fetch(`${baseUrl}/api/nope`);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toHaveProperty('error');
  });

  it('manages model-library profiles over HTTP without exposing API keys', async () => {
    const { baseUrl } = await startApi();

    const empty = await fetch(`${baseUrl}/api/models`);
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ profiles: [] });

    const createdResponse = await fetch(`${baseUrl}/api/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '主力模型',
        provider: 'openai',
        baseUrl: 'https://saved.example.test/v1',
        model: 'saved-model',
        thinkingLevel: 'deep',
        apiReasoning: true,
        apiKey: 'super-secret-profile-key',
      }),
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      id: string;
      name: string;
      keyConfigured: boolean;
      keyHint: string;
    };
    expect(created).toMatchObject({
      name: '主力模型',
      keyConfigured: true,
      keyHint: '••••-key',
    });
    expect(JSON.stringify(created)).not.toContain('super-secret-profile-key');

    const list = (await (await fetch(`${baseUrl}/api/models`)).json()) as {
      profiles: Array<{ keyConfigured: boolean; keyHint: string }>;
    };
    expect(list.profiles).toHaveLength(1);
    expect(list.profiles[0]?.keyConfigured).toBe(true);
    expect(JSON.stringify(list)).not.toContain('super-secret-profile-key');

    const updatedResponse = await fetch(`${baseUrl}/api/models/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '主力模型（改名）',
        provider: 'openai',
        baseUrl: 'https://saved.example.test/v1',
        model: 'saved-model-v2',
        thinkingLevel: 'quick',
        apiReasoning: false,
      }),
    });
    expect(updatedResponse.status).toBe(200);
    const updated = (await updatedResponse.json()) as { name: string; keyConfigured: boolean };
    expect(updated.name).toBe('主力模型（改名）');
    expect(updated.keyConfigured).toBe(true);

    const duplicate = await fetch(`${baseUrl}/api/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '主力模型（改名）',
        provider: 'openai',
        baseUrl: 'https://other.example.test/v1',
        model: 'other',
      }),
    });
    expect(duplicate.status).toBe(400);

    const removed = await fetch(`${baseUrl}/api/models/${created.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toMatchObject({ removed: 1, total: 0 });
    const missing = await fetch(`${baseUrl}/api/models/${created.id}`, { method: 'DELETE' });
    expect(missing.status).toBe(404);
  });

  it('tests model availability through the saved profile and inline config', async () => {
    const { baseUrl, profiles } = await startApi();
    const saved = profiles.create({
      name: '待测试模型',
      provider: 'openai',
      baseUrl: 'https://saved.example.test/v1',
      model: 'saved-model',
      thinkingLevel: 'quick',
      thinkingLevels: ['quick', 'balanced', 'deep'],
      apiReasoning: false,
      apiKey: 'super-secret-test-key',
    });

    const profileResponse = await fetch(`${baseUrl}/api/models/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: saved.id }),
    });
    expect(profileResponse.status).toBe(200);
    const profileResult = (await profileResponse.json()) as {
      ok: boolean;
      model: string;
      message: string;
      replyPreview: string;
    };
    expect(profileResult).toMatchObject({
      ok: true,
      model: 'saved-model',
      message: expect.stringContaining('模型可用'),
    });
    expect(profileResult.replyPreview).toContain('"move"');
    expect(JSON.stringify(profileResult)).not.toContain('super-secret-test-key');

    const inlineResponse = await fetch(`${baseUrl}/api/models/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'openai',
        baseUrl: 'https://inline.example.test/v1',
        model: 'inline-model',
        apiKey: 'inline-secret-key',
        thinkingLevel: 'quick',
        apiReasoning: false,
      }),
    });
    expect(inlineResponse.status).toBe(200);
    const inlineResult = (await inlineResponse.json()) as { ok: boolean; model: string };
    expect(inlineResult).toMatchObject({ ok: true, model: 'inline-model' });
    expect(JSON.stringify(inlineResult)).not.toContain('inline-secret-key');

    const missing = await fetch(`${baseUrl}/api/models/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 'missing-profile' }),
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toHaveProperty('error');

    const invalid = await fetch(`${baseUrl}/api/models/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'ftp://bad' }),
    });
    expect(invalid.status).toBe(400);
  });

  it('starts games from saved model selections and resolves their names', async () => {
    const { baseUrl, profiles } = await startApi();
    const saved = profiles.create({
      name: '存档红方',
      provider: 'openai',
      baseUrl: 'https://saved.example.test/v1',
      model: 'saved-red',
      thinkingLevel: 'balanced',
      thinkingLevels: ['quick', 'balanced', 'deep'],
      apiReasoning: false,
      apiKey: 'saved-secret-red',
    });

    const startedResponse = await fetch(`${baseUrl}/api/game/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        red: { profileId: saved.id, thinkingLevel: 'deep' },
        black: { profileId: saved.id, thinkingLevel: 'quick' },
        settings: { moveDelayMs: 5000, maxAttempts: 1 },
      }),
    });
    expect(startedResponse.status).toBe(200);
    const started = (await startedResponse.json()) as ArenaState;
    expect(started.phase).toBe('running');
    expect(started.models.red).toMatchObject({
      model: 'saved-red',
      displayName: '存档红方',
      thinkingLevel: 'deep',
      keyConfigured: true,
    });
    expect(started.models.black?.thinkingLevel).toBe('quick');
    expect(JSON.stringify(started)).not.toContain('saved-secret-red');

    await fetch(`${baseUrl}/api/game/pause`, { method: 'POST' });
    await fetch(`${baseUrl}/api/game/reset`, { method: 'POST' });

    const unknown = await fetch(`${baseUrl}/api/game/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        red: { profileId: 'missing-profile' },
        black: { profileId: 'missing-profile' },
      }),
    });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toHaveProperty('error');
  });

  it('reads thinking levels for a saved model without exposing its key', async () => {
    let authorization = '';
    let showBody = '';
    const metadata = createServer((req, res) => {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        authorization = String(req.headers.authorization ?? '');
        showBody = body;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            thinking: { values: ['low', 'medium', 'high'], default: 'high' },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => metadata.listen(0, '127.0.0.1', resolve));
    const address = metadata.address();
    if (!address || typeof address === 'string') throw new Error('metadata server failed');
    const metadataUrl = `http://127.0.0.1:${address.port}/v1`;

    try {
      const { baseUrl, profiles } = await startApi();
      const saved = profiles.create(
        validateProfileCreate({
          name: '元数据模型',
          provider: 'openai',
          baseUrl: metadataUrl,
          model: 'thinking-model',
          thinkingLevel: 'medium',
          apiReasoning: true,
          apiKey: 'sk-metadata-secret-1234',
        }),
      );

      const response = await fetch(`${baseUrl}/api/models/thinking-options`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profileId: saved.id }),
      });
      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        source: string;
        options: string[];
        defaultLevel: string;
        note: string;
      };
      expect(payload).toMatchObject({
        source: 'ollama',
        options: ['low', 'medium', 'high'],
        defaultLevel: 'high',
      });
      expect(JSON.stringify(payload)).not.toContain('sk-metadata-secret-1234');
      expect(authorization).toBe('Bearer sk-metadata-secret-1234');
      expect(showBody).toBe(JSON.stringify({ model: 'thinking-model' }));
    } finally {
      await new Promise<void>((resolve) => {
        metadata.closeAllConnections();
        metadata.close(() => resolve());
      });
    }
  });

  it('streams SSE state snapshots', async () => {
    const { baseUrl } = await startApi();
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
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
    const state = JSON.parse(dataLine!.slice('data: '.length)) as ArenaState;
    expect(state.phase).toBe('idle');
    expect(state.board).toHaveLength(90);
  });
});
