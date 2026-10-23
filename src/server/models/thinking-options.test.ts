import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelSetup } from '../../shared/protocol';
import {
  fetchThinkingOptions,
  validateThinkingOptionsRequest,
} from './thinking-options';

interface MockService {
  baseUrl: string;
  requests: Array<{ method: string; url: string; body: string; authorization?: string }>;
  close: () => Promise<void>;
}

const services: MockService[] = [];

afterEach(async () => {
  while (services.length) {
    const service = services.pop();
    await service?.close();
  }
});

function setup(baseUrl: string, patch: Partial<ModelSetup> = {}): ModelSetup {
  return {
    provider: 'openai',
    baseUrl,
    model: 'qwen3',
    apiKey: '',
    ...patch,
  };
}

async function startService(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<MockService> {
  const requests: MockService['requests'] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body,
        authorization: req.headers.authorization,
      });
      handler(req, res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server failed');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  const service = { baseUrl, requests, close };
  services.push(service);
  return service;
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

describe('fetchThinkingOptions', () => {
  it('reads Ollama thinking values from /api/show', async () => {
    const service = await startService((req, res) => {
      if (req.method === 'POST' && req.url === '/api/show') {
        json(res, 200, {
          thinking: { values: ['low', 'medium', 'high'], default: 'medium' },
        });
        return;
      }
      json(res, 404, { error: 'not found' });
    });

    const result = await fetchThinkingOptions(setup(`${service.baseUrl}/v1`));
    expect(result).toMatchObject({
      source: 'ollama',
      options: ['low', 'medium', 'high'],
      defaultLevel: 'medium',
    });
    expect(service.requests.some((request) => request.url === '/api/show')).toBe(true);
  });

  it('reads OpenRouter supported efforts from the models catalog', async () => {
    const service = await startService((req, res) => {
      if (req.method === 'POST' && req.url === '/api/show') {
        json(res, 404, { error: 'not found' });
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        json(res, 200, {
          data: [
            {
              id: 'openai/gpt-5-mini',
              supported_parameters: ['reasoning_effort', 'reasoning'],
              reasoning: {
                supported_efforts: ['high', 'medium', 'low', 'minimal'],
                default_effort: 'medium',
              },
            },
          ],
        });
        return;
      }
      json(res, 404, { error: 'not found' });
    });

    const result = await fetchThinkingOptions(
      setup(`${service.baseUrl}/v1`, { model: 'openai/gpt-5-mini' }),
    );
    expect(result).toMatchObject({
      source: 'openrouter',
      options: ['high', 'medium', 'low', 'minimal'],
      defaultLevel: 'medium',
    });
    // Catalog metadata is authoritative; no paid reasoning probe is needed.
    expect(service.requests.some((request) => request.url === '/v1/chat/completions')).toBe(false);
  });

  it('detects reasoning_effort support with a tiny chat probe when the catalog is silent', async () => {
    const service = await startService((req, res, body) => {
      if (req.method === 'POST' && req.url === '/api/show') {
        json(res, 404, { error: 'not found' });
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        json(res, 200, { data: [{ id: 'qwen3', object: 'model' }] });
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        expect(body).toContain('"reasoning_effort":"medium"');
        expect(body).toContain('"max_tokens":16');
        json(res, 200, {
          choices: [
            {
              message: {
                content: '',
                reasoning_content: 'thinking about the multiplication',
              },
            },
          ],
          usage: {
            completion_tokens: 9,
            completion_tokens_details: { reasoning_tokens: 8 },
          },
        });
        return;
      }
      json(res, 404, { error: 'not found' });
    });

    const result = await fetchThinkingOptions(
      setup(`${service.baseUrl}/v1`, { apiKey: 'probe-secret-key' }),
    );
    expect(result).toMatchObject({
      source: 'api',
      options: ['minimal', 'low', 'medium', 'high'],
      defaultLevel: 'medium',
    });
    expect(result.note).toMatch(/最小推理请求/);
    const probe = service.requests.find((request) => request.url === '/v1/chat/completions');
    expect(probe?.authorization).toBe('Bearer probe-secret-key');
  });

  it('recognizes reasoning tokens reported through usage details', async () => {
    const service = await startService((req, res) => {
      if (req.method === 'POST' && req.url === '/api/show') {
        json(res, 404, { error: 'not found' });
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        json(res, 200, { data: [{ id: 'qwen3' }] });
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        json(res, 200, {
          choices: [{ message: { content: '391' } }],
          usage: {
            completion_tokens: 20,
            completion_tokens_details: { reasoning_tokens: 12 },
          },
        });
        return;
      }
      json(res, 404, { error: 'not found' });
    });

    const result = await fetchThinkingOptions(setup(`${service.baseUrl}/v1`));
    expect(result).toMatchObject({
      source: 'api',
      options: ['minimal', 'low', 'medium', 'high'],
    });
  });

  it('offers OpenAI-compatible levels when the probe sees no reasoning output', async () => {
    const service = await startService((req, res) => {
      if (req.method === 'POST' && req.url === '/api/show') {
        json(res, 404, { error: 'not found' });
        return;
      }
      if (req.method === 'GET' && req.url === '/v1/models') {
        json(res, 200, { data: [{ id: 'qwen3' }] });
        return;
      }
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        json(res, 200, {
          choices: [{ message: { content: '391' } }],
          usage: { completion_tokens: 2 },
        });
        return;
      }
      json(res, 404, { error: 'not found' });
    });

    const result = await fetchThinkingOptions(setup(`${service.baseUrl}/v1`));
    expect(result).toMatchObject({
      source: 'fallback',
      options: ['minimal', 'low', 'medium', 'high'],
      defaultLevel: 'medium',
    });
    expect(result.note).toMatch(/仍统一提供/);
  });

  it('offers OpenAI-compatible levels even when the metadata endpoint is unreachable', async () => {
    const service = await startService((_req, res) => {
      json(res, 404, { error: 'not found' });
    });

    const result = await fetchThinkingOptions(setup(`${service.baseUrl}/v1`));
    expect(result).toMatchObject({
      source: 'fallback',
      options: ['minimal', 'low', 'medium', 'high'],
      defaultLevel: 'medium',
    });
    expect(result.note).toMatch(/仍统一提供/);
  });

  it('keeps the built-in levels for Anthropic fallback', async () => {
    const service = await startService((_req, res) => {
      json(res, 404, { error: 'not found' });
    });

    const result = await fetchThinkingOptions(
      setup(`${service.baseUrl}/v1`, { provider: 'anthropic' }),
    );
    expect(result).toMatchObject({
      source: 'fallback',
      options: ['quick', 'balanced', 'deep'],
      defaultLevel: 'balanced',
    });
    expect(result.note).toMatch(/未能从 API 读取/);
  });

  it('keeps unknown service responses from leaking the API key', async () => {
    const service = await startService((_req, res) => {
      json(res, 401, { error: 'bad key sk-secret-key-123456' });
    });

    const result = await fetchThinkingOptions(
      setup(`${service.baseUrl}/v1`, { apiKey: 'sk-secret-key-123456' }),
    );
    expect(result.source).toBe('fallback');
    expect(JSON.stringify(result)).not.toContain('sk-secret-key-123456');
  });
});

describe('validateThinkingOptionsRequest', () => {
  it('uses the saved profile key and can resolve a profile-only request', () => {
    const lookup = {
      resolveSetup(id: string): ModelSetup | null {
        if (id !== 'saved-1') return null;
        return {
          provider: 'openai',
          baseUrl: 'https://saved.test/v1',
          model: 'saved-model',
          apiKey: 'saved-secret',
        };
      },
    };

    const onlyProfile = validateThinkingOptionsRequest({ profileId: 'saved-1' }, lookup);
    expect(onlyProfile).toMatchObject({
      baseUrl: 'https://saved.test/v1',
      model: 'saved-model',
      apiKey: 'saved-secret',
    });

    const overridden = validateThinkingOptionsRequest(
      {
        profileId: 'saved-1',
        provider: 'openai',
        baseUrl: 'https://edited.test/v1',
        model: 'edited-model',
      },
      lookup,
    );
    expect(overridden).toMatchObject({
      baseUrl: 'https://edited.test/v1',
      model: 'edited-model',
      apiKey: 'saved-secret',
    });

    expect(() =>
      validateThinkingOptionsRequest({ profileId: 'gone' }, lookup),
    ).toThrow(/已不存在/);
  });
});
