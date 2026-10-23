import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelSetup } from '../../shared/protocol';
import { testModelAvailability } from './availability';

interface MockService {
  baseUrl: string;
  requests: Array<{
    method: string;
    url: string;
    body: string;
    authorization?: string;
  }>;
  close: () => Promise<void>;
}

const services: MockService[] = [];

afterEach(async () => {
  while (services.length) {
    await services.pop()?.close();
  }
});

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
  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  const service = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close,
  };
  services.push(service);
  return service;
}

function setup(baseUrl: string, patch: Partial<ModelSetup> = {}): ModelSetup {
  return {
    provider: 'openai',
    baseUrl,
    model: 'test-model',
    apiKey: 'sk-test-secret-1234',
    thinkingLevel: 'deep',
    apiReasoning: true,
    ...patch,
  };
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}

describe('testModelAvailability', () => {
  it('sends one configured probe and returns sanitized success details', async () => {
    const service = await startService((req, res, body) => {
      if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
        json(res, 404, { error: { message: 'not found' } });
        return;
      }
      const parsed = JSON.parse(body) as Record<string, unknown>;
      expect(parsed.model).toBe('test-model');
      expect(parsed.reasoning_effort).toBe('high');
      expect(parsed.stream).toBe(false);
      json(res, 200, {
        choices: [{ message: { content: 'OK' } }],
        usage: { prompt_tokens: 12, completion_tokens: 1 },
      });
    });

    const result = await testModelAvailability(
      setup(`${service.baseUrl}/v1`),
      undefined,
      { timeoutMs: 2_000 },
    );

    expect(result).toMatchObject({
      ok: true,
      provider: 'openai',
      model: 'test-model',
      tokensIn: 12,
      tokensOut: 1,
      replyPreview: 'OK',
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toMatch(/模型可用/);
    expect(service.requests).toHaveLength(1);
    expect(service.requests[0]?.authorization).toBe('Bearer sk-test-secret-1234');
    expect(JSON.stringify(result)).not.toContain('sk-test-secret-1234');
  });

  it('reports provider errors without leaking the API key', async () => {
    const service = await startService((_req, res) => {
      json(res, 401, {
        error: { message: 'bad key sk-test-secret-1234' },
      });
    });

    const result = await testModelAvailability(
      setup(`${service.baseUrl}/v1`),
      undefined,
      { timeoutMs: 2_000 },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/模型不可用/);
    expect(result.message).toMatch(/鉴权失败/);
    expect(result.message).not.toContain('sk-test-secret-1234');
    expect(JSON.stringify(result)).not.toContain('sk-test-secret-1234');
    expect(result.replyPreview).toBe('');
  });

  it('times out a model that never responds', async () => {
    const service = await startService(() => {
      // Deliberately leave the response open.
    });

    const result = await testModelAvailability(
      setup(`${service.baseUrl}/v1`),
      undefined,
      { timeoutMs: 250 },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/超时/);
  });

  it('supports Anthropic Messages probes through the same factory', async () => {
    const service = await startService((req, res) => {
      if (req.method !== 'POST' || req.url !== '/v1/messages') {
        json(res, 404, { error: { message: 'not found' } });
        return;
      }
      expect(req.headers['x-api-key']).toBe('sk-anthropic-secret');
      json(res, 200, {
        type: 'message',
        content: [{ type: 'text', text: 'OK' }],
        usage: { input_tokens: 8, output_tokens: 1 },
      });
    });

    const result = await testModelAvailability(
      setup(`${service.baseUrl}/v1`, {
        provider: 'anthropic',
        apiKey: 'sk-anthropic-secret',
        apiReasoning: false,
        thinkingLevel: 'quick',
      }),
      undefined,
      { timeoutMs: 2_000 },
    );

    expect(result).toMatchObject({
      ok: true,
      provider: 'anthropic',
      replyPreview: 'OK',
      tokensIn: 8,
      tokensOut: 1,
    });
    expect(JSON.stringify(result)).not.toContain('sk-anthropic-secret');
  });
});
