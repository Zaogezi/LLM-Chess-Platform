import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChampionshipArchive, ChampionshipState } from '../../shared/protocol';
import type { ModelProvider } from '../providers/index';
import { ProviderError } from '../providers/index';
import { XiangqiGame } from '../xiangqi/index';
import { parseChampionshipArchive } from './archive';
import type {
  ChampionshipGameCompletion,
  ChampionshipOptions,
} from './championship';
import { Championship } from './championship';
import {
  ChampionshipCheckpointStore,
  parseChampionshipCheckpoint,
} from './checkpoint';
import { validateChampionshipStartRequest } from './validate';
import type { ValidatedChampionshipStart } from './validate';

/** Red is checkmated at once, so black wins without any model call. */
const MATE_BLACK_WINS = '3k5/9/9/9/9/9/9/9/3r5/3rKa3 w - - 0 1';
/** Black is checkmated at once, so red wins without any model call. */
const MATE_RED_WINS = '3Rk4/3R5/9/9/9/9/9/9/9/4K4 b - - 0 1';
/** Kings only: static dead position, adjudicated as a draw. */
const DEAD_DRAW = '4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1';

const GROUP_IDS = ['A', 'B', 'C', 'D'] as const;
/** A1…D4: the trailing digit is the seed pool. */
const ENTRANT_NAMES = GROUP_IDS.flatMap((groupId) =>
  [1, 2, 3, 4].map((pool) => `${groupId}${pool}`),
);

const activeChampionships: Championship[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  while (activeChampionships.length) activeChampionships.pop()?.dispose();
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function createCheckpointFile(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'xiangqi-championship-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'championship.json');
}

function createChampionship(options: ChampionshipOptions = {}): Championship {
  const championship = new Championship(options);
  activeChampionships.push(championship);
  return championship;
}

function startInput(): ValidatedChampionshipStart {
  return validateChampionshipStartRequest({
    entrants: ENTRANT_NAMES.map((name) => ({
      name,
      seedPool: Number(name.slice(1)),
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      model: `${name.toLocaleLowerCase()}-model`,
      apiKey: `secret-${name}`,
      thinkingLevel: 'quick',
      apiReasoning: false,
    })),
    groups: GROUP_IDS.map((groupId) => ({
      id: groupId,
      entrantNames: [1, 2, 3, 4].map((pool) => `${groupId}${pool}`),
    })),
  });
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
 * Deterministic position factory driven by the 1-based game call number, so a
 * test can script individual series games (including failures) precisely.
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
  championship: Championship,
  predicate: (state: ChampionshipState) => boolean,
  timeoutMs = 10_000,
): Promise<ChampionshipState> {
  const current = championship.getState();
  if (predicate(current)) return Promise.resolve(current);

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(
        new Error(
          `timed out waiting for championship; phase=${championship.getState().phase}`,
        ),
      );
    }, timeoutMs);

    const unsubscribe = championship.onState((state) => {
      if (settled || !predicate(state)) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    });
  });
}

function waitForEnd(championship: Championship): Promise<ChampionshipState> {
  return waitFor(
    championship,
    (state) =>
      state.phase === 'finished' || state.phase === 'stopped' || state.phase === 'error',
  );
}

function seriesById(state: ChampionshipState, id: string) {
  const series = state.series.find((item) => item.id === id);
  if (!series) throw new Error(`missing series ${id}`);
  return series;
}

describe('Championship', () => {
  it('runs 24 group games and the six-game three-point bracket to a champion', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let providerCalls = 0;
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        providerCalls += 1;
        throw new Error('terminal positions must not call a model');
      },
    };
    const completions: ChampionshipGameCompletion[] = [];
    const championship = createChampionship({
      providerFactory: () => provider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      onGameComplete: (completion) => {
        completions.push(completion);
        if (completions.length === 1) {
          // A broken history store must never break the championship.
          throw new Error('history exploded');
        }
      },
    });

    const done = waitForEnd(championship);
    championship.start(startInput());
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(providerCalls).toBe(0);
    expect(state.championshipId).not.toBeNull();
    expect(state.error).toBeNull();
    expect(state.finishedAt).not.toBeNull();
    expect(state.stage).toBe('final');
    expect(state.championModelId).toBe('m2');
    expect(state.championName).toBe('A2');
    expect(state.currentGameId).toBeNull();
    expect(state.currentSeriesId).toBeNull();

    // Counters: 24 group games + 7 series × 5 decisive games.
    expect(state.groupGamesTotal).toBe(24);
    expect(state.groupGamesProcessed).toBe(24);
    expect(state.seriesTotal).toBe(7);
    expect(state.seriesProcessed).toBe(7);
    expect(state.scheduledGames).toBe(59);
    expect(state.processedGames).toBe(59);
    expect(state.completedGames).toBe(59);

    // With red winning every game, seeds 2 and 3 are the two group qualifiers.
    expect(state.groups.map((group) => group.id)).toEqual(['A', 'B', 'C', 'D']);
    for (const group of state.groups) {
      expect(group.complete).toBe(true);
      expect(group.entrantIds).toHaveLength(4);
      expect(group.standings.map((row) => row.played)).toEqual([3, 3, 3, 3]);
      expect(group.standings.map((row) => row.points)).toEqual([6, 6, 3, 3]);
      expect(group.standings.map((row) => row.name)).toEqual([
        `${group.id}2`,
        `${group.id}3`,
        `${group.id}1`,
        `${group.id}4`,
      ]);
      expect(group.qualifiedModelIds).toHaveLength(2);
      expect(group.qualifiedModelIds).toEqual(
        group.standings.slice(0, 2).map((row) => row.modelId),
      );
    }

    // Quarterfinal pairings: A1–B2, C1–D2, B1–A2, D1–C2.
    const qf1 = seriesById(state, 'qf1');
    expect(qf1).toMatchObject({
      stage: 'quarterfinal',
      slot: 1,
      label: '八强赛 1',
      status: 'finished',
      decision: 'points',
      leftWins: 3,
      rightWins: 2,
      leftPoints: 3,
      rightPoints: 2,
      draws: 0,
      failed: 0,
      playedGames: 5,
      maxGames: 6,
      overtime: false,
      extra: false,
      winnerModelId: 'm2',
    });
    expect(qf1.left).toEqual({ modelId: 'm2', name: 'A2' });
    expect(qf1.right).toEqual({ modelId: 'm7', name: 'B3' });
    expect(seriesById(state, 'qf2').left).toEqual({ modelId: 'm10', name: 'C2' });
    expect(seriesById(state, 'qf2').right).toEqual({ modelId: 'm15', name: 'D3' });
    expect(seriesById(state, 'qf3').left).toEqual({ modelId: 'm6', name: 'B2' });
    expect(seriesById(state, 'qf3').right).toEqual({ modelId: 'm3', name: 'A3' });
    expect(seriesById(state, 'qf4').left).toEqual({ modelId: 'm14', name: 'D2' });
    expect(seriesById(state, 'qf4').right).toEqual({ modelId: 'm11', name: 'C3' });

    // Later rounds are filled from the winners as they emerge.
    const sf1 = seriesById(state, 'sf1');
    expect(sf1).toMatchObject({
      stage: 'semifinal',
      label: '半决赛 1',
      status: 'finished',
      leftWins: 3,
      rightWins: 2,
      leftPoints: 3,
      rightPoints: 2,
      playedGames: 5,
      maxGames: 6,
      decision: 'points',
      winnerModelId: 'm2',
    });
    expect(sf1.left).toEqual({ modelId: 'm2', name: 'A2' });
    expect(sf1.right).toEqual({ modelId: 'm10', name: 'C2' });
    const sf2 = seriesById(state, 'sf2');
    expect(sf2.left).toEqual({ modelId: 'm6', name: 'B2' });
    expect(sf2.right).toEqual({ modelId: 'm14', name: 'D2' });
    expect(sf2.winnerModelId).toBe('m6');
    const finalSeries = seriesById(state, 'final');
    expect(finalSeries).toMatchObject({
      stage: 'final',
      label: '决赛',
      status: 'finished',
      decision: 'points',
      leftWins: 3,
      rightWins: 2,
      leftPoints: 3,
      rightPoints: 2,
      playedGames: 5,
      maxGames: 6,
      winnerModelId: 'm2',
    });
    expect(finalSeries.left).toEqual({ modelId: 'm2', name: 'A2' });
    expect(finalSeries.right).toEqual({ modelId: 'm6', name: 'B2' });
    for (const series of state.series) {
      expect(series.status).toBe('finished');
      expect(series.decision).toBe('points');
      expect(series.playedGames).toBe(5);
      expect(series.maxGames).toBe(6);
    }

    // Games: 24 group + 35 knockout, all adjudicated, every stage field set.
    const groupGames = state.games.filter((game) => game.stage === 'group');
    const knockoutGames = state.games.filter((game) => game.stage !== 'group');
    expect(groupGames).toHaveLength(24);
    expect(
      groupGames.every(
        (game) =>
          game.status === 'finished' &&
          game.groupId !== null &&
          game.seriesId === null &&
          game.winnerModelId === game.redModelId,
      ),
    ).toBe(true);
    expect(knockoutGames).toHaveLength(35);
    expect(
      knockoutGames.every(
        (game) =>
          game.status === 'finished' &&
          game.groupId === null &&
          game.seriesId !== null &&
          game.winnerModelId === game.redModelId,
      ),
    ).toBe(true);
    for (const seriesId of ['qf1', 'qf2', 'qf3', 'qf4', 'sf1', 'sf2', 'final']) {
      const games = knockoutGames.filter((game) => game.seriesId === seriesId);
      expect(games.map((game) => game.gameIndex)).toEqual([1, 2, 3, 4, 5]);
    }
    const qf1Games = knockoutGames.filter((game) => game.seriesId === 'qf1');
    expect(qf1Games.map((game) => game.redModelId)).toEqual([
      'm2',
      'm7',
      'm2',
      'm7',
      'm2',
    ]);
    expect(qf1Games.map((game) => game.blackModelId)).toEqual([
      'm7',
      'm2',
      'm7',
      'm2',
      'm7',
    ]);
    expect(qf1Games.map((game) => game.pairIndex)).toEqual([1, 1, 1, 1, 1]);

    // Public state never contains keys, and every game was reported to history.
    expect(JSON.stringify(state)).not.toContain('secret-');
    expect(JSON.stringify(state)).not.toContain('apiKey');
    expect(completions).toHaveLength(59);
    expect(completions.every((completion) => completion.game.status === 'finished')).toBe(
      true,
    );
    expect(
      completions.every(
        (completion) =>
          completion.championshipId === state.championshipId &&
          completion.red.seedPool >= 1 &&
          completion.black.groupId !== undefined,
      ),
    ).toBe(true);
    expect(JSON.stringify(completions)).not.toContain('secret-');
  });

  it('enters overtime after three draws and the next decisive game wins', async () => {
    const championship = createChampionship({
      providerFactory: () => unusedProvider,
      // Group: red wins. QF1: three draws, then a decisive game.
      createInitialGame: scriptedFactory({ 25: 'draw', 26: 'draw', 27: 'draw' }, 'red'),
    });

    const done = waitForEnd(championship);
    championship.start(startInput());
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(state.championModelId).not.toBeNull();
    // qf1 played 3 draws + one decisive game (game 4 is even → right is red).
    const qf1 = seriesById(state, 'qf1');
    expect(qf1).toMatchObject({
      status: 'finished',
      decision: 'overtime',
      leftWins: 0,
      rightWins: 1,
      leftPoints: 3,
      rightPoints: 4,
      draws: 3,
      failed: 0,
      playedGames: 4,
      maxGames: 6,
      overtime: true,
      extra: false,
      winnerModelId: 'm7',
    });
    const qf1Games = state.games.filter((game) => game.seriesId === 'qf1');
    expect(qf1Games.map((game) => game.gameIndex)).toEqual([1, 2, 3, 4]);
    expect(qf1Games[3]?.redModelId).toBe('m7');
    expect(qf1Games[3]?.result?.winner).toBe('red');
    // 24 group + 4 qf1 games + 6 remaining series × 5 games.
    expect(state.scheduledGames).toBe(58);
    expect(state.completedGames).toBe(58);
  });

  it('keeps playing extra games beyond six when the group rankings are identical', async () => {
    const championship = createChampionship({
      providerFactory: () => unusedProvider,
      // Everything is drawn until the 7th game of sf1/sf2/final, which is
      // decisive. Identical group pedigrees force the extra games.
      createInitialGame: scriptedFactory(
        { 55: 'red', 62: 'red', 69: 'red' },
        'draw',
      ),
    });

    const done = waitForEnd(championship);
    championship.start(startInput());
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(state.championModelId).toBe('m1');
    expect(state.championName).toBe('A1');
    // 24 group + 4 QF × 6 + 2 SF × 7 + final × 7.
    expect(state.scheduledGames).toBe(69);
    expect(state.completedGames).toBe(69);

    // Quarterfinals are decided by ranking at the six-game cap.
    for (const id of ['qf1', 'qf2', 'qf3', 'qf4']) {
      expect(seriesById(state, id)).toMatchObject({
        decision: 'ranking',
        playedGames: 6,
        draws: 6,
        overtime: true,
        extra: false,
      });
    }

    // Semifinals and the final have identical group pedigrees (both rank 1,
    // same points/wins/draws/seed pool), so they go to extra games.
    for (const id of ['sf1', 'sf2', 'final']) {
      expect(seriesById(state, id)).toMatchObject({
        decision: 'overtime',
        playedGames: 7,
        draws: 6,
        leftWins: 1,
        rightWins: 0,
        leftPoints: 7,
        rightPoints: 6,
        overtime: true,
        extra: true,
      });
    }
    const sf1 = seriesById(state, 'sf1');
    expect(sf1.left).toEqual({ modelId: 'm1', name: 'A1' });
    expect(sf1.right).toEqual({ modelId: 'm9', name: 'C1' });
    const sf1Games = state.games.filter((game) => game.seriesId === 'sf1');
    expect(sf1Games.map((game) => game.gameIndex)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(sf1Games[6]?.result?.winner).toBe('red');
    expect(sf1Games[6]?.redModelId).toBe('m1');
  });

  it('stops an in-flight game and cancels the remaining group schedule', async () => {
    const championship = createChampionship({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => XiangqiGame.initial(),
    });

    championship.start(startInput());
    await waitFor(championship, (state) =>
      state.games.some((game) => game.status === 'running'),
    );
    const stopped = await championship.stop();

    expect(stopped.phase).toBe('stopped');
    expect(stopped.stage).toBe('group');
    expect(stopped.error).toBeNull();
    expect(stopped.championModelId).toBeNull();
    expect(stopped.championName).toBeNull();
    expect(stopped.currentGameId).toBeNull();
    expect(stopped.currentSeriesId).toBeNull();
    expect(stopped.finishedAt).not.toBeNull();

    expect(stopped.games).toHaveLength(24);
    expect(stopped.games.every((game) => game.status === 'canceled')).toBe(true);
    expect(stopped.games[0]?.error).toBe('锦标赛提前终止');
    expect(stopped.games.every((game) => game.groupId !== null)).toBe(true);
    expect(stopped.games.every((game) => game.stage === 'group')).toBe(true);

    expect(stopped.groupGamesProcessed).toBe(24);
    expect(stopped.processedGames).toBe(24);
    expect(stopped.completedGames).toBe(0);
    // Canceled games never complete a group or promote qualifiers.
    expect(stopped.groups.every((group) => !group.complete)).toBe(true);
    expect(stopped.groups.every((group) => group.qualifiedModelIds.length === 0)).toBe(
      true,
    );

    // All seven bracket nodes are present but stopped, never played.
    expect(stopped.series).toHaveLength(7);
    expect(stopped.series.every((series) => series.status === 'stopped')).toBe(true);
    expect(stopped.series.every((series) => series.playedGames === 0)).toBe(true);
    expect(stopped.series.every((series) => series.left === null)).toBe(true);
    expect(stopped.seriesProcessed).toBe(0);

    expect(JSON.stringify(stopped)).not.toContain('secret-');
    expect(JSON.stringify(stopped)).not.toContain('apiKey');
  });

  it('keeps a stopped midway group incomplete without qualifiers', async () => {
    const championship = createChampionship({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => XiangqiGame.initial(),
    });

    championship.start(startInput());
    await waitFor(championship, (state) =>
      state.games.some((game) => game.status === 'running'),
    );
    const stopped = await championship.stop();

    expect(stopped.phase).toBe('stopped');
    expect(stopped.groups).toHaveLength(4);
    for (const group of stopped.groups) {
      expect(group.complete).toBe(false);
      expect(group.qualifiedModelIds).toEqual([]);
      // Live standings are still exposed, just never promoted as qualifiers.
      expect(group.standings).toHaveLength(4);
      expect(group.entrantIds).toHaveLength(4);
    }
    // Canceled games still count as processed for the progress counters.
    expect(stopped.groupGamesProcessed).toBe(24);
    expect(stopped.processedGames).toBe(24);
    expect(stopped.completedGames).toBe(0);
    expect(stopped.games.every((game) => game.status === 'canceled')).toBe(true);
    expect(stopped.series.every((series) => series.status === 'stopped')).toBe(true);
  });

  it('stops the bracket mid-series and retains the knockout stage', async () => {
    let initialGames = 0;
    const championship = createChampionship({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => {
        initialGames += 1;
        // The 24 group games end immediately; the first knockout game hangs.
        return initialGames <= 24
          ? XiangqiGame.fromFen(MATE_RED_WINS)
          : XiangqiGame.initial();
      },
    });

    championship.start(startInput());
    await waitFor(
      championship,
      (state) =>
        state.games.some(
          (game) => game.seriesId === 'qf1' && game.status === 'running',
        ),
    );
    const stopped = await championship.stop();

    expect(stopped.phase).toBe('stopped');
    expect(stopped.stage).toBe('quarterfinal');
    expect(stopped.championModelId).toBeNull();
    expect(stopped.groupGamesProcessed).toBe(24);
    expect(stopped.completedGames).toBe(24);
    expect(stopped.scheduledGames).toBe(25);
    expect(stopped.processedGames).toBe(25);
    expect(stopped.games.filter((game) => game.status === 'finished')).toHaveLength(24);
    const canceled = stopped.games.filter((game) => game.status === 'canceled');
    expect(canceled).toHaveLength(1);
    expect(canceled[0]).toMatchObject({
      seriesId: 'qf1',
      stage: 'quarterfinal',
      gameIndex: 1,
      groupId: null,
      error: '锦标赛提前终止',
    });
    expect(stopped.series.every((series) => series.status === 'stopped')).toBe(true);
    expect(seriesById(stopped, 'qf1').left).toEqual({ modelId: 'm2', name: 'A2' });
    expect(seriesById(stopped, 'qf1').right).toEqual({ modelId: 'm7', name: 'B3' });
    expect(seriesById(stopped, 'sf1').left).toBeNull();
    expect(JSON.stringify(stopped)).not.toContain('secret-');
  });

  it('runs multiple group games concurrently without sharing an entrant', async () => {
    const checkpointStore = new ChampionshipCheckpointStore({ filePath: null });
    const championship = createChampionship({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => XiangqiGame.initial(),
      checkpointStore,
    });

    championship.start({ ...startInput(), concurrency: 4 });
    const running = await waitFor(
      championship,
      (state) => state.currentGameIds.length >= 2,
    );

    expect(running.phase).toBe('running');
    expect(running.concurrency).toBe(4);
    expect(running.currentGameIds.length).toBeGreaterThanOrEqual(2);
    const activeGames = running.games.filter((game) =>
      running.currentGameIds.includes(game.id),
    );
    expect(activeGames.length).toBe(running.currentGameIds.length);
    const modelIds = activeGames.flatMap((game) => [game.redModelId, game.blackModelId]);
    expect(new Set(modelIds).size).toBe(modelIds.length);

    const stopped = await championship.stop();
    expect(stopped.phase).toBe('stopped');
    expect(stopped.currentGameIds).toEqual([]);
    expect(checkpointStore.load()?.concurrency).toBe(4);
  });

  it('runs same-round knockout series concurrently', async () => {
    let initialGames = 0;
    const championship = createChampionship({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => {
        initialGames += 1;
        return initialGames <= 24
          ? XiangqiGame.fromFen(MATE_RED_WINS)
          : XiangqiGame.initial();
      },
    });

    championship.start({ ...startInput(), concurrency: 4 });
    const running = await waitFor(
      championship,
      (state) =>
        state.currentSeriesIds.length >= 2 && state.currentGameIds.length >= 2,
    );

    expect(running.phase).toBe('running');
    expect(running.stage).toBe('quarterfinal');
    expect(running.currentGameIds.length).toBeGreaterThanOrEqual(2);
    const activeSeries = running.series.filter((series) =>
      running.currentSeriesIds.includes(series.id),
    );
    expect(activeSeries.length).toBeGreaterThanOrEqual(2);
    const modelIds = activeSeries.flatMap((series) =>
      [series.left?.modelId, series.right?.modelId].filter(
        (id): id is string => typeof id === 'string',
      ),
    );
    expect(new Set(modelIds).size).toBe(modelIds.length);

    await championship.stop();
  });

  it('finishes a concurrent edition with the normal champion and schedule', async () => {
    const championship = createChampionship({
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
    });

    const done = waitForEnd(championship);
    championship.start({ ...startInput(), concurrency: 8 });
    const state = await done;

    expect(state.phase).toBe('finished');
    expect(state.championName).toBe('A2');
    expect(state.games).toHaveLength(59);
    expect(state.currentGameIds).toEqual([]);
    expect(state.currentSeriesIds).toEqual([]);
  });

  it('persists completed games and resumes after a process restart', async () => {
    const checkpointFile = createCheckpointFile();
    const completions: ChampionshipGameCompletion[] = [];
    let initialGames = 0;
    const first = createChampionship({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => {
        initialGames += 1;
        // Three group games are decided immediately; the fourth hangs so the
        // test can stop a run that has real completed results.
        return initialGames <= 3
          ? XiangqiGame.fromFen(MATE_RED_WINS)
          : XiangqiGame.initial();
      },
      checkpointStore: new ChampionshipCheckpointStore({ filePath: checkpointFile }),
      onGameComplete: (completion) => completions.push(completion),
    });

    first.start(startInput());
    await waitFor(
      first,
      (state) => state.completedGames === 3 && state.currentGameId !== null,
    );
    const stopped = await first.stop();
    expect(stopped.phase).toBe('stopped');
    expect(stopped.resumable).toBe(true);
    expect(stopped.completedGames).toBe(3);
    expect(stopped.championshipId).not.toBeNull();

    const saved = parseChampionshipCheckpoint(
      JSON.parse(readFileSync(checkpointFile, 'utf8')) as unknown,
    );
    expect(saved).not.toBeNull();
    expect(saved?.version).toBe(2);
    expect(saved?.phase).toBe('stopped');
    expect(saved?.championshipId).toBe(stopped.championshipId);
    expect(saved?.entrants).toHaveLength(16);
    expect(saved?.games.filter((game) => game.status === 'finished')).toHaveLength(3);
    // Runtime setups are required to resume after a restart, but never leak
    // through the public state.
    expect(saved?.entrants[0]?.setup.apiKey).toBe('secret-A1');
    expect(JSON.stringify(stopped)).not.toContain('secret-');

    // A new process reads the same checkpoint file.
    first.dispose();
    const secondStore = new ChampionshipCheckpointStore({ filePath: checkpointFile });
    const second = createChampionship({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      checkpointStore: secondStore,
      onGameComplete: (completion) => completions.push(completion),
    });
    const restored = second.getState();
    expect(restored.phase).toBe('stopped');
    expect(restored.resumable).toBe(true);
    expect(restored.championshipId).toBe(stopped.championshipId);
    expect(restored.completedGames).toBe(3);
    expect(restored.checkpointSavedAt).not.toBeNull();
    expect(restored.games.filter((game) => game.status === 'canceled')).toHaveLength(21);

    const done = waitFor(second, (state) => state.phase === 'finished');
    second.resume();
    const final = await done;

    expect(final.phase).toBe('finished');
    expect(final.championshipId).toBe(stopped.championshipId);
    expect(final.championName).toBe('A2');
    // 24 group games + 35 knockout games; the three pre-restart results were
    // preserved rather than replayed.
    expect(final.completedGames).toBe(59);
    expect(final.seriesProcessed).toBe(7);
    expect(completions).toHaveLength(59);
    expect(new Set(completions.map((completion) => completion.game.id)).size).toBe(59);
    expect(
      completions.every((completion) => completion.championshipId === final.championshipId),
    ).toBe(true);
    expect(secondStore.has()).toBe(false);
  });

  it('resumes an abruptly interrupted run and replays only the unfinished game', async () => {
    const checkpointFile = createCheckpointFile();
    let initialGames = 0;
    const first = createChampionship({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => {
        initialGames += 1;
        return initialGames <= 2
          ? XiangqiGame.fromFen(MATE_RED_WINS)
          : XiangqiGame.initial();
      },
      checkpointStore: new ChampionshipCheckpointStore({ filePath: checkpointFile }),
    });

    first.start(startInput());
    await waitFor(
      first,
      (state) => state.completedGames === 2 && state.currentGameId !== null,
    );
    const championshipId = first.getState().championshipId;
    // Simulate a power cut / process kill: no stop(), only dispose().
    first.dispose();

    const second = createChampionship({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      checkpointStore: new ChampionshipCheckpointStore({ filePath: checkpointFile }),
    });
    const restored = second.getState();
    expect(restored.phase).toBe('interrupted');
    expect(restored.resumable).toBe(true);
    expect(restored.championshipId).toBe(championshipId);
    expect(restored.completedGames).toBe(2);
    // The interrupted game was running in the checkpoint and will be replayed.
    expect(restored.games.some((game) => game.status === 'running')).toBe(true);

    const done = waitFor(second, (state) => state.phase === 'finished');
    second.resume();
    const final = await done;

    expect(final.phase).toBe('finished');
    expect(final.championshipId).toBe(championshipId);
    expect(final.completedGames).toBe(59);
    expect(final.championName).toBe('A2');
  });

  it('resumes after an internal error once the engine is healthy again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const championship = createChampionship({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
    });
    const internals = championship as unknown as {
      runGame: (game: unknown, token: number) => Promise<void>;
    };
    const originalRunGame = internals.runGame.bind(championship);
    internals.runGame = async () => {
      throw new Error('engine exploded');
    };

    const crashed = await (async () => {
      const done = waitForEnd(championship);
      championship.start(startInput());
      return done;
    })();
    expect(crashed.phase).toBe('error');
    expect(crashed.resumable).toBe(true);
    expect(crashed.completedGames).toBe(0);

    internals.runGame = originalRunGame;
    const recoveredId = crashed.championshipId;
    const done = waitFor(
      championship,
      (state) => state.phase === 'finished' && state.championshipId === recoveredId,
    );
    championship.resume();
    const final = await done;
    expect(final.phase).toBe('finished');
    expect(final.championshipId).toBe(recoveredId);
    expect(final.completedGames).toBe(59);
    expect(final.resumable).toBe(false);
    expect(final.championName).toBe('A2');
  });

  it('ignores malformed checkpoints and refuses to resume without a breakpoint', () => {
    const checkpointFile = createCheckpointFile();
    writeFileSync(checkpointFile, '{"version":2,"entrants":oops}', 'utf8');
    const store = new ChampionshipCheckpointStore({ filePath: checkpointFile });
    expect(store.has()).toBe(false);

    const championship = createChampionship({ checkpointStore: store });
    expect(championship.getState()).toMatchObject({
      phase: 'idle',
      resumable: false,
      checkpointSavedAt: null,
    });
    expect(() => championship.resume()).toThrow(/没有可继续/);
  });

  it('awards forfeit wins instead of failed games when a model never moves legally', async () => {
    const provider: ModelProvider = {
      provider: 'openai',
      async complete() {
        return {
          text: JSON.stringify({ move: 'z9z9', reason: '故意非法' }),
          tokensIn: 2,
          tokensOut: 1,
        };
      },
    };
    const championship = createChampionship({
      providerFactory: () => provider,
      createInitialGame: () => XiangqiGame.initial(),
      gameSettings: { moveDelayMs: 0, maxAttempts: 1 },
    });

    const done = waitForEnd(championship);
    championship.start(startInput());
    const final = await done;

    expect(final.phase).toBe('finished');
    expect(final.completedGames).toBe(59);
    expect(final.seriesProcessed).toBe(7);
    expect(
      final.games.every(
        (game) =>
          game.status === 'finished' &&
          game.result?.reason === 'forfeit' &&
          game.result.winner === 'black' &&
          game.winnerModelId === game.blackModelId &&
          game.failedSide === null,
      ),
    ).toBe(true);

    for (const group of final.groups) {
      expect(group.complete).toBe(true);
      expect(group.standings.every((row) => row.failed === 0)).toBe(true);
      expect(group.standings.reduce((sum, row) => sum + row.points, 0)).toBe(18);
    }

    expect(JSON.stringify(final)).not.toContain('secret-');
  });

  it('records failed series games without awarding points and falls back to ranking', async () => {
    let providerCalls = 0;
    const countingProvider: ModelProvider = {
      provider: 'openai',
      async complete() {
        providerCalls += 1;
        throw new Error('upstream unavailable');
      },
    };
    const completions: ChampionshipGameCompletion[] = [];
    const championship = createChampionship({
      providerFactory: () => countingProvider,
      // Group: red wins. QF1: three failed games, then three decisive games.
      createInitialGame: scriptedFactory(
        { 25: 'fail', 26: 'fail', 27: 'fail' },
        'red',
      ),
      onGameComplete: (completion) => completions.push(completion),
    });

    const done = waitForEnd(championship);
    championship.start(startInput());
    const state = await done;

    expect(providerCalls).toBe(3);
    expect(state.phase).toBe('finished');
    expect(state.championModelId).toBe('m2');
    expect(state.championName).toBe('A2');
    expect(state.completedGames).toBe(57);
    expect(state.processedGames).toBe(60);
    expect(state.scheduledGames).toBe(60);

    // qf1: three failures consumed games but awarded no points; the series
    // then fell back to the group ranking at the six-game cap.
    const qf1 = seriesById(state, 'qf1');
    expect(qf1).toMatchObject({
      status: 'finished',
      decision: 'ranking',
      leftWins: 1,
      rightWins: 2,
      leftPoints: 1,
      rightPoints: 2,
      draws: 0,
      failed: 3,
      playedGames: 6,
      maxGames: 6,
      overtime: false,
      extra: false,
      winnerModelId: 'm2',
    });
    const qf1Games = state.games.filter((game) => game.seriesId === 'qf1');
    expect(qf1Games.map((game) => game.gameIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(qf1Games.slice(0, 3).every((game) => game.status === 'failed')).toBe(true);
    expect(qf1Games.slice(0, 3).every((game) => game.failedSide === 'red')).toBe(true);
    expect(qf1Games.slice(3).every((game) => game.status === 'finished')).toBe(true);

    // The other six series were decided by points, not by the failed games.
    for (const id of ['qf2', 'qf3', 'qf4', 'sf1', 'sf2', 'final']) {
      expect(seriesById(state, id)).toMatchObject({
        decision: 'points',
        failed: 0,
        playedGames: 5,
      });
    }

    expect(completions).toHaveLength(60);
    expect(
      completions.filter((completion) => completion.game.status === 'failed'),
    ).toHaveLength(3);
    expect(JSON.stringify(state)).not.toContain('secret-');
  });

  it('rejects concurrent starts and an idle stop, and restarts after finishing', async () => {
    const championship = createChampionship({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
    });

    await expect(championship.stop()).rejects.toThrow(/没有正在运行/);

    const firstDone = waitForEnd(championship);
    const first = championship.start(startInput());
    expect(first.phase).toBe('running');
    expect(() => championship.start(startInput())).toThrow(/正在进行/);

    const firstState = await firstDone;
    expect(firstState.phase).toBe('finished');
    const firstId = firstState.championshipId;
    await expect(championship.stop()).rejects.toThrow(/没有正在运行/);

    const secondDone = waitFor(
      championship,
      (state) => state.phase === 'finished' && state.championshipId !== firstId,
    );
    const second = championship.start(startInput());
    expect(second.phase).toBe('running');
    expect(second.championshipId).not.toBe(firstId);
    expect(second.scheduledGames).toBe(24);
    expect(second.games).toHaveLength(24);
    expect(second.groups.every((group) => group.complete)).toBe(false);
    expect(second.series.every((series) => series.status === 'pending')).toBe(true);

    const secondState = await secondDone;
    expect(secondState.phase).toBe('finished');
    expect(secondState.championshipId).not.toBe(firstId);
    expect(secondState.championModelId).toBe('m2');
  });

  it('starts idle, unsubscribes from state updates and refuses to start after dispose', () => {
    const championship = createChampionship();

    const idle = championship.getState();
    expect(idle).toMatchObject({
      phase: 'idle',
      championshipId: null,
      stage: null,
      currentGameId: null,
      currentSeriesId: null,
      championModelId: null,
      championName: null,
      error: null,
      startedAt: null,
      finishedAt: null,
      scheduledGames: 0,
      processedGames: 0,
      completedGames: 0,
      groupGamesProcessed: 0,
      seriesProcessed: 0,
    });
    expect(idle.groupGamesTotal).toBe(24);
    expect(idle.seriesTotal).toBe(7);
    expect(idle.entrants).toEqual([]);
    expect(idle.groups).toEqual([]);
    expect(idle.series).toEqual([]);
    expect(idle.games).toEqual([]);

    let updates = 0;
    const unsubscribe = championship.onState(() => {
      updates += 1;
    });
    unsubscribe();
    championship.dispose();
    expect(updates).toBe(0);
    expect(() => championship.start(startInput())).toThrow(/服务正在关闭/);
  });

  it('cancels the remaining schedule and reports an error when the run crashes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const championship = createChampionship({
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
    });

    // Simulate an engine bug: the second game crashes before it can start, so
    // the first game is finished and every other scheduled game is canceled.
    const internals = championship as unknown as {
      runGame: (game: unknown, token: number) => Promise<void>;
    };
    const originalRunGame = internals.runGame.bind(championship);
    let calls = 0;
    internals.runGame = async (game, token) => {
      calls += 1;
      if (calls === 2) throw new Error('engine exploded');
      return originalRunGame(game, token);
    };

    const done = waitForEnd(championship);
    championship.start(startInput());
    const state = await done;

    expect(state.phase).toBe('error');
    expect(state.error).toBe('锦标赛内部错误，可继续锦标赛或重新发起');
    expect(state.stage).toBe('group');
    expect(state.championModelId).toBeNull();
    expect(state.championName).toBeNull();
    expect(state.currentGameId).toBeNull();
    expect(state.currentSeriesId).toBeNull();
    expect(state.finishedAt).not.toBeNull();
    expect(state.completedGames).toBe(1);
    expect(state.games.filter((game) => game.status === 'finished')).toHaveLength(1);
    const canceled = state.games.filter((game) => game.status === 'canceled');
    expect(canceled).toHaveLength(23);
    expect(canceled.every((game) => game.error === '锦标赛内部错误，未完成的对局已取消')).toBe(
      true,
    );
    expect(state.processedGames).toBe(24);
    expect(state.scheduledGames).toBe(24);
    expect(state.series).toHaveLength(7);
    expect(state.series.every((series) => series.status === 'stopped')).toBe(true);
    // The crash canceled group games, so no group may be treated as complete.
    expect(state.groups.every((group) => !group.complete)).toBe(true);
    expect(state.groups.every((group) => group.qualifiedModelIds.length === 0)).toBe(true);
    expect(JSON.stringify(state)).not.toContain('secret-');
    expect(consoleError).toHaveBeenCalled();

    // A crashed championship can be restarted from scratch.
    internals.runGame = originalRunGame;
    const crashedId = state.championshipId;
    const retryDone = waitFor(
      championship,
      (next) => next.phase === 'finished' && next.championshipId !== crashedId,
    );
    championship.start(startInput());
    const restarted = await retryDone;
    expect(restarted.phase).toBe('finished');
    expect(restarted.championModelId).toBe('m2');
  });
});

describe('Championship archive hook', () => {
  it('archives a finished edition exactly once', async () => {
    const archives: ChampionshipArchive[] = [];
    const championship = createChampionship({
      providerFactory: () => unusedProvider,
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      onArchive: (archive) => archives.push(archive),
    });

    const done = waitForEnd(championship);
    championship.start(startInput());
    const state = await done;

    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({
      version: 1,
      phase: 'finished',
      championshipId: state.championshipId,
      championModelId: 'm2',
      championName: 'A2',
      completedGames: 59,
      processedGames: 59,
      scheduledGames: 59,
      seriesProcessed: 7,
      seriesTotal: 7,
    });
    expect(archives[0]!.entrantNames).toHaveLength(16);
    expect(JSON.stringify(archives[0])).not.toContain('secret-');
    expect(JSON.stringify(archives[0])).not.toContain('apiKey');
  });

  it('archives a stopped edition without a champion', async () => {
    const archives: ChampionshipArchive[] = [];
    let initialGames = 0;
    const championship = createChampionship({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => {
        initialGames += 1;
        // The group stage is decided at once, then the first knockout game hangs.
        return initialGames <= 24
          ? XiangqiGame.fromFen(MATE_RED_WINS)
          : XiangqiGame.initial();
      },
      onArchive: (archive) => archives.push(archive),
    });

    championship.start(startInput());
    await waitFor(
      championship,
      (state) =>
        state.games.some(
          (game) => game.seriesId === 'qf1' && game.status === 'running',
        ),
    );
    const stopped = await championship.stop();

    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({
      phase: 'stopped',
      championshipId: stopped.championshipId,
      championModelId: null,
      championName: null,
      completedGames: 24,
      processedGames: 25,
      scheduledGames: 25,
    });
    expect(archives[0]!.groups.every((group) => group.complete)).toBe(true);
    expect(stopped.stage).toBe('quarterfinal');
    // The archived snapshot (including the canceled knockout game) also passes
    // the archive store's structural validation.
    expect(parseChampionshipArchive(archives[0]!)).not.toBeNull();
  });

  it('archives an internal error edition with the error message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const archives: ChampionshipArchive[] = [];
    const championship = createChampionship({
      createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
      onArchive: (archive) => archives.push(archive),
    });
    const internals = championship as unknown as {
      runGame: (game: unknown, token: number) => Promise<void>;
    };
    internals.runGame = async () => {
      throw new Error('engine exploded');
    };

    const done = waitForEnd(championship);
    championship.start(startInput());
    const crashed = await done;

    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({
      phase: 'error',
      championshipId: crashed.championshipId,
      error: '锦标赛内部错误，可继续锦标赛或重新发起',
      completedGames: 0,
    });
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
    const championship = createChampionship({
      providerFactory: () => provider,
      checkpointStore: new ChampionshipCheckpointStore({ filePath: checkpointFile }),
      // The first game starts normally; every later board is already terminal.
      createInitialGame: scriptedFactory({ 1: 'fail' }, 'black'),
    });

    championship.start(startInput());
    const paused = await waitFor(championship, (state) => state.phase === 'paused');

    expect(paused.resumable).toBe(true);
    expect(paused.error).toContain('额度不足');
    expect(paused.error).toContain('继续锦标赛');
    expect(paused.currentGameIds).toEqual([]);
    expect(paused.completedGames).toBe(0);
    expect(quotaCalls).toBe(1);

    const saved = parseChampionshipCheckpoint(
      JSON.parse(readFileSync(checkpointFile, 'utf8')) as unknown,
    );
    expect(saved?.phase).toBe('paused');
    expect(saved?.games[0]?.status).toBe('canceled');

    championship.resume();
    const finished = await waitForEnd(championship);

    expect(finished.phase).toBe('finished');
    expect(finished.championModelId).not.toBeNull();
    expect(quotaCalls).toBe(1);
  });

  it('archives an interrupted checkpoint when a new edition replaces it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const checkpointFile = createCheckpointFile();
    const first = createChampionship({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => XiangqiGame.initial(),
      checkpointStore: new ChampionshipCheckpointStore({ filePath: checkpointFile }),
    });
    first.start(startInput());
    await waitFor(first, (state) =>
      state.games.some((game) => game.status === 'running'),
    );
    const interruptedId = first.getState().championshipId;
    first.dispose();

    const archives: ChampionshipArchive[] = [];
    const second = createChampionship({
      providerFactory: () => hangingProvider(),
      createInitialGame: () => XiangqiGame.initial(),
      checkpointStore: new ChampionshipCheckpointStore({ filePath: checkpointFile }),
      onArchive: (archive) => archives.push(archive),
    });
    expect(second.getState().phase).toBe('interrupted');
    second.start(startInput());

    expect(archives).toHaveLength(1);
    expect(archives[0]).toMatchObject({
      phase: 'interrupted',
      championshipId: interruptedId,
      championModelId: null,
      completedGames: 0,
    });
    expect(parseChampionshipArchive(archives[0]!)).not.toBeNull();
    expect(second.getState().championshipId).not.toBe(interruptedId);
    // Starting the fresh edition never re-archives the previous one.
    expect(archives.filter((archive) => archive.championshipId === interruptedId)).toHaveLength(
      1,
    );
  });
});
