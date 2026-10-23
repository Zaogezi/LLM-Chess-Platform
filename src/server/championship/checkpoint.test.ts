import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  ChampionshipGameView,
  ChampionshipGroupId,
  ChampionshipSeriesView,
} from '../../shared/protocol';
import { CHAMPIONSHIP_GROUPS } from '../../shared/protocol';
import {
  ChampionshipCheckpointStore,
  parseChampionshipCheckpoint,
  type ChampionshipCheckpoint,
  type ChampionshipCheckpointEntrant,
} from './checkpoint';
import { buildGroupGames, createSeriesSkeleton } from './schedule';

const GROUP_IDS: readonly ChampionshipGroupId[] = CHAMPIONSHIP_GROUPS;
const ENTRANT_NAMES = GROUP_IDS.flatMap((groupId) =>
  [1, 2, 3, 4].map((pool) => `${groupId}${pool}`),
);

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryFile(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'xiangqi-checkpoint-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'championship.json');
}

function entrant(name: string, index: number): ChampionshipCheckpointEntrant {
  return {
    id: `m${index + 1}`,
    name,
    seedPool: Number(name.slice(1)),
    groupId: name.slice(0, 1) as ChampionshipGroupId,
    setup: {
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      model: `${name.toLocaleLowerCase()}-model`,
      apiKey: `secret-${name}`,
      thinkingLevel: 'quick',
      apiReasoning: false,
    },
  };
}

const ENTRANTS = ENTRANT_NAMES.map(entrant);

function groupGames(): ChampionshipGameView[] {
  const indexByName = new Map(ENTRANTS.map((item, index) => [item.name, index]));
  return buildGroupGames(
    GROUP_IDS.map((groupId) => ({
      id: groupId,
      members: [1, 2, 3, 4].map((pool) => {
        const name = `${groupId}${pool}`;
        return {
          id: `m${(indexByName.get(name) ?? 0) + 1}`,
          name,
          seedPool: pool,
        };
      }),
    })),
  );
}

function checkpoint(overrides: Partial<ChampionshipCheckpoint> = {}): ChampionshipCheckpoint {
  return {
    version: 2,
    savedAt: 1_700_000_000_000,
    championshipId: 'championship-1',
    phase: 'running',
    stage: 'group',
    startedAt: 1_699_999_000_000,
    finishedAt: null,
    error: null,
    entrants: ENTRANTS,
    games: groupGames(),
    series: createSeriesSkeleton(),
    ...overrides,
  };
}

function asJson(checkpointValue: ChampionshipCheckpoint): unknown {
  return JSON.parse(JSON.stringify(checkpointValue)) as unknown;
}

function oldSeriesSkeleton(): unknown[] {
  return createSeriesSkeleton().map((series) => ({
    id: series.id,
    stage: series.stage,
    label: series.label,
    slot: series.slot,
    status: 'pending',
    left: null,
    right: null,
    leftWins: 0,
    rightWins: 0,
    draws: 0,
    failed: 0,
    playedGames: 0,
    // The old BO3/BO5 format had stage-dependent caps; v1 migration ignores it.
    maxGames: series.stage === 'final' ? 10 : 6,
    winnerModelId: null,
    decision: null,
  }));
}

function legacyV1(overrides: Record<string, unknown> = {}): unknown {
  const modern = checkpoint();
  return {
    version: 1,
    savedAt: modern.savedAt,
    championshipId: modern.championshipId,
    phase: 'running',
    stage: 'group',
    startedAt: modern.startedAt,
    finishedAt: null,
    error: null,
    entrants: modern.entrants,
    games: modern.games,
    series: oldSeriesSkeleton(),
    ...overrides,
  };
}

function knockoutGames(
  series: ChampionshipSeriesView,
  entrantIds: readonly [string, string],
): ChampionshipGameView[] {
  const [leftId, rightId] = entrantIds;
  const leftName = ENTRANTS.find((item) => item.id === leftId)!.name;
  const rightName = ENTRANTS.find((item) => item.id === rightId)!.name;
  return Array.from({ length: 5 }, (_, index) => {
    const gameIndex = index + 1;
    const leftIsRed = gameIndex % 2 === 1;
    return {
      id: `g${24 + gameIndex}`,
      pairIndex: series.slot,
      gameIndex,
      redModelId: leftIsRed ? leftId : rightId,
      blackModelId: leftIsRed ? rightId : leftId,
      redName: leftIsRed ? leftName : rightName,
      blackName: leftIsRed ? rightName : leftName,
      status: 'finished' as const,
      plies: 10,
      winnerModelId: leftIsRed ? leftId : rightId,
      result: {
        winner: (leftIsRed ? 'red' : 'black') as 'red' | 'black',
        reason: 'checkmate' as const,
        text: '红方将死黑方',
      },
      error: null,
      failedSide: null,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      tokensIn: 0,
      tokensOut: 0,
      redTokensIn: 0,
      redTokensOut: 0,
      blackTokensIn: 0,
      blackTokensOut: 0,
      stage: series.stage,
      groupId: null,
      seriesId: series.id,
    };
  });
}

describe('parseChampionshipCheckpoint (v2)', () => {
  it('round-trips a valid version-2 checkpoint', () => {
    const parsed = parseChampionshipCheckpoint(asJson(checkpoint()));

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      version: 2,
      championshipId: 'championship-1',
      phase: 'running',
      stage: 'group',
      startedAt: 1_699_999_000_000,
    });
    expect(parsed?.entrants).toHaveLength(16);
    expect(parsed?.games).toHaveLength(24);
    expect(parsed?.series).toHaveLength(7);
    expect(parsed?.series.every((series) => series.maxGames === 6)).toBe(true);
    expect(parsed?.series.every((series) => !series.overtime && !series.extra)).toBe(true);
    expect(parsed?.entrants[0]?.setup.apiKey).toBe('secret-A1');
  });

  it('round-trips the concurrency setting and treats old files as serial', () => {
    const parsed = parseChampionshipCheckpoint(asJson(checkpoint({ concurrency: 4 })));
    expect(parsed?.concurrency).toBe(4);

    const legacy = parseChampionshipCheckpoint(asJson(checkpoint()));
    expect(legacy).not.toBeNull();
    expect(legacy?.concurrency).toBeUndefined();
  });

  it('accepts a finished points series rebuilt from its game rows', () => {
    const skeleton = createSeriesSkeleton();
    const qf1 = skeleton.find((series) => series.id === 'qf1')!;
    qf1.status = 'finished';
    qf1.left = { modelId: 'm2', name: 'A2' };
    qf1.right = { modelId: 'm7', name: 'B3' };
    qf1.leftWins = 3;
    qf1.rightWins = 2;
    qf1.leftPoints = 3;
    qf1.rightPoints = 2;
    qf1.playedGames = 5;
    qf1.winnerModelId = 'm2';
    qf1.decision = 'points';

    const parsed = parseChampionshipCheckpoint(
      asJson(
        checkpoint({
          phase: 'stopped',
          stage: 'quarterfinal',
          games: [...groupGames(), ...knockoutGames(qf1, ['m2', 'm7'])],
          series: skeleton,
        }),
      ),
    );

    expect(parsed).not.toBeNull();
    const parsedQf1 = parsed?.series.find((series) => series.id === 'qf1');
    expect(parsedQf1).toMatchObject({
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
  });

  it('accepts extra games only when the extra flag explains them', () => {
    const skeleton = createSeriesSkeleton();
    const sf1 = skeleton.find((series) => series.id === 'sf1')!;
    // Six draws plus one decisive extra game: 4:3 on points, overtime winner.
    sf1.status = 'finished';
    sf1.left = { modelId: 'm1', name: 'A1' };
    sf1.right = { modelId: 'm9', name: 'C1' };
    sf1.leftWins = 1;
    sf1.rightWins = 0;
    sf1.draws = 6;
    sf1.leftPoints = 7;
    sf1.rightPoints = 6;
    sf1.playedGames = 7;
    sf1.maxGames = 6;
    sf1.overtime = true;
    sf1.extra = true;
    sf1.winnerModelId = 'm1';
    sf1.decision = 'overtime';

    const withExtra = parseChampionshipCheckpoint(
      asJson(
        checkpoint({
          phase: 'stopped',
          stage: 'semifinal',
          series: skeleton,
        }),
      ),
    );
    expect(withExtra).not.toBeNull();

    sf1.extra = false;
    const withoutExtra = parseChampionshipCheckpoint(
      asJson(
        checkpoint({
          phase: 'stopped',
          stage: 'semifinal',
          series: skeleton,
        }),
      ),
    );
    expect(withoutExtra).toBeNull();
  });

  it('rejects an unknown schema version', () => {
    expect(parseChampionshipCheckpoint(asJson(checkpoint({ version: 3 as never })))).toBeNull();
  });

  it.each([
    ['wrong series cap', { maxGames: 10 }],
    ['negative points', { leftPoints: -1 }],
    ['inconsistent played count', { playedGames: 2 }],
    ['inconsistent points', { leftPoints: 2 }],
    ['old wins decision', { decision: 'wins' }],
    ['overtime below target', { overtime: true }],
    ['non-boolean extra', { extra: 'yes' }],
  ])('rejects a malformed v2 series (%s)', (_label, patch) => {
    const skeleton = createSeriesSkeleton();
    Object.assign(skeleton[0]!, {
      left: { modelId: 'm1', name: 'A1' },
      right: { modelId: 'm2', name: 'A2' },
      ...patch,
    });
    expect(
      parseChampionshipCheckpoint(
        asJson(checkpoint({ phase: 'stopped', stage: 'quarterfinal', series: skeleton })),
      ),
    ).toBeNull();
  });

  it('rejects checkpoints missing the full group schedule', () => {
    const games = groupGames().slice(0, 23);
    expect(parseChampionshipCheckpoint(asJson(checkpoint({ games })))).toBeNull();
  });
});

describe('parseChampionshipCheckpoint (v1 migration)', () => {
  it('migrates a group-only version-1 checkpoint to a fresh v2 bracket', () => {
    const parsed = parseChampionshipCheckpoint(legacyV1());

    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe(2);
    expect(parsed?.championshipId).toBe('championship-1');
    expect(parsed?.entrants).toHaveLength(16);
    expect(parsed?.games).toHaveLength(24);
    expect(parsed?.games.every((game) => game.stage === 'group')).toBe(true);
    expect(parsed?.series).toHaveLength(7);
    for (const series of parsed?.series ?? []) {
      expect(series).toMatchObject({
        status: 'pending',
        left: null,
        right: null,
        leftWins: 0,
        rightWins: 0,
        leftPoints: 0,
        rightPoints: 0,
        draws: 0,
        failed: 0,
        playedGames: 0,
        maxGames: 6,
        overtime: false,
        extra: false,
        winnerModelId: null,
        decision: null,
      });
    }
  });

  it('rejects a v1 checkpoint that already has knockout games', () => {
    const skeleton = createSeriesSkeleton();
    const qf1 = skeleton.find((series) => series.id === 'qf1')!;
    const knockout = knockoutGames(
      { ...qf1, left: { modelId: 'm2', name: 'A2' }, right: { modelId: 'm7', name: 'B3' } },
      ['m2', 'm7'],
    );
    const input = legacyV1() as Record<string, unknown>;
    input.games = [...groupGames(), ...knockout];
    expect(parseChampionshipCheckpoint(input)).toBeNull();
  });

  it('rejects a v1 checkpoint whose series are no longer pending', () => {
    const input = legacyV1() as Record<string, unknown>;
    const series = oldSeriesSkeleton();
    (series[0] as Record<string, unknown>).status = 'stopped';
    input.series = series;
    expect(parseChampionshipCheckpoint(input)).toBeNull();
  });

  it('rejects a v1 checkpoint with non-zero series counters', () => {
    const input = legacyV1() as Record<string, unknown>;
    const series = oldSeriesSkeleton();
    (series[0] as Record<string, unknown>).playedGames = 1;
    input.series = series;
    expect(parseChampionshipCheckpoint(input)).toBeNull();
  });
});

describe('ChampionshipCheckpointStore', () => {
  it('writes version 2 atomically and reloads it', () => {
    const filePath = temporaryFile();
    const store = new ChampionshipCheckpointStore({ filePath });
    expect(store.has()).toBe(false);

    expect(store.save(checkpoint())).toBe(true);
    const onDisk = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    expect(onDisk.version).toBe(2);
    expect(JSON.stringify(onDisk)).toContain('secret-A1');

    const reloaded = new ChampionshipCheckpointStore({ filePath });
    expect(reloaded.has()).toBe(true);
    expect(reloaded.load()).toMatchObject({
      version: 2,
      championshipId: 'championship-1',
    });

    reloaded.clear();
    expect(new ChampionshipCheckpointStore({ filePath }).has()).toBe(false);
  });

  it('ignores malformed files and incompatible v1 checkpoints', () => {
    const malformed = temporaryFile();
    writeFileSync(malformed, '{"version":2,"entrants":oops}', 'utf8');
    expect(new ChampionshipCheckpointStore({ filePath: malformed }).has()).toBe(false);

    const incompatible = temporaryFile();
    const input = legacyV1() as Record<string, unknown>;
    const series = oldSeriesSkeleton();
    (series[0] as Record<string, unknown>).status = 'finished';
    input.series = series;
    writeFileSync(incompatible, JSON.stringify(input), 'utf8');
    expect(new ChampionshipCheckpointStore({ filePath: incompatible }).has()).toBe(false);
  });

  it('migrates a group-only v1 file when the store boots', () => {
    const filePath = temporaryFile();
    writeFileSync(filePath, JSON.stringify(legacyV1()), 'utf8');
    const store = new ChampionshipCheckpointStore({ filePath });
    expect(store.has()).toBe(true);
    expect(store.load()?.version).toBe(2);
  });
});
