import { describe, expect, it } from 'vitest';
import type {
  ChampionshipGameView,
  GameResult,
  TournamentStanding,
} from '../../shared/protocol';
import type { ChampionshipRankingInfo, GroupStandingMember } from './standings';
import {
  compareChampionshipGroupRanking,
  compareChampionshipRanking,
  computeGroupStandings,
  qualifiedModelIds,
} from './standings';

function member(
  id: string,
  seedPool: number,
  inputIndex: number,
): GroupStandingMember {
  return { id, name: id.toUpperCase(), seedPool, inputIndex };
}

function game(
  redModelId: string,
  blackModelId: string,
  winner: 'red' | 'black' | null,
  overrides: Partial<ChampionshipGameView> = {},
): ChampionshipGameView {
  const result: GameResult | null =
    winner === null
      ? { winner: null, reason: 'repetition', text: '和棋' }
      : { winner, reason: 'checkmate', text: winner === 'red' ? '红方胜' : '黑方胜' };

  return {
    id: `g-${redModelId}-${blackModelId}`,
    pairIndex: 1,
    gameIndex: 1,
    redModelId,
    blackModelId,
    redName: redModelId,
    blackName: blackModelId,
    status: 'finished',
    plies: 1,
    winnerModelId:
      winner === 'red' ? redModelId : winner === 'black' ? blackModelId : null,
    result,
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
    stage: 'group',
    groupId: 'A',
    seriesId: null,
    ...overrides,
  };
}

function rows(standings: readonly TournamentStanding[]): unknown[] {
  return standings.map((row) => [
    row.name,
    row.played,
    row.wins,
    row.draws,
    row.losses,
    row.failed,
    row.points,
    row.rank,
  ]);
}

function rankingInfo(
  patch: Partial<ChampionshipRankingInfo> = {},
): ChampionshipRankingInfo {
  return {
    modelId: 'm1',
    rank: 1,
    points: 0,
    wins: 0,
    draws: 0,
    seedPool: 1,
    inputIndex: 0,
    ...patch,
  };
}

describe('computeGroupStandings', () => {
  it('counts wins, draws, losses and awards 3/1/0 points', () => {
    const members = [member('A', 1, 0), member('B', 2, 1), member('C', 3, 2)];
    const games = [
      game('A', 'B', 'red', { redTokensIn: 10, redTokensOut: 3, blackTokensIn: 4 }),
      game('C', 'A', null),
      game('B', 'C', 'black'),
    ];

    const standings = computeGroupStandings(members, games);

    expect(rows(standings)).toEqual([
      ['A', 2, 1, 1, 0, 0, 4, 1],
      ['C', 2, 1, 1, 0, 0, 4, 2],
      ['B', 2, 0, 0, 2, 0, 0, 3],
    ]);
    expect(standings[0]).toMatchObject({
      modelId: 'A',
      redGames: 1,
      blackGames: 1,
      tokensIn: 10,
      tokensOut: 3,
    });
  });

  it('excludes failed games from the table but tallies the failed side', () => {
    const members = [member('A', 1, 0), member('B', 2, 1)];
    const games = [
      game('A', 'B', null, {
        status: 'failed',
        result: null,
        winnerModelId: null,
        failedSide: 'black',
        error: 'HTTP 401',
        redTokensIn: 7,
        blackTokensIn: 2,
      }),
      game('A', 'B', null, {
        status: 'canceled',
        result: null,
        error: '锦标赛提前终止',
        redTokensIn: 99,
        blackTokensIn: 99,
      }),
    ];

    const [a, b] = computeGroupStandings(members, games);
    expect(a).toMatchObject({
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      failed: 0,
      points: 0,
      tokensIn: 7,
    });
    expect(b).toMatchObject({
      played: 0,
      failed: 1,
      points: 0,
      tokensIn: 2,
    });
  });

  it('breaks point ties by head-to-head points before seed pool', () => {
    // A and B both finish on 4 points, but A beat B directly. B has the better
    // seed pool and earlier input index, so only head-to-head can put A first.
    const members = [
      member('A', 3, 2),
      member('B', 1, 0),
      member('C', 2, 1),
      member('D', 4, 3),
    ];
    const games = [
      game('A', 'B', 'red'),
      game('A', 'C', null),
      game('B', 'D', 'red'),
      game('B', 'C', null),
    ];

    const standings = computeGroupStandings(members, games);
    expect(standings.map((row) => [row.name, row.points])).toEqual([
      ['A', 4],
      ['B', 4],
      ['C', 2],
      ['D', 0],
    ]);
    expect(standings.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
  });

  it('ignores failed games when computing head-to-head points', () => {
    const members = [member('A', 2, 0), member('B', 1, 1), member('C', 3, 2)];
    const games = [
      game('A', 'B', null, { status: 'failed', failedSide: 'red', result: null }),
      game('A', 'C', 'red'),
      game('B', 'C', 'red'),
    ];

    const standings = computeGroupStandings(members, games);
    // A and B are tied on 3 points; the failed game is no contest, so the
    // remaining tie-breaks put B's better seed pool first.
    expect(standings.map((row) => row.name)).toEqual(['B', 'A', 'C']);
  });

  it('falls back to lower seed pool and then input order', () => {
    const members = [member('X', 2, 0), member('Y', 1, 1), member('Z', 2, 2)];
    const standings = computeGroupStandings(members, []);

    expect(standings.map((row) => [row.name, row.rank])).toEqual([
      ['Y', 1],
      ['X', 2],
      ['Z', 3],
    ]);
    expect(standings.every((row) => row.played === 0 && row.points === 0)).toBe(true);
  });

  it('exposes the top finishers in order', () => {
    const members = [member('X', 2, 0), member('Y', 1, 1), member('Z', 2, 2)];
    const standings = computeGroupStandings(members, []);

    expect(qualifiedModelIds(standings)).toEqual(['Y', 'X']);
    expect(qualifiedModelIds(standings, 3)).toEqual(['Y', 'X', 'Z']);
  });
});

describe('compareChampionshipRanking', () => {
  it('prefers the better group rank first', () => {
    expect(compareChampionshipRanking(rankingInfo({ rank: 1 }), rankingInfo({ rank: 2 }))).toBeLessThan(0);
    expect(compareChampionshipRanking(rankingInfo({ rank: 2 }), rankingInfo({ rank: 1 }))).toBeGreaterThan(0);
  });

  it('then points, wins and draws', () => {
    const base = rankingInfo();
    expect(compareChampionshipRanking(rankingInfo({ points: 9 }), rankingInfo({ points: 6 }))).toBeLessThan(0);
    expect(
      compareChampionshipRanking(
        rankingInfo({ points: 6, wins: 3 }),
        rankingInfo({ points: 6, wins: 2 }),
      ),
    ).toBeLessThan(0);
    expect(
      compareChampionshipRanking(
        rankingInfo({ wins: 0, draws: 2 }),
        rankingInfo({ wins: 0, draws: 1 }),
      ),
    ).toBeLessThan(0);
    expect(compareChampionshipRanking(base, rankingInfo())).toBe(0);
  });

  it('then lower seed pool and finally input order', () => {
    expect(
      compareChampionshipRanking(
        rankingInfo({ seedPool: 1, inputIndex: 5 }),
        rankingInfo({ seedPool: 2, inputIndex: 0 }),
      ),
    ).toBeLessThan(0);
    expect(
      compareChampionshipRanking(
        rankingInfo({ seedPool: 2, inputIndex: 0 }),
        rankingInfo({ seedPool: 2, inputIndex: 4 }),
      ),
    ).toBeLessThan(0);
  });
});

describe('compareChampionshipGroupRanking', () => {
  it('prefers the better group rank first', () => {
    expect(
      compareChampionshipGroupRanking(rankingInfo({ rank: 1 }), rankingInfo({ rank: 2 })),
    ).toBeLessThan(0);
    expect(
      compareChampionshipGroupRanking(rankingInfo({ rank: 2 }), rankingInfo({ rank: 1 })),
    ).toBeGreaterThan(0);
  });

  it('then points, wins, draws and seed pool', () => {
    expect(
      compareChampionshipGroupRanking(
        rankingInfo({ points: 9 }),
        rankingInfo({ points: 6 }),
      ),
    ).toBeLessThan(0);
    expect(
      compareChampionshipGroupRanking(
        rankingInfo({ points: 6, wins: 3 }),
        rankingInfo({ points: 6, wins: 2 }),
      ),
    ).toBeLessThan(0);
    expect(
      compareChampionshipGroupRanking(
        rankingInfo({ wins: 0, draws: 2 }),
        rankingInfo({ wins: 0, draws: 1 }),
      ),
    ).toBeLessThan(0);
    expect(
      compareChampionshipGroupRanking(
        rankingInfo({ seedPool: 1 }),
        rankingInfo({ seedPool: 2 }),
      ),
    ).toBeLessThan(0);
  });

  it('ignores input order and returns 0 for an exact pedigree tie', () => {
    // The final input-order tie-break is deliberately excluded at the six-game
    // cap; identical pedigrees force extra games instead.
    expect(
      compareChampionshipGroupRanking(
        rankingInfo({ inputIndex: 0 }),
        rankingInfo({ inputIndex: 7 }),
      ),
    ).toBe(0);
    expect(
      compareChampionshipGroupRanking(
        rankingInfo({ rank: 1, points: 6, wins: 2, draws: 0, seedPool: 1, inputIndex: 3 }),
        rankingInfo({ rank: 1, points: 6, wins: 2, draws: 0, seedPool: 1, inputIndex: 9 }),
      ),
    ).toBe(0);
  });
});
