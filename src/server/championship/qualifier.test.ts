import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChampionshipGameView,
  QualifierGroupId,
  QualifierState,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_QUALIFIER_ADVANCE_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_QUALIFIER_GAMES_PER_ENTRANT,
  CHAMPIONSHIP_QUALIFIER_GROUPS,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
} from '../../shared/protocol';
import type { ModelProvider } from '../providers/index';
import { ProviderError } from '../providers/index';
import { XiangqiGame } from '../xiangqi/index';
import { HistoryStore } from '../history/history';
import type { QualifierGameCompletion, QualifierOptions } from './qualifier';
import { Qualifier, QualifierConflictError } from './qualifier';
import {
  QualifierCheckpointStore,
  parseQualifierCheckpoint,
} from './qualifierCheckpoint';
import {
  buildQualifierGames,
  qualifierRoundOf,
  QUALIFIER_ROUND_COUNT,
} from './qualifierSchedule';
import type { ValidatedQualifierStart } from './qualifierValidate';
import { validateQualifierStartRequest } from './qualifierValidate';

/** Red is checkmated at once, so black wins without any model call. */
const MATE_BLACK_WINS = '3k5/9/9/9/9/9/9/9/3r5/3rKa3 w - - 0 1';
/** Black is checkmated at once, so red wins without any model call. */
const MATE_RED_WINS = '3Rk4/3R5/9/9/9/9/9/9/9/4K4 b - - 0 1';
/** Kings only: static dead position, adjudicated as a draw. */
const DEAD_DRAW = '4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1';

const GROUP_NAMES: Record<QualifierGroupId, readonly string[]> = {
  A: ['A1', 'A2', 'A3', 'A4', 'A5'],
  B: ['B1', 'B2', 'B3', 'B4', 'B5'],
};
/** Entrants m1…m10 in request order; A seats are m1~m5 and B seats m6~m10. */
const ENTRANT_NAMES = CHAMPIONSHIP_QUALIFIER_GROUPS.flatMap(
  (groupId) => GROUP_NAMES[groupId],
);
const ENTRANT_IDS = ENTRANT_NAMES.map((_, index) => `m${index + 1}`);

const activeQualifiers: Qualifier[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (activeQualifiers.length) activeQualifiers.pop()?.dispose();
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function createQualifier(options: QualifierOptions = {}): Qualifier {
  const qualifier = new Qualifier(options);
  activeQualifiers.push(qualifier);
  return qualifier;
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'xiangqi-qualifier-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createCheckpointFile(): string {
  return path.join(createTemporaryDirectory(), 'qualifier.json');
}

function startInput(concurrency?: number): ValidatedQualifierStart {
  const body: Record<string, unknown> = {
    entrants: ENTRANT_NAMES.map((name) => ({
      name,
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      model: `${name.toLocaleLowerCase()}-model`,
      apiKey: `secret-${name}`,
      thinkingLevel: 'quick',
      apiReasoning: false,
    })),
    groups: CHAMPIONSHIP_QUALIFIER_GROUPS.map((groupId) => ({
      id: groupId,
      entrantNames: [...GROUP_NAMES[groupId]],
    })),
  };
  if (concurrency !== undefined) body.concurrency = concurrency;
  return validateQualifierStartRequest(body);
}

/** Never resolves until the game is aborted, to keep a game in flight. */
function hangingProvider(): ModelProvider {
  return {
    provider: 'openai',
    complete(_setup, _request, signal) {
      return new Promise((_resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('hanging provider was never aborted'));
        }, 10_000);
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
}

const unusedProvider: ModelProvider = {
  provider: 'openai',
  async complete() {
    throw new Error('terminal positions must not call a model');
  },
};

type ScriptedOutcome = 'red' | 'black' | 'draw' | 'fail';

/**
 * Deterministic position factory driven by the 1-based game call number. With
 * the default serial concurrency the qualifying schedule is played in waves of
 * four: round N is `[{A pair 2N-1}, {A pair 2N}, {B pair 2N-1}, {B pair 2N}]`.
 */
function scriptedFactory(
  script: Record<number, ScriptedOutcome>,
  fallback: ScriptedOutcome,
): () => XiangqiGame {
  let calls = 0;
  return () => {
    calls += 1;
    const outcome = script[calls] ?? fallback;
    if (outcome === 'fail') return XiangqiGame.initial();
    const fen =
      outcome === 'red'
        ? MATE_RED_WINS
        : outcome === 'black'
          ? MATE_BLACK_WINS
          : DEAD_DRAW;
    return XiangqiGame.fromFen(fen);
  };
}

function waitFor(
  qualifier: Qualifier,
  predicate: (state: QualifierState) => boolean,
  timeoutMs = 10_000,
): Promise<QualifierState> {
  const current = qualifier.getState();
  if (predicate(current)) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(
        new Error(
          `timed out waiting for qualifier; phase=${qualifier.getState().phase} completed=${
            qualifier.getState().completedGames
          } current=${qualifier.getState().currentGameIds.join(',')}`,
        ),
      );
    }, timeoutMs);

    const unsubscribe = qualifier.onState((state) => {
      if (settled || !predicate(state)) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    });
  });
}

function waitForEnd(qualifier: Qualifier): Promise<QualifierState> {
  return waitFor(
    qualifier,
    (state) =>
      state.phase === 'finished' || state.phase === 'stopped' || state.phase === 'error',
  );
}

function countByStatus(state: QualifierState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const game of state.games) {
    counts[game.status] = (counts[game.status] ?? 0) + 1;
  }
  return counts;
}

function gamesByRound(games: readonly ChampionshipGameView[], round: number): ChampionshipGameView[] {
  return games.filter((game) => qualifierRoundOf(game) === round);
}

function schedule(): ChampionshipGameView[] {
  return buildQualifierGames(
    CHAMPIONSHIP_QUALIFIER_GROUPS.map((groupId) => ({
      id: groupId,
      members: GROUP_NAMES[groupId].map((name) => ({
        id: ENTRANT_IDS[ENTRANT_NAMES.indexOf(name)]!,
        name,
      })),
    })),
  );
}

describe('qualifier schedule', () => {
  it('schedules 20 games: ten per group, pairIndex 1–10, everyone 4 games with 2 reds', () => {
    const games = schedule();

    expect(games).toHaveLength(CHAMPIONSHIP_QUALIFIER_GROUP_GAMES);
    expect(games.map((game) => game.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `g${index + 1}`),
    );
    expect(games.every((game) => game.stage === 'qualifier')).toBe(true);
    expect(games.every((game) => game.seriesId === null)).toBe(true);
    expect(games.every((game) => game.gameIndex === 1)).toBe(true);
    // Groups are appended in canonical order.
    expect(games.slice(0, 10).every((game) => game.groupId === 'A')).toBe(true);
    expect(games.slice(10).every((game) => game.groupId === 'B')).toBe(true);

    for (const groupId of CHAMPIONSHIP_QUALIFIER_GROUPS) {
      const groupGames = games.filter((game) => game.groupId === groupId);
      expect(groupGames).toHaveLength(CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP);
      expect(groupGames.map((game) => game.pairIndex).sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
      ]);

      // Single round-robin: all ten unordered pairings appear exactly once.
      const pairs = groupGames.map((game) =>
        [game.redModelId, game.blackModelId].sort().join('-'),
      );
      expect(new Set(pairs).size).toBe(10);
      const members = GROUP_NAMES[groupId].map(
        (name) => ENTRANT_IDS[ENTRANT_NAMES.indexOf(name)]!,
      );
      for (const memberId of members) {
        const own = groupGames.filter(
          (game) => game.redModelId === memberId || game.blackModelId === memberId,
        );
        expect(own).toHaveLength(CHAMPIONSHIP_QUALIFIER_GAMES_PER_ENTRANT);
        expect(own.filter((game) => game.redModelId === memberId)).toHaveLength(2);
        expect(own.filter((game) => game.blackModelId === memberId)).toHaveLength(2);
      }
    }
    expect(games.flatMap((game) => [game.redModelId, game.blackModelId])).toHaveLength(40);
  });

  it('plays five waves of four games (two per group) that share no entrant', () => {
    const games = schedule();

    expect(QUALIFIER_ROUND_COUNT).toBe(5);
    const roundOfPair = new Map<number, number>();
    for (const game of games) {
      roundOfPair.set(game.pairIndex, qualifierRoundOf(game));
    }
    expect(roundOfPair.get(1)).toBe(1);
    expect(roundOfPair.get(2)).toBe(1);
    expect(roundOfPair.get(3)).toBe(2);
    expect(roundOfPair.get(10)).toBe(5);

    const allPlayers = new Set<string>();
    for (let round = 1; round <= QUALIFIER_ROUND_COUNT; round += 1) {
      const wave = gamesByRound(games, round);
      expect(wave).toHaveLength(4);
      for (const groupId of CHAMPIONSHIP_QUALIFIER_GROUPS) {
        expect(wave.filter((game) => game.groupId === groupId)).toHaveLength(2);
      }
      const players = wave.flatMap((game) => [game.redModelId, game.blackModelId]);
      expect(new Set(players).size).toBe(8);
      players.forEach((player) => allPlayers.add(player));
    }
    // Every entrant sits out exactly one of the five waves.
    expect(allPlayers.size).toBe(CHAMPIONSHIP_QUALIFIER_ENTRANTS);
  });

  it('rejects a group that does not have exactly five seats', () => {
    expect(() =>
      buildQualifierGames([
        {
          id: 'A',
          members: ENTRANT_IDS.slice(0, 4).map((id, index) => ({ id, name: `A${index + 1}` })),
        },
      ]),
    ).toThrow(/必须恰好有 5 位选手/);
  });
});

describe('Qualifier lifecycle', () => {
  it('starts idle with the public qualifier counters and no configuration', () => {
    const qualifier = createQualifier();
    const state = qualifier.getState();

    expect(state).toMatchObject({
      phase: 'idle',
      qualifierId: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      currentGameIds: [],
      concurrency: 1,
      resumable: false,
      checkpointSavedAt: null,
      groupGamesTotal: CHAMPIONSHIP_QUALIFIER_GROUP_GAMES,
      groupGamesProcessed: 0,
      processedGames: 0,
      completedGames: 0,
      qualifiedModelIds: [],
    });
    expect(state.entrants).toEqual([]);
    expect(state.groups).toEqual([]);
    expect(state.games).toEqual([]);
  });

  it('exposes prompt level and token caps in the entrant views', () => {
    const input = startInput();
    input.entrants[0] = {
      ...input.entrants[0]!,
      setup: {
        ...input.entrants[0]!.setup,
        promptLevel: 'deep',
        maxThinkingTokens: 4096,
        maxCompletionTokens: 8192,
      },
    };
    const qualifier = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_BLACK_WINS),
    });

    const state = qualifier.start(input);

    expect(state.entrants[0]).toMatchObject({
      name: 'A1',
      promptLevel: 'deep',
      maxThinkingTokens: 4096,
      maxCompletionTokens: 8192,
    });
    expect(state.entrants[1]).toMatchObject({
      promptLevel: null,
      maxThinkingTokens: null,
      maxCompletionTokens: null,
    });
  });

  it('runs all 20 terminal games and promotes A1, B1, A2, B2', async () => {
    let providerCalls = 0;
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        providerCalls += 1;
        throw new Error('terminal positions must not call a model');
      },
    };
    const completions: QualifierGameCompletion[] = [];
    const checkpointStore = new QualifierCheckpointStore({ filePath: null });
    const qualifier = createQualifier({
      providerFactory: () => provider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      checkpointStore,
      onGameComplete: (completion) => completions.push(completion),
    });

    const done = waitForEnd(qualifier);
    const started = qualifier.start(startInput());
    expect(started.phase).toBe('running');
    expect(started.concurrency).toBe(1);
    // Serial mode runs the first scheduled game only.
    expect(started.currentGameIds).toEqual(['g1']);
    expect(started.games).toHaveLength(20);
    expect(started.groups.map((group) => group.entrantIds.length)).toEqual([5, 5]);

    const state = await done;

    expect(state.phase).toBe('finished');
    expect(state.error).toBeNull();
    expect(state.qualifierId).not.toBeNull();
    expect(state.startedAt).not.toBeNull();
    expect(state.finishedAt).not.toBeNull();
    expect(state.resumable).toBe(false);
    expect(state.checkpointSavedAt).not.toBeNull();
    expect(state.currentGameIds).toEqual([]);
    expect(providerCalls).toBe(0);

    expect(state.groupGamesTotal).toBe(CHAMPIONSHIP_QUALIFIER_GROUP_GAMES);
    expect(state.groupGamesProcessed).toBe(20);
    expect(state.processedGames).toBe(20);
    expect(state.completedGames).toBe(20);
    expect(countByStatus(state)).toEqual({ finished: 20 });

    // The whole schedule is in the state, in id order.
    expect(state.games.map((game) => game.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `g${index + 1}`),
    );
    expect(
      state.games.every(
        (game) =>
          game.status === 'finished' &&
          game.stage === 'qualifier' &&
          game.seriesId === null &&
          game.winnerModelId === game.redModelId &&
          game.result?.winner === 'red' &&
          game.error === null,
      ),
    ).toBe(true);

    // Red wins every game: each entrant finishes 2W-2L, so the final tie-break
    // (seat order) decides both tables.
    expect(state.groups.map((group) => group.id)).toEqual(['A', 'B']);
    for (const group of state.groups) {
      expect(group.complete).toBe(true);
      expect(group.entrantIds).toHaveLength(CHAMPIONSHIP_QUALIFIER_GROUP_SIZE);
      expect(group.standings).toHaveLength(CHAMPIONSHIP_QUALIFIER_GROUP_SIZE);
      expect(group.standings.map((row) => row.played)).toEqual([4, 4, 4, 4, 4]);
      expect(group.standings.map((row) => row.points)).toEqual([6, 6, 6, 6, 6]);
      expect(group.standings.map((row) => row.wins)).toEqual([2, 2, 2, 2, 2]);
      expect(group.standings.map((row) => row.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(group.qualifiedModelIds).toEqual(
        group.standings
          .slice(0, CHAMPIONSHIP_QUALIFIER_ADVANCE_PER_GROUP)
          .map((row) => row.modelId),
      );
    }
    expect(state.groups[0]?.qualifiedModelIds).toEqual(['m1', 'm2']);
    expect(state.groups[1]?.qualifiedModelIds).toEqual(['m6', 'm7']);
    // Group winners first, then the runners-up: A1, B1, A2, B2.
    expect(state.qualifiedModelIds).toEqual(['m1', 'm6', 'm2', 'm7']);

    // Every game was reported exactly once, with the full completion payload.
    expect(completions).toHaveLength(20);
    expect(new Set(completions.map((completion) => completion.game.id)).size).toBe(20);
    for (const completion of completions) {
      expect(completion.qualifierId).toBe(state.qualifierId);
      expect(completion.game.status).toBe('finished');
      expect(completion.finalState.phase).toBe('finished');
      expect(completion.red.id).toBe(completion.game.redModelId);
      expect(completion.black.id).toBe(completion.game.blackModelId);
      expect(completion.red.groupId).toBe(completion.game.groupId);
      expect(completion.black.groupId).toBe(completion.game.groupId);
    }

    // The finished run keeps a key-redacted breakpoint so a restart can still
    // draw the main event without replaying the qualifying round.
    const savedFinished = checkpointStore.load();
    expect(savedFinished).toMatchObject({ phase: 'finished', qualifierId: state.qualifierId });
    expect(savedFinished?.games).toHaveLength(20);
    expect(JSON.stringify(savedFinished)).not.toContain('secret-');
    expect(JSON.stringify(state)).not.toContain('secret-');
    expect(JSON.stringify(state)).not.toContain('apiKey');
    expect(JSON.stringify(completions)).not.toContain('secret-');

    // The latest board stays available for the spectator page, older ones do not.
    const snapshot = qualifier.getGameSnapshot('g20');
    expect(snapshot).not.toBeNull();
    expect(snapshot?.live).toBe(false);
    expect(snapshot?.game.status).toBe('finished');
    expect(snapshot?.arena?.phase).toBe('finished');
    expect(qualifier.getGameSnapshot('nope')).toBeNull();
  });

  it('breaks a points tie by head-to-head points before seat order', async () => {
    // Call 1 g1, 2 g2, 3 g11, 4 g12, 5 g3, 6 g4, 7 g13, 8 g14, 9 g5, 10 g6,
    // 11 g15, 12 g16, 13 g7, 14 g8, 15 g17, 16 g18, 17 g9, 18 g10, 19 g19, 20 g20.
    // Group A: A3 beats A2 in their direct game (g4) and both end on 6 points;
    // without head-to-head, A2's earlier seat would rank it first (and promote it).
    const qualifier = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: scriptedFactory(
        {
          1: 'black', // g1: A2 beats A5
          2: 'black', // g2: A4 beats A3
          5: 'draw', // g3: A4–A1
          6: 'black', // g4: A3 beats A2
          9: 'black', // g5: A5 beats A3
          10: 'red', // g6: A1 beats A2
          13: 'red', // g7: A2 beats A4
          14: 'draw', // g8: A5–A1
          17: 'black', // g9: A3 beats A1
          18: 'draw', // g10: A4–A5
        },
        'red',
      ),
    });

    const done = waitForEnd(qualifier);
    qualifier.start(startInput());
    const state = await done;

    expect(state.phase).toBe('finished');
    // A3 and A2 both have 6 points; A3 won the direct game, so it ranks first.
    expect(state.groups[0]?.standings.map((row) => [row.name, row.points, row.wins])).toEqual([
      ['A3', 6, 2],
      ['A2', 6, 2],
      ['A1', 5, 1],
      ['A4', 5, 1],
      ['A5', 5, 1],
    ]);
    expect(state.groups[0]?.qualifiedModelIds).toEqual(['m3', 'm2']);
    // The remaining three tie on points and are separated down to seat order.
    expect(state.groups[0]?.standings.map((row) => row.modelId)).toEqual([
      'm3',
      'm2',
      'm1',
      'm4',
      'm5',
    ]);
    expect(state.qualifiedModelIds).toEqual(['m3', 'm6', 'm2', 'm7']);
  });

  it('records a failed game as a no-contest and still finishes the round', async () => {
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        throw new Error('upstream unavailable');
      },
    };
    const completions: QualifierGameCompletion[] = [];
    const qualifier = createQualifier({
      providerFactory: () => provider,
      // Only the first game fails; every other position is terminal.
      createInitialGame: scriptedFactory({ 1: 'fail' }, 'red'),
      onGameComplete: (completion) => completions.push(completion),
    });

    const done = waitForEnd(qualifier);
    qualifier.start(startInput());
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(state.error).toBeNull();
    expect(state.completedGames).toBe(19);
    expect(state.processedGames).toBe(20);
    expect(state.groupGamesProcessed).toBe(20);
    expect(countByStatus(state)).toEqual({ finished: 19, failed: 1 });

    const failed = state.games.find((game) => game.status === 'failed');
    expect(failed).toMatchObject({
      id: 'g1',
      groupId: 'A',
      status: 'failed',
      failedSide: 'red',
      winnerModelId: null,
      result: null,
    });
    expect(failed?.error).toContain('upstream unavailable');

    // A failed game still counts as decided: the group completes and promotes.
    expect(state.groups.every((group) => group.complete)).toBe(true);
    expect(state.groups[0]?.standings.find((row) => row.modelId === 'm5')?.failed).toBe(1);
    expect(state.qualifiedModelIds).toHaveLength(4);
    expect(completions).toHaveLength(20);
    expect(
      completions.filter((completion) => completion.game.status === 'failed'),
    ).toHaveLength(1);
    expect(completions[0]?.game.id).toBe('g1');
    expect(completions[0]?.game.failedSide).toBe('red');
    expect(JSON.stringify(state)).not.toContain('secret-');
  });

  it('keeps running when the history callback throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let completions = 0;
    const qualifier = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      onGameComplete: () => {
        completions += 1;
        if (completions === 1) throw new Error('history exploded');
      },
    });

    const done = waitForEnd(qualifier);
    qualifier.start(startInput());
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(state.completedGames).toBe(20);
    expect(completions).toBe(20);
    expect(consoleError).toHaveBeenCalled();
  });

  it('rejects concurrent starts, idle stop/resume, and restarts after finishing', async () => {
    const qualifier = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
    });

    await expect(qualifier.stop()).rejects.toThrow(QualifierConflictError);
    await expect(qualifier.stop()).rejects.toThrow(/没有正在运行/);
    expect(() => qualifier.resume()).toThrow(/没有可继续/);

    const firstDone = waitForEnd(qualifier);
    const first = qualifier.start(startInput());
    expect(first.phase).toBe('running');
    expect(() => qualifier.start(startInput())).toThrow(/正在进行/);

    const firstState = await firstDone;
    expect(firstState.phase).toBe('finished');
    const firstId = firstState.qualifierId;
    await expect(qualifier.stop()).rejects.toThrow(/没有正在运行/);

    const secondDone = waitFor(
      qualifier,
      (state) => state.phase === 'finished' && state.qualifierId !== firstId,
    );
    const second = qualifier.start(startInput());
    expect(second.phase).toBe('running');
    expect(second.qualifierId).not.toBe(firstId);
    expect(second.games).toHaveLength(20);
    expect(second.completedGames).toBe(0);
    expect(second.groups.every((group) => group.complete)).toBe(false);

    const secondState = await secondDone;
    expect(secondState.phase).toBe('finished');
    expect(secondState.qualifierId).not.toBe(firstId);
    expect(secondState.qualifiedModelIds).toEqual(['m1', 'm6', 'm2', 'm7']);
  });

  it('emits state updates and stops after unsubscribe/dispose', () => {
    const qualifier = createQualifier();
    let updates = 0;
    const unsubscribe = qualifier.onState(() => {
      updates += 1;
    });
    unsubscribe();

    qualifier.dispose();
    expect(updates).toBe(0);
    expect(() => qualifier.start(startInput())).toThrow(/服务正在关闭/);
    expect(() => qualifier.resume()).toThrow(/服务正在关闭/);
  });
});

describe('Qualifier concurrency', () => {
  it('starts only one game when no concurrency is requested', async () => {
    const qualifier = createQualifier({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => XiangqiGame.initial(),
    });

    const started = qualifier.start(startInput());
    expect(started.concurrency).toBe(1);
    expect(started.currentGameIds).toEqual(['g1']);
    const running = qualifier.getState().games.filter((game) => game.status === 'running');
    expect(running).toHaveLength(1);

    const snapshot = qualifier.getGameSnapshot('g1');
    expect(snapshot?.live).toBe(true);
    expect(snapshot?.game.status).toBe('running');
    expect(snapshot?.arena?.phase).toBe('running');
    expect(snapshot?.arena?.board).toHaveLength(90);
    expect(qualifier.getGameSnapshot('g2')?.live).toBe(false);

    const stopped = await qualifier.stop();
    expect(stopped.phase).toBe('stopped');
    expect(stopped.currentGameIds).toEqual([]);
    expect(countByStatus(stopped)).toEqual({ canceled: 20 });
    expect(stopped.games.every((game) => game.error === '入围赛提前终止')).toBe(true);
    expect(qualifier.getGameSnapshot('g1')).toMatchObject({ live: false, arena: null });
  });

  it.each([2, 3, 5, 8])(
    'runs up to four disjoint games at once for concurrency %i',
    async (concurrency) => {
      const qualifier = createQualifier({
        providerFactory: () => hangingProvider(),
        createInitialGame: () => XiangqiGame.initial(),
      });

      const started = qualifier.start(startInput(concurrency));
      const expected = Math.min(concurrency, 4);
      expect(started.concurrency).toBe(concurrency);
      expect(started.currentGameIds).toHaveLength(expected);
      // A wave is capped at four games even with a higher concurrency setting.
      expect(started.currentGameIds).toEqual(['g1', 'g2', 'g11', 'g12'].slice(0, expected));

      const active = started.games.filter((game) => started.currentGameIds.includes(game.id));
      expect(active).toHaveLength(expected);
      expect(new Set(active.map((game) => qualifierRoundOf(game)))).toEqual(new Set([1]));
      // Two games per group, every player in the wave appears exactly once.
      const players = active.flatMap((game) => [game.redModelId, game.blackModelId]);
      expect(new Set(players).size).toBe(players.length);
      for (const groupId of CHAMPIONSHIP_QUALIFIER_GROUPS) {
        expect(active.filter((game) => game.groupId === groupId).length).toBeLessThanOrEqual(2);
      }

      const stopped = await qualifier.stop();
      expect(stopped.currentGameIds).toEqual([]);
      expect(countByStatus(stopped)).toEqual({ canceled: 20 });
    },
  );

  it('stores the requested concurrency in the breakpoint', async () => {
    const checkpointStore = new QualifierCheckpointStore({ filePath: null });
    const qualifier = createQualifier({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => XiangqiGame.initial(),
      checkpointStore,
    });

    qualifier.start(startInput(4));
    const stopped = await qualifier.stop();

    expect(stopped.phase).toBe('stopped');
    expect(stopped.resumable).toBe(true);
    expect(stopped.checkpointSavedAt).not.toBeNull();
    expect(checkpointStore.load()).toMatchObject({ phase: 'stopped', concurrency: 4 });

    // A restarted process restores the same concurrency from the breakpoint.
    const restored = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      checkpointStore,
    });
    expect(restored.getState().concurrency).toBe(4);
    const resumed = restored.resume();
    expect(resumed.concurrency).toBe(4);
    const final = await waitFor(restored, (state) => state.phase === 'finished');
    expect(final.phase).toBe('finished');
    expect(final.completedGames).toBe(20);
  });

  it('finishes every game concurrently and keeps the serial qualification order', async () => {
    const qualifier = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
    });

    const done = waitForEnd(qualifier);
    const started = qualifier.start(startInput(8));
    // Eight workers still only fill one four-game wave at a time.
    expect(started.currentGameIds).toHaveLength(4);
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(state.completedGames).toBe(20);
    expect(state.currentGameIds).toEqual([]);
    expect(state.concurrency).toBe(8);
    expect(state.qualifiedModelIds).toEqual(['m1', 'm6', 'm2', 'm7']);
  });

  it('stops mid-round after one wave completed, canceling the rest', async () => {
    let calls = 0;
    const qualifier = createQualifier({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => {
        calls += 1;
        // The first four-game wave is adjudicated at once; the second wave hangs.
        return calls <= 4 ? XiangqiGame.fromFen(MATE_RED_WINS) : XiangqiGame.initial();
      },
    });

    qualifier.start(startInput(4));
    const midWave = await waitFor(
      qualifier,
      (state) => state.completedGames === 4 && state.currentGameIds.length === 4,
    );
    expect(midWave.phase).toBe('running');
    const active = midWave.games.filter((game) => midWave.currentGameIds.includes(game.id));
    expect(new Set(active.map((game) => qualifierRoundOf(game)))).toEqual(new Set([2]));
    const players = active.flatMap((game) => [game.redModelId, game.blackModelId]);
    expect(new Set(players).size).toBe(8);

    const stopped = await qualifier.stop();
    expect(stopped.phase).toBe('stopped');
    expect(stopped.completedGames).toBe(4);
    expect(stopped.processedGames).toBe(20);
    expect(countByStatus(stopped)).toEqual({ finished: 4, canceled: 16 });
    // Canceled games are not decided, so neither group may promote anyone.
    expect(stopped.groups.every((group) => !group.complete)).toBe(true);
    expect(stopped.groups.every((group) => group.qualifiedModelIds.length === 0)).toBe(true);
    expect(stopped.qualifiedModelIds).toEqual([]);
  });
});

describe('Qualifier checkpoint and resume', () => {
  it('persists after every game, stops resumably and replays only unfinished games', async () => {
    const checkpointFile = createCheckpointFile();
    const firstCompletions: QualifierGameCompletion[] = [];
    let firstCalls = 0;
    const first = createQualifier({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => {
        firstCalls += 1;
        // Three games are decided at once; the fourth game hangs.
        return firstCalls <= 3
          ? XiangqiGame.fromFen(MATE_RED_WINS)
          : XiangqiGame.initial();
      },
      checkpointStore: new QualifierCheckpointStore({ filePath: checkpointFile }),
      onGameComplete: (completion) => firstCompletions.push(completion),
    });

    first.start(startInput());
    await waitFor(
      first,
      (state) => state.completedGames === 3 && state.currentGameIds.length > 0,
    );
    const stopped = await first.stop();

    expect(stopped.phase).toBe('stopped');
    expect(stopped.resumable).toBe(true);
    expect(stopped.error).toBeNull();
    expect(stopped.checkpointSavedAt).not.toBeNull();
    expect(stopped.completedGames).toBe(3);
    expect(stopped.groupGamesProcessed).toBe(20);
    expect(stopped.processedGames).toBe(20);
    expect(countByStatus(stopped)).toEqual({ finished: 3, canceled: 17 });
    expect(stopped.currentGameIds).toEqual([]);
    expect(stopped.qualifiedModelIds).toEqual([]);
    expect(firstCalls).toBe(4);
    // Canceled games are never archived.
    expect(firstCompletions).toHaveLength(3);
    expect(JSON.stringify(stopped)).not.toContain('secret-');

    const onDisk = JSON.parse(readFileSync(checkpointFile, 'utf8')) as unknown;
    const saved = parseQualifierCheckpoint(onDisk);
    expect(saved).not.toBeNull();
    expect(saved).toMatchObject({
      version: 1,
      phase: 'stopped',
      qualifierId: stopped.qualifierId,
      concurrency: 1,
    });
    expect(saved?.entrants).toHaveLength(10);
    expect(saved?.entrants[0]?.setup.apiKey).toBe('secret-A1');
    expect(saved?.games.filter((game) => game.status === 'finished')).toHaveLength(3);
    expect(saved?.games.filter((game) => game.status === 'canceled')).toHaveLength(17);
    const finishedBefore = new Map(
      stopped.games
        .filter((game) => game.status === 'finished')
        .map((game) => [game.id, game.finishedAt]),
    );

    // A new process reads the same breakpoint; the stopped phase is preserved.
    let secondCalls = 0;
    const secondCompletions: QualifierGameCompletion[] = [];
    const secondStore = new QualifierCheckpointStore({ filePath: checkpointFile });
    const second = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => {
        secondCalls += 1;
        return XiangqiGame.fromFen(MATE_RED_WINS);
      },
      checkpointStore: secondStore,
      onGameComplete: (completion) => secondCompletions.push(completion),
    });
    const restored = second.getState();
    expect(restored.phase).toBe('stopped');
    expect(restored.resumable).toBe(true);
    expect(restored.qualifierId).toBe(stopped.qualifierId);
    expect(restored.completedGames).toBe(3);
    expect(restored.checkpointSavedAt).not.toBeNull();
    expect(countByStatus(restored)).toEqual({ finished: 3, canceled: 17 });

    const resumed = second.resume();
    expect(resumed.phase).toBe('running');
    expect(resumed.resumable).toBe(false);
    expect(resumed.qualifierId).toBe(stopped.qualifierId);

    const final = await waitFor(second, (state) => state.phase === 'finished');
    expect(final.phase).toBe('finished');
    expect(final.qualifierId).toBe(stopped.qualifierId);
    expect(final.completedGames).toBe(20);
    expect(countByStatus(final)).toEqual({ finished: 20 });
    expect(final.qualifiedModelIds).toEqual(['m1', 'm6', 'm2', 'm7']);
    // Only the 17 unfinished games are replayed.
    expect(secondCalls).toBe(17);
    for (const [gameId, finishedAt] of finishedBefore) {
      expect(final.games.find((game) => game.id === gameId)?.finishedAt).toBe(finishedAt);
    }
    expect(secondCompletions).toHaveLength(17);
    expect(secondStore.load()?.phase).toBe('finished');
    expect(final.checkpointSavedAt).not.toBeNull();
  });

  it('restores a finished qualifying table so the main draw survives a restart', async () => {
    const checkpointFile = createCheckpointFile();
    const first = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      checkpointStore: new QualifierCheckpointStore({ filePath: checkpointFile }),
    });
    const done = waitForEnd(first);
    first.start(startInput());
    const finished = await done;
    expect(finished.phase).toBe('finished');

    const second = createQualifier({
      providerFactory: () => unusedProvider,
      checkpointStore: new QualifierCheckpointStore({ filePath: checkpointFile }),
    });
    const restored = second.getState();
    expect(restored).toMatchObject({
      phase: 'finished',
      qualifierId: finished.qualifierId,
      completedGames: 20,
      resumable: false,
    });
    expect(restored.qualifiedModelIds).toEqual(finished.qualifiedModelIds);
    expect(restored.entrants).toHaveLength(CHAMPIONSHIP_QUALIFIER_ENTRANTS);
    expect(restored.groups.every((group) => group.complete)).toBe(true);
    expect(JSON.stringify(restored)).not.toContain('secret-');
  });

  it('restores a running breakpoint as interrupted and resumes it', async () => {
    const checkpointFile = createCheckpointFile();
    let firstCalls = 0;
    const first = createQualifier({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => {
        firstCalls += 1;
        return firstCalls <= 2
          ? XiangqiGame.fromFen(MATE_RED_WINS)
          : XiangqiGame.initial();
      },
      checkpointStore: new QualifierCheckpointStore({ filePath: checkpointFile }),
    });

    first.start(startInput());
    await waitFor(
      first,
      (state) => state.completedGames === 2 && state.currentGameIds.length > 0,
    );
    const qualifierId = first.getState().qualifierId;
    // Simulate a power cut / process kill: no stop(), only dispose().
    first.dispose();

    const second = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      checkpointStore: new QualifierCheckpointStore({ filePath: checkpointFile }),
    });
    const restored = second.getState();
    expect(restored.phase).toBe('interrupted');
    expect(restored.resumable).toBe(true);
    expect(restored.qualifierId).toBe(qualifierId);
    expect(restored.completedGames).toBe(2);
    // The in-flight game was persisted as running and will be replayed.
    expect(restored.games.some((game) => game.status === 'running')).toBe(true);

    const resumed = second.resume();
    expect(resumed.phase).toBe('running');

    const final = await waitFor(second, (state) => state.phase === 'finished');
    expect(final.phase).toBe('finished');
    expect(final.qualifierId).toBe(qualifierId);
    expect(final.completedGames).toBe(20);
    expect(final.qualifiedModelIds).toEqual(['m1', 'm6', 'm2', 'm7']);
    expect(JSON.stringify(final)).not.toContain('secret-');
  });

  it('ignores malformed breakpoints and refuses to resume without one', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const checkpointFile = createCheckpointFile();
    writeFileSync(checkpointFile, '{"version":1,"entrants":oops}', 'utf8');
    const store = new QualifierCheckpointStore({ filePath: checkpointFile });
    expect(store.has()).toBe(false);

    const qualifier = createQualifier({ checkpointStore: store });
    expect(qualifier.getState()).toMatchObject({
      phase: 'idle',
      resumable: false,
      checkpointSavedAt: null,
      qualifierId: null,
    });
    expect(() => qualifier.resume()).toThrow(/没有可继续/);
  });

  it('resumes after an internal error once the engine is healthy again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const qualifier = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
    });
    const internals = qualifier as unknown as {
      runGame: (game: ChampionshipGameView, token: number) => Promise<void>;
    };
    const originalRunGame = internals.runGame.bind(qualifier);
    internals.runGame = async () => {
      throw new Error('engine exploded');
    };

    const done = waitForEnd(qualifier);
    qualifier.start(startInput());
    const crashed = await done;

    expect(crashed.phase).toBe('error');
    expect(crashed.error).toBe('入围赛内部错误，可继续入围赛或重新发起');
    expect(crashed.resumable).toBe(true);
    expect(crashed.checkpointSavedAt).not.toBeNull();
    expect(crashed.completedGames).toBe(0);
    expect(countByStatus(crashed)).toEqual({ canceled: 20 });
    expect(JSON.stringify(crashed)).not.toContain('secret-');

    internals.runGame = originalRunGame;
    const recoveredId = crashed.qualifierId;
    const recoveredDone = waitFor(
      qualifier,
      (state) => state.phase === 'finished' && state.qualifierId === recoveredId,
    );
    qualifier.resume();
    const final = await recoveredDone;

    expect(final.phase).toBe('finished');
    expect(final.qualifierId).toBe(recoveredId);
    expect(final.completedGames).toBe(20);
    expect(final.resumable).toBe(false);
    expect(final.qualifiedModelIds).toEqual(['m1', 'm6', 'm2', 'm7']);
  });
});

describe('Qualifier history', () => {
  it('archives every qualifying game as mode=championship and stage=qualifier', async () => {
    const completions: QualifierGameCompletion[] = [];
    const store = new HistoryStore({ filePath: null });
    const qualifier = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      onGameComplete: (completion) => {
        completions.push(completion);
        store.recordQualifierGame(completion);
      },
    });
    const done = waitForEnd(qualifier);
    qualifier.start(startInput());
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(completions).toHaveLength(20);
    expect(store.size).toBe(20);
    expect(store.stats()).toMatchObject({
      total: 20,
      championship: 20,
      finished: 20,
      failed: 0,
    });

    const list = store.list({
      limit: 50,
      offset: 0,
      mode: 'championship',
      status: null,
      q: '',
    });
    expect(list.total).toBe(20);
    expect(list.records).toHaveLength(20);
    for (const record of list.records) {
      expect(record.mode).toBe('championship');
      expect(record.status).toBe('finished');
      expect(record.tournament).toBeNull();
      expect(record.championship).toMatchObject({
        championshipId: state.qualifierId,
        stage: 'qualifier',
        seriesId: null,
        gameIndex: 1,
      });
      expect(['A', 'B']).toContain(record.championship?.groupId);
      expect(record.championship?.pairIndex).toBeGreaterThanOrEqual(1);
      expect(record.championship?.pairIndex).toBeLessThanOrEqual(10);
      expect(record.red.name).toBeTruthy();
      expect(record.black.name).toBeTruthy();
      expect(JSON.stringify(record)).not.toContain('secret-');
      expect(JSON.stringify(record)).not.toContain('apiKey');
    }
    // The qualifier id is searchable through the championship reference.
    const searched = store.list({
      limit: 50,
      offset: 0,
      mode: null,
      status: null,
      q: state.qualifierId!,
    });
    expect(searched.total).toBe(20);

    const first = list.records[0]!;
    const detail = store.get(first.id);
    expect(detail).not.toBeNull();
    expect(detail?.championship?.stage).toBe('qualifier');
    expect(Array.isArray(detail?.moves)).toBe(true);
    expect(JSON.stringify(detail)).not.toContain('secret-');
  });

  it('records failed games and skips canceled or unattributed ones', async () => {
    const completions: QualifierGameCompletion[] = [];
    const capture = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      onGameComplete: (completion) => completions.push(completion),
    });
    const captureDone = waitForEnd(capture);
    capture.start(startInput());
    await captureDone;
    const base = completions[0]!;

    const store = new HistoryStore({ filePath: null });
    const failedGame: ChampionshipGameView = {
      ...base.game,
      status: 'failed',
      result: null,
      winnerModelId: null,
      failedSide: 'black',
      error: 'HTTP 500',
    };
    const failed = store.recordQualifierGame({
      ...base,
      game: failedGame,
      finalState: { ...base.finalState, phase: 'error' },
    });
    expect(failed).toMatchObject({
      mode: 'championship',
      status: 'failed',
      failedSide: 'black',
      error: 'HTTP 500',
      championship: {
        championshipId: base.qualifierId,
        stage: 'qualifier',
        groupId: base.game.groupId,
        seriesId: null,
      },
    });

    // Canceled games were never adjudicated and must not enter the archive.
    expect(
      store.recordQualifierGame({
        ...base,
        game: { ...base.game, status: 'canceled', error: '入围赛提前终止' },
      }),
    ).toBeNull();
    // A game without a qualifying group cannot be attributed.
    expect(
      store.recordQualifierGame({
        ...base,
        game: { ...base.game, groupId: null },
      }),
    ).toBeNull();
    expect(store.size).toBe(1);
  });

  it('pauses when a key quota is exhausted and resumes after top-up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const checkpointFile = createCheckpointFile();
    let quotaCalls = 0;
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        quotaCalls += 1;
        throw new ProviderError('额度不足（HTTP 429）：insufficient_quota', {
          status: 429,
          retryable: false,
          quotaExceeded: true,
        });
      },
    };
    const qualifier = createQualifier({
      providerFactory: () => provider,
      checkpointStore: new QualifierCheckpointStore({ filePath: checkpointFile }),
      // The first game starts normally; every later board is already terminal.
      createInitialGame: scriptedFactory({ 1: 'fail' }, 'black'),
    });

    qualifier.start(startInput());
    const paused = await waitFor(qualifier, (state) => state.phase === 'paused');

    expect(paused.resumable).toBe(true);
    expect(paused.error).toContain('额度不足');
    expect(paused.error).toContain('继续入围赛');
    expect(quotaCalls).toBe(1);

    const saved = parseQualifierCheckpoint(
      JSON.parse(readFileSync(checkpointFile, 'utf8')) as unknown,
    );
    expect(saved?.phase).toBe('paused');
    expect(saved?.games[0]?.status).toBe('canceled');

    qualifier.resume();
    const finished = await waitForEnd(qualifier);

    expect(finished.phase).toBe('finished');
    expect(finished.qualifiedModelIds).toHaveLength(4);
    expect(quotaCalls).toBe(1);
  });

  it('persists qualifying records and reloads them across store instances', async () => {
    const filePath = path.join(createTemporaryDirectory(), 'history.jsonl');
    const completions: QualifierGameCompletion[] = [];
    const qualifier = createQualifier({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      onGameComplete: (completion) => completions.push(completion),
    });
    const done = waitForEnd(qualifier);
    qualifier.start(startInput());
    await done;

    const store = new HistoryStore({ filePath });
    expect(completions).toHaveLength(20);
    for (const completion of completions) store.recordQualifierGame(completion);
    expect(store.size).toBe(20);

    // Reloading validates every line, so a qualifier ref must survive parsing.
    const reloaded = new HistoryStore({ filePath });
    expect(reloaded.size).toBe(20);
    expect(reloaded.stats()).toMatchObject({ championship: 20, finished: 20 });
    const record = reloaded.list({
      limit: 1,
      offset: 0,
      mode: 'championship',
      status: null,
      q: '',
    }).records[0]!;
    expect(record.championship?.stage).toBe('qualifier');
    const detail = reloaded.get(record.id);
    expect(detail?.championship?.stage).toBe('qualifier');
    expect(detail?.moves).toHaveLength(0);
    expect(JSON.stringify(detail)).not.toContain('secret-');
  });
});
