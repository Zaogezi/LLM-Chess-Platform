import { describe, expect, it } from 'vitest';
import type { ChampionshipGameView, ChampionshipGroupId } from '../../shared/protocol';
import {
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_SERIES_GAME_LIMIT,
} from '../../shared/protocol';
import {
  KNOCKOUT_SERIES_BLUEPRINT,
  buildGroupGames,
  createSeriesSkeleton,
  seriesLabel,
} from './schedule';

function canonicalGroup(id: ChampionshipGroupId) {
  return {
    id,
    members: [1, 2, 3, 4].map((pool) => ({
      id: `${id}${pool}`,
      name: `${id}${pool}`,
      seedPool: pool,
    })),
  };
}

function seedOf(modelId: string): number {
  return Number(modelId.slice(1));
}

const groups = CHAMPIONSHIP_GROUPS.map(canonicalGroup);

function pairKey(game: ChampionshipGameView): string {
  return `${game.groupId}:${game.pairIndex}`;
}

describe('buildGroupGames', () => {
  it('schedules 24 single-round-robin group games upfront', () => {
    const games = buildGroupGames(groups);

    expect(games).toHaveLength(24);
    expect(new Set(games.map((game) => game.id)).size).toBe(24);
    expect(games.map((game) => game.id)).toEqual(
      Array.from({ length: 24 }, (_, index) => `g${index + 1}`),
    );
    expect(
      games.every(
        (game) =>
          game.status === 'scheduled' &&
          game.stage === 'group' &&
          game.seriesId === null &&
          game.groupId !== null &&
          game.gameIndex === 1 &&
          game.result === null &&
          game.winnerModelId === null &&
          game.startedAt === null,
      ),
    ).toBe(true);
    for (const groupId of CHAMPIONSHIP_GROUPS) {
      expect(games.filter((game) => game.groupId === groupId)).toHaveLength(6);
    }
  });

  it('plays every pair once, with pair indexes 1..6 in each group', () => {
    const games = buildGroupGames(groups);
    const pairs = new Map<string, ChampionshipGameView[]>();
    for (const game of games) {
      const key = pairKey(game);
      pairs.set(key, [...(pairs.get(key) ?? []), game]);
    }

    expect(pairs.size).toBe(24);
    for (const pairGames of pairs.values()) {
      expect(pairGames).toHaveLength(1);
    }

    for (const groupId of CHAMPIONSHIP_GROUPS) {
      const pairIndexes = games
        .filter((game) => game.groupId === groupId)
        .map((game) => game.pairIndex);
      expect(pairIndexes).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  it('splits colours 1–2 red games per seed while every pair has one red', () => {
    const games = buildGroupGames(groups);
    for (const game of games) {
      expect(game.redModelId).not.toBe(game.blackModelId);
      expect(game.redName).toBe(game.redModelId);
      expect(game.blackName).toBe(game.blackModelId);
    }

    for (const groupId of CHAMPIONSHIP_GROUPS) {
      const groupGames = games.filter((game) => game.groupId === groupId);
      for (let pool = 1; pool <= 4; pool += 1) {
        const id = `${groupId}${pool}`;
        const reds = groupGames.filter((game) => game.redModelId === id).length;
        const blacks = groupGames.filter((game) => game.blackModelId === id).length;
        expect(reds + blacks).toBe(3);
        expect(reds).toBe(pool === 1 || pool === 4 ? 1 : 2);
      }
    }
  });

  it('derives the pairings and colours from seed pools, not member list order', () => {
    const shuffled = [
      {
        id: 'A' as const,
        members: [
          { id: 'A4', name: 'A4', seedPool: 4 },
          { id: 'A1', name: 'A1', seedPool: 1 },
          { id: 'A3', name: 'A3', seedPool: 3 },
          { id: 'A2', name: 'A2', seedPool: 2 },
        ],
      },
    ];
    const games = buildGroupGames(shuffled);

    expect(games).toHaveLength(6);
    expect(
      games.map((game) => [
        game.pairIndex,
        game.redModelId,
        game.blackModelId,
        seedOf(game.redModelId),
      ]),
    ).toEqual([
      [1, 'A1', 'A4', 1],
      [2, 'A2', 'A3', 2],
      [3, 'A3', 'A1', 3],
      [4, 'A4', 'A2', 4],
      [5, 'A2', 'A1', 2],
      [6, 'A3', 'A4', 3],
    ]);
  });
});

describe('createSeriesSkeleton', () => {
  it('uses the same six-game, three-point format for every round', () => {
    const series = createSeriesSkeleton();

    expect(series).toHaveLength(7);
    expect(series.map((node) => node.id)).toEqual([
      'qf1',
      'qf2',
      'qf3',
      'qf4',
      'sf1',
      'sf2',
      'final',
    ]);
    expect(series.map((node) => node.stage)).toEqual([
      'quarterfinal',
      'quarterfinal',
      'quarterfinal',
      'quarterfinal',
      'semifinal',
      'semifinal',
      'final',
    ]);
    expect(series.map((node) => node.slot)).toEqual([1, 2, 3, 4, 1, 2, 1]);
    expect(series.map((node) => node.label)).toEqual([
      '八强赛 1',
      '八强赛 2',
      '八强赛 3',
      '八强赛 4',
      '半决赛 1',
      '半决赛 2',
      '决赛',
    ]);
    expect(
      series.every((node) => node.maxGames === CHAMPIONSHIP_SERIES_GAME_LIMIT),
    ).toBe(true);
    for (const node of series) {
      expect(node).toMatchObject({
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
        overtime: false,
        extra: false,
        winnerModelId: null,
        decision: null,
      });
    }
  });

  it('matches the blueprint order and shared id/list constants', () => {
    expect(KNOCKOUT_SERIES_BLUEPRINT).toHaveLength(7);
    expect(seriesLabel('quarterfinal', 3)).toBe('八强赛 3');
    expect(seriesLabel('semifinal', 2)).toBe('半决赛 2');
    expect(seriesLabel('final', 1)).toBe('决赛');
  });
});
