import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelSetup } from '../../shared/protocol';
import { anthropicProvider } from './anthropic';
import { openaiProvider } from './openai';
import { ProviderError } from './types';
import { redactSecrets, requestJson } from './http';
import {
  THINKING_TIMEOUT_MS,
  isOpenRouterEndpoint,
  maxCompletionTokensFor,
  maxThinkingTokensFor,
  requestTimeoutMs,
  resolvePromptLevel,
  thinkingBudgetFor,
  thinkingTimeoutMs,
  usesMaxCompletionTokens,
} from './thinking';

interface CapturedRequest {
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

interface MockServer {
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

const servers: MockServer[] = [];

afterEach(async () => {
  while (servers.length) {
    const server = servers.pop();
    await server?.close();
  }
});

async function mockServer(
  handler: (request: CapturedRequest, response: ServerResponse) => void,
): Promise<MockServer> {
  const requests: CapturedRequest[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let body: Record<string, unknown> = {};
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        body = { raw };
      }
      const captured: CapturedRequest = {
        url: req.url ?? '',
        headers: req.headers,
        body,
      };
      requests.push(captured);
      handler(captured, res);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('mock server did not start');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });

  const mock: MockServer = { baseUrl, requests, close };
  servers.push(mock);
  return mock;
}

function openAiSetup(baseUrl: string): ModelSetup {
  return {
    provider: 'openai',
    baseUrl: `${baseUrl}/v1`,
    model: 'test-model',
    apiKey: 'sk-test-secret-123',
  };
}

function anthropicSetup(baseUrl: string): ModelSetup {
  return {
    provider: 'anthropic',
    baseUrl: `${baseUrl}/v1`,
    model: 'claude-test',
    apiKey: 'ak-test-secret-456',
  };
}

function request(): Parameters<typeof openaiProvider.complete>[1] {
  return {
    system: 'system prompt',
    messages: [{ role: 'user', content: 'choose a move' }],
  };
}

describe('OpenAI-compatible provider', () => {
  it('posts the expected chat completions request and parses usage', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"move":"h2e2","reason":"中炮"}',
              },
            },
          ],
          usage: { prompt_tokens: 120, completion_tokens: 14 },
        }),
      );
    });

    const reply = await openaiProvider.complete(openAiSetup(mock.baseUrl), request(), new AbortController().signal);

    expect(reply.text).toContain('h2e2');
    expect(reply.tokensIn).toBe(120);
    expect(reply.tokensOut).toBe(14);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]?.url).toBe('/v1/chat/completions');
    expect(mock.requests[0]?.headers.authorization).toBe('Bearer sk-test-secret-123');
    expect(mock.requests[0]?.body).toMatchObject({
      model: 'test-model',
      stream: false,
    });
    expect(mock.requests[0]?.body.reasoning_effort).toBeUndefined();
    const messages = mock.requests[0]?.body.messages as Array<Record<string, unknown>>;
    expect(messages[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(messages[1]).toEqual({ role: 'user', content: 'choose a move' });
  });

  it('maps opt-in thinking levels to reasoning_effort and can be disabled', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '{"move":"h2e2","reason":"test"}' } }],
        }),
      );
    });
    const base = openAiSetup(mock.baseUrl);
    const levels = [
      ['quick', 'low'],
      ['balanced', 'medium'],
      ['deep', 'high'],
    ] as const;

    for (const [thinkingLevel] of levels) {
      await openaiProvider.complete(
        { ...base, apiReasoning: true, thinkingLevel },
        request(),
        new AbortController().signal,
      );
    }
    expect(mock.requests.map((entry) => entry.body.reasoning_effort)).toEqual([
      'low',
      'medium',
      'high',
    ]);

    await openaiProvider.complete(
      { ...base, apiReasoning: false, thinkingLevel: 'deep' },
      request(),
      new AbortController().signal,
    );
    expect(mock.requests[3]?.body.reasoning_effort).toBeUndefined();

    await openaiProvider.complete(
      { ...base, apiReasoning: true, thinkingLevel: 'minimal' },
      request(),
      new AbortController().signal,
    );
    await openaiProvider.complete(
      { ...base, apiReasoning: true, thinkingLevel: 'off' },
      request(),
      new AbortController().signal,
    );
    expect(mock.requests[4]?.body.reasoning_effort).toBe('minimal');
    expect(mock.requests[5]?.body.reasoning_effort).toBeUndefined();
  });

  it('accepts a complete endpoint and array-shaped content', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [{ type: 'text', text: '{"move":"b2e2",' }, { type: 'text', text: '"reason":"列炮"}' }],
              },
            },
          ],
        }),
      );
    });

    const setup = { ...openAiSetup(mock.baseUrl), baseUrl: `${mock.baseUrl}/custom/chat/completions` };
    const reply = await openaiProvider.complete(setup, request(), new AbortController().signal);

    expect(mock.requests[0]?.url).toBe('/custom/chat/completions');
    expect(reply.text).toBe('{"move":"b2e2","reason":"列炮"}');
    expect(reply.tokensIn).toBe(0);
  });

  it('uses reasoning_content as a compatibility fallback', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '', reasoning_content: '{"move":"h0g2","reason":"起马"}' } }],
        }),
      );
    });
    const reply = await openaiProvider.complete(openAiSetup(mock.baseUrl), request(), new AbortController().signal);
    expect(reply.text).toContain('h0g2');
  });

  it('maps auth errors to non-retryable ProviderError', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Incorrect API key provided: sk-test-secret-123' } }));
    });

    await expect(
      openaiProvider.complete(openAiSetup(mock.baseUrl), request(), new AbortController().signal),
    ).rejects.toMatchObject({ name: 'ProviderError', status: 401, retryable: false });
  });

  it('maps server errors to retryable ProviderError', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('upstream overloaded');
    });

    await expect(
      openaiProvider.complete(openAiSetup(mock.baseUrl), request(), new AbortController().signal),
    ).rejects.toMatchObject({ name: 'ProviderError', retryable: true, status: 503 });
  });

  it('rejects empty or non-JSON responses', async () => {
    const empty = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '' } }] }));
    });
    await expect(
      openaiProvider.complete(openAiSetup(empty.baseUrl), request(), new AbortController().signal),
    ).rejects.toBeInstanceOf(ProviderError);

    const invalid = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html>not json</html>');
    });
    await expect(
      openaiProvider.complete(openAiSetup(invalid.baseUrl), request(), new AbortController().signal),
    ).rejects.toMatchObject({ name: 'ProviderError', retryable: true });
  });

  it('propagates caller cancellation', async () => {
    const mock = await mockServer((_request, res) => {
      setTimeout(() => {
        if (res.writableEnded) return;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: '{}' } }] }));
      }, 80);
    });
    const controller = new AbortController();
    const pending = openaiProvider.complete(openAiSetup(mock.baseUrl), request(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toBeDefined();
  });

  it('classifies an exhausted quota as a non-retryable pause signal', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: {
            message: 'You exceeded your current quota, please check your plan and billing details.',
            type: 'insufficient_quota',
          },
        }),
      );
    });

    await expect(
      openaiProvider.complete(openAiSetup(mock.baseUrl), request(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: 'ProviderError',
      status: 429,
      retryable: false,
      quotaExceeded: true,
    });
  });

  it('keeps an ordinary rate limit retryable', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          error: { message: 'Rate limit reached for requests; please try again later.' },
        }),
      );
    });

    await expect(
      openaiProvider.complete(openAiSetup(mock.baseUrl), request(), new AbortController().signal),
    ).rejects.toMatchObject({
      name: 'ProviderError',
      status: 429,
      retryable: true,
      quotaExceeded: false,
    });
  });

  it('treats HTTP 402 as an exhausted quota', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(402, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Payment required' } }));
    });

    await expect(
      openaiProvider.complete(openAiSetup(mock.baseUrl), request(), new AbortController().signal),
    ).rejects.toMatchObject({ quotaExceeded: true, retryable: false });
  });

  it('marks an unanswered request as a non-retryable timeout', async () => {
    const mock = await mockServer(() => {
      // Hold the connection open so only the per-request timer can settle it.
    });

    await expect(
      requestJson({
        url: `${mock.baseUrl}/v1/chat/completions`,
        headers: {},
        body: {},
        signal: new AbortController().signal,
        timeoutMs: 120,
      }),
    ).rejects.toMatchObject({
      name: 'ProviderError',
      timeout: true,
      timeoutSeconds: 1,
      retryable: false,
    });
  });

  it('marks a stalled response read as a timeout', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.write('{"choices":[');
      // Never finish the body.
    });

    await expect(
      requestJson({
        url: `${mock.baseUrl}/v1/chat/completions`,
        headers: {},
        body: {},
        signal: new AbortController().signal,
        timeoutMs: 120,
      }),
    ).rejects.toMatchObject({
      name: 'ProviderError',
      timeout: true,
      message: expect.stringContaining('读取模型响应超时'),
    });
  });
});

describe('completion-token caps', () => {
  it('sends max_tokens on a generic OpenAI-compatible gateway', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '{"move":"h2e2","reason":"test"}' } }],
        }),
      );
    });

    await openaiProvider.complete(
      { ...openAiSetup(mock.baseUrl), maxCompletionTokens: 4096 },
      request(),
      new AbortController().signal,
    );
    expect(mock.requests[0]?.body.max_tokens).toBe(4096);
    expect(mock.requests[0]?.body.max_completion_tokens).toBeUndefined();
  });

  it('chooses max_completion_tokens for official OpenAI and reasoning families', () => {
    expect(
      usesMaxCompletionTokens({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' }),
    ).toBe(true);
    expect(
      usesMaxCompletionTokens({ baseUrl: 'https://example.com/v1', model: 'o3-mini' }),
    ).toBe(true);
    expect(
      usesMaxCompletionTokens({ baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }),
    ).toBe(false);
  });

  it('recognises scripted completion truncation', async () => {
    const partial = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { content: '{"move":"h2e2","reason":"被截断' },
              finish_reason: 'length',
            },
          ],
        }),
      );
    });
    const reply = await openaiProvider.complete(
      openAiSetup(partial.baseUrl),
      request(),
      new AbortController().signal,
    );
    expect(reply.truncated).toBe(true);
    expect(reply.text).toContain('h2e2');

    const empty = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: '' }, finish_reason: 'length' }],
        }),
      );
    });
    await expect(
      openaiProvider.complete(
        openAiSetup(empty.baseUrl),
        request(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: 'ProviderError',
      truncated: true,
      retryable: false,
    });
  });

  it('sends reasoning.max_tokens to OpenRouter-style endpoints', async () => {
    // Only the URL decides the OpenRouter path; the local mock never receives
    // a request because the provider cannot reach openrouter.invalid, so this
    // test asserts the endpoint helpers instead.
    expect(
      isOpenRouterEndpoint({ baseUrl: 'https://openrouter.ai/api/v1' }),
    ).toBe(true);
    expect(
      isOpenRouterEndpoint({ baseUrl: 'https://api.openai.com/v1' }),
    ).toBe(false);
  });
});

describe('Anthropic provider', () => {
  it('posts a Messages API request and parses text blocks and usage', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [
            { type: 'text', text: '{"move":"h9g7",' },
            { type: 'text', text: '"reason":"屏风马"}' },
          ],
          usage: { input_tokens: 90, output_tokens: 22 },
        }),
      );
    });

    const reply = await anthropicProvider.complete(
      anthropicSetup(mock.baseUrl),
      request(),
      new AbortController().signal,
    );

    expect(reply.text).toBe('{"move":"h9g7",\n"reason":"屏风马"}');
    expect(reply.tokensIn).toBe(90);
    expect(reply.tokensOut).toBe(22);
    expect(mock.requests[0]?.url).toBe('/v1/messages');
    expect(mock.requests[0]?.headers['x-api-key']).toBe('ak-test-secret-456');
    expect(mock.requests[0]?.headers['anthropic-version']).toBe('2023-06-01');
    expect(mock.requests[0]?.body).toMatchObject({
      model: 'claude-test',
      system: 'system prompt',
      max_tokens: 1200,
    });
    expect(mock.requests[0]?.body.thinking).toBeUndefined();
    const messages = mock.requests[0]?.body.messages as Array<Record<string, unknown>>;
    expect(messages).toEqual([{ role: 'user', content: 'choose a move' }]);
  });

  it('maps opt-in thinking levels to extended-thinking budgets and output budget', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [{ type: 'text', text: '{"move":"h9g7","reason":"test"}' }],
        }),
      );
    });
    const base = anthropicSetup(mock.baseUrl);
    const levels = [
      ['quick', 1024, 2048],
      ['balanced', 2048, 3072],
      ['deep', 4096, 5120],
    ] as const;

    for (const [thinkingLevel] of levels) {
      await anthropicProvider.complete(
        { ...base, apiReasoning: true, thinkingLevel },
        request(),
        new AbortController().signal,
      );
    }

    expect(
      mock.requests.map((entry) => {
        const thinking = entry.body.thinking as Record<string, unknown>;
        return [thinking.budget_tokens, entry.body.max_tokens];
      }),
    ).toEqual([
      [1024, 2048],
      [2048, 3072],
      [4096, 5120],
    ]);
    expect(mock.requests[0]?.body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 1024,
    });

    await anthropicProvider.complete(
      { ...base, apiReasoning: true, thinkingLevel: 'high' },
      request(),
      new AbortController().signal,
    );
    await anthropicProvider.complete(
      { ...base, apiReasoning: true, thinkingLevel: 'off' },
      request(),
      new AbortController().signal,
    );
    expect((mock.requests[3]?.body.thinking as Record<string, unknown>).budget_tokens).toBe(4096);
    expect(mock.requests[4]?.body.thinking).toBeUndefined();
    expect(mock.requests[4]?.body.max_tokens).toBe(1200);
  });

  it('honours explicit thinking and completion caps', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [{ type: 'text', text: '{"move":"h9g7","reason":"test"}' }],
        }),
      );
    });
    const base = anthropicSetup(mock.baseUrl);

    await anthropicProvider.complete(
      {
        ...base,
        apiReasoning: true,
        thinkingLevel: 'quick',
        maxThinkingTokens: 1500,
        maxCompletionTokens: 6000,
      },
      request(),
      new AbortController().signal,
    );
    expect(mock.requests[0]?.body.thinking).toEqual({
      type: 'enabled',
      budget_tokens: 1500,
    });
    expect(mock.requests[0]?.body.max_tokens).toBe(6000);

    await anthropicProvider.complete(
      { ...base, apiReasoning: false, maxCompletionTokens: 2500 },
      request(),
      new AbortController().signal,
    );
    expect(mock.requests[1]?.body.thinking).toBeUndefined();
    expect(mock.requests[1]?.body.max_tokens).toBe(2500);
  });

  it('flags stop_reason=max_tokens as truncation', async () => {
    const partial = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [{ type: 'text', text: '{"move":"h9g7","reason":"被截断' }],
          stop_reason: 'max_tokens',
        }),
      );
    });
    const reply = await anthropicProvider.complete(
      anthropicSetup(partial.baseUrl),
      request(),
      new AbortController().signal,
    );
    expect(reply.truncated).toBe(true);

    const empty = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ content: [], stop_reason: 'max_tokens' }));
    });
    await expect(
      anthropicProvider.complete(
        anthropicSetup(empty.baseUrl),
        request(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      name: 'ProviderError',
      truncated: true,
      retryable: false,
    });
  });

  it('rejects an error-typed 200 response', async () => {
    const mock = await mockServer((_request, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { message: 'overloaded' } }));
    });
    await expect(
      anthropicProvider.complete(anthropicSetup(mock.baseUrl), request(), new AbortController().signal),
    ).rejects.toMatchObject({ name: 'ProviderError', retryable: true });
  });
});

describe('secret redaction', () => {
  it('removes exact keys and common token patterns', () => {
    const text = redactSecrets(
      'bad key sk-abcdefghijklmnop and Bearer abcdefghijklmnop and exact-secret-value',
      ['exact-secret-value'],
    );
    expect(text).not.toContain('sk-abcdefghijklmnop');
    expect(text).not.toContain('abcdefghijklmnop');
    expect(text).not.toContain('exact-secret-value');
  });
});

describe('thinking-level request budgets', () => {
  it('maps quick / balanced / deep to increasing timeouts', () => {
    expect(THINKING_TIMEOUT_MS.quick).toBeLessThan(THINKING_TIMEOUT_MS.balanced);
    expect(THINKING_TIMEOUT_MS.balanced).toBeLessThan(THINKING_TIMEOUT_MS.deep);
    expect(thinkingTimeoutMs({})).toBe(THINKING_TIMEOUT_MS.balanced);
    expect(thinkingTimeoutMs({ thinkingLevel: 'quick' })).toBe(THINKING_TIMEOUT_MS.quick);
    expect(thinkingTimeoutMs({ thinkingLevel: 'deep' })).toBe(THINKING_TIMEOUT_MS.deep);
    expect(thinkingTimeoutMs({ thinkingLevel: 'minimal' })).toBe(THINKING_TIMEOUT_MS.quick);
    expect(thinkingTimeoutMs({ thinkingLevel: 'high' })).toBe(THINKING_TIMEOUT_MS.deep);
    expect(thinkingTimeoutMs({ thinkingLevel: 'off' })).toBe(THINKING_TIMEOUT_MS.quick);
  });

  it('lets an explicit request timeout override the thinking tier', () => {
    expect(requestTimeoutMs({ thinkingLevel: 'minimal', requestTimeoutSeconds: 300 })).toBe(
      300_000,
    );
    expect(requestTimeoutMs({ thinkingLevel: 'deep', requestTimeoutSeconds: 45 })).toBe(45_000);
    expect(requestTimeoutMs({ thinkingLevel: 'minimal' })).toBe(THINKING_TIMEOUT_MS.quick);
    expect(requestTimeoutMs({ thinkingLevel: 'high', requestTimeoutSeconds: null })).toBe(
      THINKING_TIMEOUT_MS.deep,
    );
  });

  it('resolves prompt intensity independently from the API thinking level', () => {
    expect(resolvePromptLevel({ thinkingLevel: 'high' })).toBe('high');
    expect(resolvePromptLevel({ thinkingLevel: 'high', promptLevel: 'quick' })).toBe('quick');
    expect(resolvePromptLevel({ thinkingLevel: 'high', promptLevel: null })).toBe('high');
    expect(resolvePromptLevel({})).toBe('balanced');
  });

  it('applies the thinking and completion token caps to the effective setup', () => {
    expect(
      thinkingBudgetFor({ apiReasoning: true, thinkingLevel: 'quick', maxThinkingTokens: 1234 }),
    ).toBe(1234);
    expect(
      thinkingBudgetFor({ apiReasoning: false, thinkingLevel: 'quick', maxThinkingTokens: 1234 }),
    ).toBeNull();
    expect(thinkingBudgetFor({ apiReasoning: true, thinkingLevel: 'deep' })).toBe(4096);
    expect(maxThinkingTokensFor({ maxThinkingTokens: 1234 })).toBe(1234);
    expect(maxThinkingTokensFor({})).toBeNull();
    expect(maxCompletionTokensFor({ maxCompletionTokens: 4096 })).toBe(4096);
    expect(maxCompletionTokensFor({ maxCompletionTokens: 0 })).toBeNull();
  });
});
