import { afterEach, describe, expect, it } from 'vitest';
import type { ArenaState, ChampionshipState, TournamentState } from '../../shared/protocol';
import { CHAMPIONSHIP_GROUPS } from '../../shared/protocol';
import { Arena } from '../arena/arena';
import { Championship } from '../championship/championship';
import { validateChampionshipStartRequest } from '../championship/validate';
import type { CompletionRequest, ModelProvider } from '../providers/index';
import { Tournament } from '../tournament/tournament';
import { validateTournamentStartRequest } from '../tournament/validate';
import { XiangqiGame } from '../xiangqi/index';
import { HistoryStore } from './history';

const MATE_BLACK_TO_MOVE = '3Rka3/3R5/9/9/9/9/9/9/9/3K5 b - - 0 1';

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

const unusedProvider: ModelProvider = {
  provider: 'openai',
  async complete() {
    throw new Error('terminal positions must not call a provider');
  },
};

function waitForArena(
  arena: Arena,
  predicate: (state: ArenaState) => boolean,
  timeoutMs = 3000,
): Promise<ArenaState> {
  if (predicate(arena.getState())) return Promise.resolve(arena.getState());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('arena timeout')), timeoutMs);
    const unsubscribe = arena.onState((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    });
  });
}

function waitForTournament(
  tournament: Tournament,
  predicate: (state: TournamentState) => boolean,
  timeoutMs = 3000,
): Promise<TournamentState> {
  if (predicate(tournament.getState())) return Promise.resolve(tournament.getState());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tournament timeout')), timeoutMs);
    const unsubscribe = tournament.onState((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    });
  });
}

function waitForChampionship(
  championship: Championship,
  predicate: (state: ChampionshipState) => boolean,
  timeoutMs = 10_000,
): Promise<ChampionshipState> {
  if (predicate(championship.getState())) return Promise.resolve(championship.getState());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('championship timeout')), timeoutMs);
    const unsubscribe = championship.onState((state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    });
  });
}

function setup(model: string) {
  return {
    provider: 'openai' as const,
    baseUrl: 'https://example.test/v1',
    model,
    apiKey: `key-${model}`,
    thinkingLevel: 'quick' as const,
    apiReasoning: false,
  };
}

function entrant(name: string) {
  return {
    name,
    provider: 'openai' as const,
    baseUrl: 'https://example.test/v1',
    model: `${name.toLowerCase()}-model`,
    apiKey: '',
    thinkingLevel: 'quick' as const,
    apiReasoning: false,
  };
}

describe('history recording integration', () => {
  it('records a finished spectator game through the Arena callback', async () => {
    const history = new HistoryStore({ filePath: null });
    const arena = new Arena({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_BLACK_TO_MOVE),
      onGameComplete: (completion) => {
        history.recordArenaGame(completion);
      },
    });
    cleanup.push(() => arena.dispose());
    const done = waitForArena(arena, (state) => state.phase === 'finished');
    arena.start({
      red: setup('red-model'),
      black: setup('black-model'),
      settings: { moveDelayMs: 0, maxAttempts: 1 },
    });
    await done;

    expect(history.size).toBe(1);
    const [record] = history.list({ limit: 10, offset: 0, mode: null, status: null, q: '' }).records;
    expect(record).toMatchObject({
      mode: 'arena',
      status: 'finished',
      winnerSide: 'red',
      red: { name: 'red-model' },
      black: { name: 'black-model' },
    });
  });

  it('records every finished tournament game with its tournament context', async () => {
    const history = new HistoryStore({ filePath: null });
    const tournament = new Tournament({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_BLACK_TO_MOVE),
      onGameComplete: (completion) => {
        history.recordTournamentGame(completion);
      },
    });
    cleanup.push(() => tournament.dispose());
    const done = waitForTournament(tournament, (state) => state.phase === 'finished');
    tournament.start(
      validateTournamentStartRequest({
        models: [entrant('Alpha'), entrant('Beta')],
        gamesPerPair: 2,
      }),
    );
    const final = await done;

    expect(history.size).toBe(2);
    const records = history.list({ limit: 10, offset: 0, mode: 'tournament', status: null, q: '' });
    expect(records.total).toBe(2);
    expect(records.records.every((record) => record.tournament?.tournamentId === final.tournamentId)).toBe(
      true,
    );
    expect(records.records.map((record) => record.red.name).sort()).toEqual(['Alpha', 'Beta']);
  });

  it('records every finished championship game with its bracket context', async () => {
    const history = new HistoryStore({ filePath: null });
    const championship = new Championship({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_BLACK_TO_MOVE),
      onGameComplete: (completion) => {
        history.recordChampionshipGame(completion);
      },
    });
    cleanup.push(() => championship.dispose());

    const names = CHAMPIONSHIP_GROUPS.flatMap((groupId) =>
      [1, 2, 3, 4].map((pool) => `${groupId}${pool}`),
    );
    const input = validateChampionshipStartRequest({
      entrants: names.map((name) => ({
        name,
        seedPool: Number(name.slice(1)),
        provider: 'openai',
        baseUrl: 'https://example.test/v1',
        model: `${name.toLowerCase()}-model`,
        apiKey: `secret-${name}`,
        thinkingLevel: 'quick',
        apiReasoning: false,
      })),
      groups: CHAMPIONSHIP_GROUPS.map((groupId) => ({
        id: groupId,
        entrantNames: [1, 2, 3, 4].map((pool) => `${groupId}${pool}`),
      })),
    });

    const done = waitForChampionship(
      championship,
      (state) => state.phase === 'finished' || state.phase === 'error',
    );
    championship.start(input);
    const final = await done;

    expect(final.phase).toBe('finished');
    expect(final.championName).toBeTruthy();
    expect(history.size).toBeGreaterThanOrEqual(24);
    const records = history.list({
      limit: 200,
      offset: 0,
      mode: 'championship',
      status: null,
      q: '',
    });
    expect(records.total).toBe(history.size);
    expect(
      records.records.every(
        (record) => record.championship?.championshipId === final.championshipId,
      ),
    ).toBe(true);
    expect(
      records.records.filter((record) => record.championship?.stage === 'group'),
    ).toHaveLength(24);
    expect(
      records.records.some((record) => record.championship?.stage === 'quarterfinal'),
    ).toBe(true);
    expect(JSON.stringify(records)).not.toContain('secret-');
  });

  it('does not record canceled tournament games', async () => {
    const history = new HistoryStore({ filePath: null });
    let calls = 0;
    const provider: ModelProvider = {
      provider: 'openai',
      complete(_setup: unknown, _request: CompletionRequest, signal: AbortSignal) {
        calls += 1;
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
        });
      },
    };
    const tournament = new Tournament({
      providerFactory: () => provider,
      onGameComplete: (completion) => {
        history.recordTournamentGame(completion);
      },
    });
    cleanup.push(() => tournament.dispose());
    tournament.start(
      validateTournamentStartRequest({
        models: [entrant('Alpha'), entrant('Beta')],
        gamesPerPair: 2,
      }),
    );
    await waitForTournament(
      tournament,
      (state) => state.games[0]?.status === 'running',
    );
    const stopped = await tournament.stop();
    expect(stopped.phase).toBe('stopped');
    expect(calls).toBe(1);
    expect(history.size).toBe(0);
  });
});
