import { afterEach, describe, expect, it } from 'vitest';
import type { ArenaState, ModelSetup, ThinkingLevel } from '../../shared/protocol';
import { DEFAULT_THINKING_LEVEL } from '../../shared/protocol';
import {
  ProviderError,
  type CompletionRequest,
  type ModelProvider,
  type ProviderReply,
} from '../providers/index';
import { XiangqiGame } from '../xiangqi/index';
import { Arena } from './arena';

const activeArenas: Arena[] = [];

afterEach(() => {
  while (activeArenas.length) activeArenas.pop()?.dispose();
});

function setup(
  model: string,
  apiKey = 'test-secret-key',
  thinkingLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL,
  apiReasoning = false,
): ModelSetup {
  return {
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    model,
    apiKey,
    thinkingLevel,
    apiReasoning,
  };
}

function reply(move: string, reason = '测试理由'): ProviderReply {
  return {
    text: JSON.stringify({ move, reason }),
    tokensIn: 11,
    tokensOut: 7,
  };
}

interface Call {
  model: string;
  request: CompletionRequest;
}

function firstLegalFromPrompt(request: CompletionRequest): string {
  const content = [...request.messages].reverse().map((message) => message.content).join('\n');
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*-\s+([a-i][0-9][a-i][0-9])\s+/);
    if (match?.[1]) return match[1];
  }
  const inline = content.match(/合法着法：([^\n]+)/);
  const fromInline = inline?.[1]?.match(/[a-i][0-9][a-i][0-9]/);
  if (fromInline?.[0]) return fromInline[0];
  throw new Error('prompt did not contain a legal move');
}

class ScriptedProvider implements ModelProvider {
  readonly provider = 'openai' as const;
  readonly calls: Call[] = [];
  private readonly queues: Record<string, string[]>;

  constructor(queues: Record<string, string[]>) {
    this.queues = {
      red: [...(queues.red ?? [])],
      black: [...(queues.black ?? [])],
    };
  }

  async complete(
    modelSetup: ModelSetup,
    request: CompletionRequest,
    signal: AbortSignal,
  ): Promise<ProviderReply> {
    this.calls.push({ model: modelSetup.model, request });
    if (signal.aborted) throw new DOMException('aborted', 'AbortError');
    const key = modelSetup.model.startsWith('black') ? 'black' : 'red';
    const next = this.queues[key]?.shift();
    if (next === undefined) return reply(firstLegalFromPrompt(request));
    if (next.startsWith('ERROR:')) {
      throw new ProviderError(next.slice('ERROR:'.length), { retryable: false });
    }
    if (next.startsWith('RETRY_ERROR:')) {
      throw new ProviderError(next.slice('RETRY_ERROR:'.length), { retryable: true });
    }
    return reply(next);
  }
}

function createArena(provider: ModelProvider): Arena {
  const arena = new Arena({ providerFactory: () => provider });
  activeArenas.push(arena);
  return arena;
}

function startGame(arena: Arena, settings = { moveDelayMs: 0, maxAttempts: 3 }): ArenaState {
  return arena.start({
    red: setup('red-model', 'red-secret-value'),
    black: setup('black-model', 'black-secret-value'),
    settings,
  });
}

function waitFor(
  arena: Arena,
  predicate: (state: ArenaState) => boolean,
  timeoutMs = 4000,
): Promise<ArenaState> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error(`timed out waiting for state; last phase=${arena.getState().phase}`));
    }, timeoutMs);
    const check = (): void => {
      if (settled) return;
      const state = arena.getState();
      if (!predicate(state)) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    };
    const unsubscribe = arena.onState(check);
    check();
  });
}

function tick(ms = 15): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Arena lifecycle and model turns', () => {
  it('starts a match, lets both models move, and never leaks keys', async () => {
    const provider = new ScriptedProvider({
      red: ['h2e2', 'h0g2'],
      black: ['h9g7', 'b9c7'],
    });
    const arena = createArena(provider);
    const initial = startGame(arena);

    expect(initial.phase).toBe('running');
    expect(initial.matchId).toBeTruthy();
    expect(initial.models.red?.model).toBe('red-model');
    expect(initial.models.black?.model).toBe('black-model');

    const state = await waitFor(arena, (current) => current.moves.length >= 4);
    const paused = arena.pause();

    expect(paused.phase).toBe('paused');
    expect(paused.moves.slice(0, 4).map((move) => move.ucci)).toEqual([
      'h2e2',
      'h9g7',
      'h0g2',
      'b9c7',
    ]);
    expect(paused.moves[0]).toMatchObject({
      side: 'red',
      notation: '炮二平五',
      tokensIn: 11,
      tokensOut: 7,
    });
    expect(paused.lastMove?.toUcci).toBe('c7');
    expect(paused.ply).toBeGreaterThanOrEqual(4);
    expect(paused.models.red?.displayName).toBe('red-model');
    expect(paused.models.red?.totalTokensIn).toBeGreaterThanOrEqual(22);
    expect(paused.models.red?.keyConfigured).toBe(true);
    expect(paused.models.red?.thinking).toBe(false);

    const serialized = JSON.stringify(paused);
    expect(serialized).not.toContain('red-secret-value');
    expect(serialized).not.toContain('black-secret-value');
    expect(serialized).not.toContain('apiKey');

    const firstRequest = provider.calls[0]?.request;
    expect(firstRequest?.system).toContain('你执红方');
    const firstUser = firstRequest?.messages.at(-1)?.content ?? '';
    expect(firstUser).toContain('FEN：');
    expect(firstUser).toContain('合法着法');
    expect(firstUser).toContain('h2e2');
    expect(provider.calls.some((call) => call.model === 'black-model')).toBe(true);
    expect(state.revision).toBeGreaterThan(0);
  });

  it('applies each side’s thinking level to prompts and public state', async () => {
    const provider = new ScriptedProvider({
      red: ['h2e2'],
      black: ['h9g7'],
    });
    const arena = createArena(provider);
    arena.start({
      red: setup('red-model', 'red-secret', 'quick', true),
      black: setup('black-model', 'black-secret', 'deep'),
      settings: { moveDelayMs: 0, maxAttempts: 3 },
    });

    const state = await waitFor(arena, (current) => current.moves.length >= 2);
    arena.pause();
    expect(state.models.red?.thinkingLevel).toBe('quick');
    expect(state.models.red?.apiReasoning).toBe(true);
    expect(state.models.black?.thinkingLevel).toBe('deep');
    expect(state.models.black?.apiReasoning).toBe(false);
    expect(provider.calls.find((call) => call.model === 'red-model')?.request.system).toContain(
      '【思考强度：快速】',
    );
    expect(provider.calls.find((call) => call.model === 'black-model')?.request.system).toContain(
      '【思考强度：深思】',
    );
  });

  it('feeds an illegal move back to the model and retries', async () => {
    const provider = new ScriptedProvider({
      red: ['{"move":"z9z9","reason":"错着"}', 'h2e2'],
      black: ['h9g7'],
    });
    const arena = createArena(provider);
    startGame(arena);

    const state = await waitFor(arena, (current) => current.moves.length >= 1);
    arena.pause();
    expect(state.moves[0]?.ucci).toBe('h2e2');
    expect(state.error).toBeNull();
    expect(provider.calls.filter((call) => call.model === 'red-model')).toHaveLength(2);

    const retryRequest = provider.calls[1]?.request;
    expect(retryRequest?.messages).toHaveLength(3);
    expect(retryRequest?.messages[1]?.role).toBe('assistant');
    expect(retryRequest?.messages[1]?.content).toContain('z9z9');
    expect(retryRequest?.messages[2]?.content).toContain('上一次的输出无效');
    expect(retryRequest?.messages[2]?.content).toContain('UCCI');
  });

  it('adjudicates a direct loss after exhausting illegal attempts', async () => {
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        // Syntactically valid UCCI but not a legal move from the start position.
        return reply('a9a9');
      },
    };
    const completions: ArenaState[] = [];
    const arena = new Arena({
      providerFactory: () => provider,
      onGameComplete: (completion) => completions.push(completion.state),
    });
    activeArenas.push(arena);
    startGame(arena, { moveDelayMs: 0, maxAttempts: 2 });

    const finished = await waitFor(arena, (current) => current.phase === 'finished');
    expect(finished.error).toBeNull();
    expect(finished.result).toMatchObject({ winner: 'black', reason: 'forfeit' });
    expect(finished.result?.text).toContain('红方连续 2 次未给出合法着法');
    expect(finished.result?.text).toContain('判负');
    expect(finished.models.red?.thinking).toBe(false);
    expect(finished.models.red?.lastError).toBeTruthy();
    expect(finished.models.red?.lastError).toContain('连续 2 次');
    expect(finished.moves).toHaveLength(0);
    expect(completions).toHaveLength(1);
    expect(completions[0]?.result?.reason).toBe('forfeit');
    expect(completions[0]?.result?.winner).toBe('black');

    // The game is already over; there is no turn to retry.
    expect(() => arena.retry()).toThrow(/出错/);
  });

  it('adjudicates a direct loss when responses cannot be parsed into a move', async () => {
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        return { text: '我还没想好', tokensIn: 3, tokensOut: 2 };
      },
    };
    const arena = createArena(provider);
    startGame(arena, { moveDelayMs: 0, maxAttempts: 2 });

    const finished = await waitFor(arena, (current) => current.phase === 'finished');
    expect(finished.error).toBeNull();
    expect(finished.result).toMatchObject({ winner: 'black', reason: 'forfeit' });
    expect(finished.result?.text).toContain('连续 2 次未给出可解析的着法');
    expect(finished.models.red?.lastError).toContain('连续 2 次');
  });

  it('does not retry auth errors and exposes a safe message', async () => {
    let calls = 0;
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        calls += 1;
        throw new ProviderError('鉴权失败，请检查 API Key（leak sk-should-not-appear）', {
          status: 401,
          retryable: false,
        });
      },
    };
    const arena = createArena(provider);
    startGame(arena);

    const errored = await waitFor(arena, (current) => current.phase === 'error');
    expect(calls).toBe(1);
    expect(errored.error?.side).toBe('red');
    expect(JSON.stringify(errored)).not.toContain('sk-should-not-appear');
    expect(errored.error?.message).toContain('鉴权失败');
  });

  it('hints to disable API reasoning when the provider rejects it with 400', async () => {
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        throw new ProviderError('unsupported parameter: reasoning_effort', {
          status: 400,
          retryable: false,
        });
      },
    };
    const arena = createArena(provider);
    arena.start({
      red: setup('red-model', 'red-secret', 'deep', true),
      black: setup('black-model', 'black-secret'),
      settings: { moveDelayMs: 0, maxAttempts: 3 },
    });

    const errored = await waitFor(arena, (current) => current.phase === 'error');
    expect(errored.models.red?.apiReasoning).toBe(true);
    expect(errored.error?.message).toContain('API 推理参数');
    expect(errored.error?.message).toContain('关闭该开关');
  });

  it('pauses an in-flight request, ignores its late result, and resumes cleanly', async () => {
    let mode: 'hang' | 'respond' = 'hang';
    let started = false;
    const provider: ModelProvider = {
      provider: 'openai',
      async complete(_modelSetup, request, signal) {
        started = true;
        if (mode === 'hang') {
          return new Promise<ProviderReply>((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              reject(new DOMException('aborted', 'AbortError'));
            });
          });
        }
        return reply(firstLegalFromPrompt(request));
      },
    };
    const arena = createArena(provider);
    startGame(arena);

    await waitFor(arena, (current) => current.models.red?.thinking === true);
    expect(started).toBe(true);
    const paused = arena.pause();
    expect(paused.phase).toBe('paused');
    expect(paused.models.red?.thinking).toBe(false);
    expect(paused.moves).toHaveLength(0);

    await tick(30);
    expect(arena.getState().moves).toHaveLength(0);

    mode = 'respond';
    const resumed = arena.resume();
    expect(resumed.phase).toBe('running');
    const state = await waitFor(arena, (current) => current.moves.length >= 1);
    expect(state.moves[0]?.side).toBe('red');
  });

  it('resets the match and drops all in-memory model data', async () => {
    const provider = new ScriptedProvider({ red: ['h2e2'], black: ['h9g7'] });
    const arena = createArena(provider);
    startGame(arena);
    await waitFor(arena, (current) => current.moves.length >= 1);

    const reset = arena.reset();
    expect(reset.phase).toBe('idle');
    expect(reset.matchId).toBeNull();
    expect(reset.moves).toHaveLength(0);
    expect(reset.models).toEqual({ red: null, black: null });
    expect(reset.board.slice(0, 9).map((piece) => piece?.type)).toEqual([
      'rook',
      'horse',
      'elephant',
      'advisor',
      'king',
      'advisor',
      'elephant',
      'horse',
      'rook',
    ]);
    expect(JSON.stringify(reset)).not.toContain('secret');
  });

  it('automatically ends on checkmate and never asks the losing side to move', async () => {
    const mateInOne = 'R1P1kb3/4b4/9/9/9/9/9/9/3R5/3K5 w - - 0 1';
    const provider = new ScriptedProvider({ red: ['d1d9'] });
    const arena = new Arena({
      providerFactory: () => provider,
      createInitialGame: () => XiangqiGame.fromFen(mateInOne),
    });
    activeArenas.push(arena);
    arena.start({
      red: setup('red-model', 'red-secret-value'),
      black: setup('black-model', 'black-secret-value'),
      settings: { moveDelayMs: 0, maxAttempts: 3 },
    });

    const finished = await waitFor(arena, (current) => current.phase === 'finished');
    expect(finished.result).toEqual({
      winner: 'red',
      reason: 'checkmate',
      text: '红方将死黑方',
    });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls.every((call) => call.model === 'red-model')).toBe(true);
    expect(arena.getState().models.red?.thinking).toBe(false);
    expect(arena.getState().models.black?.thinking).toBe(false);

    const revisionAtFinish = finished.revision;
    await tick(80);
    expect(provider.calls).toHaveLength(1);
    expect(arena.getState().phase).toBe('finished');
    expect(arena.getState().revision).toBe(revisionAtFinish);
  });

  it('automatically draws and stops requesting models on threefold repetition', async () => {
    const provider = new ScriptedProvider({
      red: ['b0c2', 'c2b0', 'b0c2', 'c2b0'],
      black: ['b9c7', 'c7b9', 'b9c7', 'c7b9'],
    });
    const arena = createArena(provider);
    startGame(arena, { moveDelayMs: 0, maxAttempts: 3 });

    const finished = await waitFor(arena, (current) => current.phase === 'finished');
    expect(finished.result).toEqual({
      winner: null,
      reason: 'repetition',
      text: '三次重复局面，判和',
    });
    expect(finished.ply).toBe(8);
    expect(provider.calls).toHaveLength(8);
    expect(finished.models.red?.thinking).toBe(false);
    expect(finished.models.black?.thinking).toBe(false);

    const revisionAtFinish = finished.revision;
    await tick(80);
    expect(provider.calls).toHaveLength(8);
    expect(arena.getState().phase).toBe('finished');
    expect(arena.getState().revision).toBe(revisionAtFinish);
  });

  it('finishes a game with a result, drops secrets, and allows a rematch', async () => {
    const provider = new ScriptedProvider({});
    const arena = createArena(provider);
    startGame(arena, { moveDelayMs: 0, maxAttempts: 3 });

    const finished = await waitFor(arena, (current) => current.phase === 'finished', 15_000);
    expect(finished.result).not.toBeNull();
    expect(finished.result?.text.length).toBeGreaterThan(0);
    expect(finished.models.red).not.toBeNull();
    expect(JSON.stringify(finished)).not.toContain('secret-value');
    expect(finished.moves.length).toBeGreaterThan(0);

    const rematch = arena.start({
      red: setup('red-model', 'new-red-secret'),
      black: setup('black-model', 'new-black-secret'),
      settings: { moveDelayMs: 0, maxAttempts: 3 },
    });
    expect(rematch.phase).toBe('running');
    expect(rematch.ply).toBe(0);
    arena.pause();
  });

  it('rejects invalid transitions', () => {
    const arena = createArena(new ScriptedProvider({}));
    expect(() => arena.pause()).toThrow(/不在进行中/);
    expect(() => arena.resume()).toThrow(/暂停/);
    expect(() => arena.retry()).toThrow(/出错/);
    startGame(arena);
    expect(() => arena.start({
      red: setup('another-red'),
      black: setup('another-black'),
      settings: { moveDelayMs: 0, maxAttempts: 3 },
    })).toThrow(/尚未结束/);
  });
});
