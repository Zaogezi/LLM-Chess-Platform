import { afterEach, describe, expect, it } from 'vitest';
import type {
  TournamentModelInput,
  TournamentState,
} from '../../shared/protocol';
import { XiangqiGame } from '../xiangqi/index';
import { ProviderError, type ModelProvider } from '../providers/index';
import { Tournament } from './tournament';
import { validateTournamentStartRequest } from './validate';

const activeTournaments: Tournament[] = [];

const MATE_RED_TO_MOVE = '3k5/9/9/9/9/9/9/9/3r5/3rKa3 w - - 0 1';
const KINGS_ONLY = '4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1';

afterEach(() => {
  while (activeTournaments.length) activeTournaments.pop()?.dispose();
});

function entrant(name: string): TournamentModelInput {
  return {
    name,
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    model: `${name.toLowerCase()}-model`,
    apiKey: `secret-${name}`,
    thinkingLevel: 'quick',
    apiReasoning: false,
  };
}

function startInput(names: string[], gamesPerPair: number) {
  return validateTournamentStartRequest({
    models: names.map(entrant),
    gamesPerPair,
  });
}

function createTournament(options: ConstructorParameters<typeof Tournament>[0]): Tournament {
  const tournament = new Tournament(options);
  activeTournaments.push(tournament);
  return tournament;
}

function waitFor(
  tournament: Tournament,
  predicate: (state: TournamentState) => boolean,
  timeoutMs = 4000,
): Promise<TournamentState> {
  const current = tournament.getState();
  if (predicate(current)) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(new Error(`timed out waiting for tournament; phase=${tournament.getState().phase}`));
    }, timeoutMs);

    const unsubscribe = tournament.onState((state) => {
      if (settled || !predicate(state)) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    });
  });
}

function waitForEnd(tournament: Tournament): Promise<TournamentState> {
  return waitFor(
    tournament,
    (state) =>
      state.phase === 'finished' || state.phase === 'stopped' || state.phase === 'error',
  );
}

describe('Tournament', () => {
  it('runs a round robin where the initial position is already checkmate', async () => {
    let providerCalls = 0;
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        providerCalls += 1;
        throw new Error('the terminal position must not call a model');
      },
    };
    const tournament = createTournament({
      providerFactory: () => provider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_TO_MOVE),
    });
    const done = waitForEnd(tournament);
    tournament.start(startInput(['Alpha', 'Beta'], 1));
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(providerCalls).toBe(0);
    expect(state.games).toHaveLength(1);
    expect(state.games[0]).toMatchObject({
      redName: 'Alpha',
      blackName: 'Beta',
      status: 'finished',
      winnerModelId: 'm2',
    });
    expect(state.games[0]?.result).toMatchObject({ winner: 'black', reason: 'checkmate' });
    expect(state.completedGames).toBe(1);
    expect(state.standings[0]).toMatchObject({ name: 'Beta', wins: 1, points: 3, rank: 1 });
    expect(state.standings[1]).toMatchObject({ name: 'Alpha', losses: 1, points: 0, rank: 2 });
    expect(JSON.stringify(state)).not.toContain('secret-');
  });

  it('exposes prompt level, token caps and requireReason in the model views', () => {
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        throw new Error('terminal positions must not call a model');
      },
    };
    const tournament = createTournament({
      providerFactory: () => provider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_TO_MOVE),
    });
    const input = validateTournamentStartRequest({
      models: [
        {
          ...entrant('Alpha'),
          promptLevel: 'deep',
          maxThinkingTokens: 4096,
          maxCompletionTokens: 8192,
          requireReason: false,
        },
        entrant('Beta'),
      ],
      gamesPerPair: 1,
    });

    const state = tournament.start(input);

    expect(state.models[0]).toMatchObject({
      name: 'Alpha',
      promptLevel: 'deep',
      maxThinkingTokens: 4096,
      maxCompletionTokens: 8192,
      requireReason: false,
    });
    expect(state.models[1]).toMatchObject({
      promptLevel: null,
      maxThinkingTokens: null,
      maxCompletionTokens: null,
      requireReason: true,
    });
  });

  it('counts a request timeout as a normal loss instead of a failed game', async () => {
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        throw new ProviderError('模型请求超时（60 秒）', {
          timeout: true,
          timeoutSeconds: 60,
        });
      },
    };
    const tournament = createTournament({ providerFactory: () => provider });
    const done = waitForEnd(tournament);
    tournament.start(startInput(['Alpha', 'Beta'], 1));
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(state.games).toHaveLength(1);
    expect(state.games[0]).toMatchObject({ status: 'finished', failedSide: null, error: null });
    expect(state.games[0]?.result).toMatchObject({ winner: 'black', reason: 'timeout' });
    expect(state.games[0]?.result?.text).toContain('红方模型请求超时');
    expect(state.standings[0]).toMatchObject({ name: 'Beta', wins: 1, points: 3 });
    expect(state.standings[1]).toMatchObject({ name: 'Alpha', losses: 1, points: 0 });
  });

  it('alternates colours and balances odd games across pairings', async () => {
    const tournament = createTournament({
      providerFactory: () => ({
        provider: 'openai',
        async complete() {
          throw new Error('should not call');
        },
      }),
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_TO_MOVE),
    });
    const done = waitForEnd(tournament);
    tournament.start(startInput(['Alpha', 'Beta'], 2));
    const state = await done;

    expect(state.games[0]).toMatchObject({ redName: 'Alpha', blackName: 'Beta' });
    expect(state.games[1]).toMatchObject({ redName: 'Beta', blackName: 'Alpha' });
    expect(state.games.every((game) => game.status === 'finished')).toBe(true);
    expect(state.completedGames).toBe(2);
    expect(state.standings.map((row) => [row.name, row.wins, row.losses, row.points])).toEqual([
      ['Alpha', 1, 1, 3],
      ['Beta', 1, 1, 3],
    ]);
  });

  it('distributes the extra red game for odd counts across pairings', async () => {
    const tournament = createTournament({
      providerFactory: () => ({
        provider: 'openai',
        async complete() {
          throw new Error('should not call');
        },
      }),
      createInitialGame: () => XiangqiGame.fromFen(KINGS_ONLY),
    });
    const done = waitForEnd(tournament);
    tournament.start(startInput(['Alpha', 'Beta', 'Gamma'], 1));
    const state = await done;

    expect(state.totalGames).toBe(3);
    expect(state.games.map((game) => [game.redName, game.blackName])).toEqual([
      ['Alpha', 'Beta'],
      ['Gamma', 'Alpha'],
      ['Beta', 'Gamma'],
    ]);
    expect(state.standings.map((row) => [row.name, row.redGames, row.blackGames])).toEqual([
      ['Alpha', 1, 1],
      ['Beta', 1, 1],
      ['Gamma', 1, 1],
    ]);
  });

  it('records static dead positions as draws for both sides', async () => {
    const tournament = createTournament({
      providerFactory: () => ({
        provider: 'openai',
        async complete() {
          throw new Error('should not call');
        },
      }),
      createInitialGame: () => XiangqiGame.fromFen(KINGS_ONLY),
    });
    const done = waitForEnd(tournament);
    tournament.start(startInput(['Alpha', 'Beta'], 2));
    const state = await done;

    expect(state.games.map((game) => game.result?.winner)).toEqual([null, null]);
    expect(state.games.map((game) => game.result?.reason)).toEqual([
      'dead-position',
      'dead-position',
    ]);
    expect(state.standings).toMatchObject([
      { name: 'Alpha', draws: 2, points: 2, rank: 1 },
      { name: 'Beta', draws: 2, points: 2, rank: 2 },
    ]);
  });

  it('continues the schedule after a game fails, counting failures separately', async () => {
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        throw new Error('upstream unavailable');
      },
    };
    const tournament = createTournament({
      providerFactory: () => provider,
      createInitialGame: () => XiangqiGame.initial(),
      gameSettings: { moveDelayMs: 0, maxAttempts: 1 },
    });
    const done = waitForEnd(tournament);
    tournament.start(startInput(['Alpha', 'Beta'], 2));
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(state.games.map((game) => game.status)).toEqual(['failed', 'failed']);
    expect(state.completedGames).toBe(0);
    expect(state.standings.map((row) => [row.wins, row.draws, row.losses, row.failed, row.points])).toEqual([
      [0, 0, 0, 1, 0],
      [0, 0, 0, 1, 0],
    ]);
  });

  it('stops an in-flight game and cancels the remaining schedule', async () => {
    const provider: ModelProvider = {
      provider: 'openai',
      complete(_setup, _request, signal) {
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => resolve({
            text: '{"move":"h2e2","reason":"late"}',
            tokensIn: 1,
            tokensOut: 1,
          }), 10_000);
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
    const tournament = createTournament({
      providerFactory: () => provider,
      createInitialGame: () => XiangqiGame.initial(),
      gameSettings: { moveDelayMs: 0, maxAttempts: 1 },
    });

    tournament.start(startInput(['Alpha', 'Beta'], 3));
    await waitFor(tournament, (state) => state.games[0]?.status === 'running');
    const stopped = await tournament.stop();

    expect(stopped.phase).toBe('stopped');
    expect(stopped.games[0]).toMatchObject({ status: 'canceled', error: '评测提前终止' });
    expect(stopped.games.slice(1).every((game) => game.status === 'canceled')).toBe(true);
    expect(stopped.processedGames).toBe(3);
    expect(stopped.completedGames).toBe(0);
  });

  it('rejects a second start while running and stop when idle', async () => {
    const tournament = createTournament({
      createInitialGame: () => XiangqiGame.fromFen(KINGS_ONLY),
    });
    tournament.start(startInput(['Alpha', 'Beta'], 1));
    expect(() => tournament.start(startInput(['Alpha', 'Beta'], 1))).toThrow(
      /正在进行/,
    );

    const done = waitForEnd(tournament);
    await done;
    await expect(tournament.stop()).rejects.toThrow(/没有正在运行/);
  });
});
