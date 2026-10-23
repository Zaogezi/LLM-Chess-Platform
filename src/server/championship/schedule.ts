import type {
  ChampionshipGameView,
  ChampionshipGroupId,
  ChampionshipKnockoutStage,
  ChampionshipSeriesView,
  ChampionshipStage,
} from '../../shared/protocol';
import { championshipSeriesGameLimit } from '../../shared/protocol';

export type { ChampionshipKnockoutStage } from '../../shared/protocol';

/** Everything needed to create a fresh, not-yet-played championship game. */
export interface ChampionshipGameSeed {
  id: string;
  pairIndex: number;
  gameIndex: number;
  stage: ChampionshipStage;
  groupId: ChampionshipGroupId | null;
  seriesId: string | null;
  redId: string;
  redName: string;
  blackId: string;
  blackName: string;
}

/** One entrant inside a group, in table order. */
export interface GroupScheduleMember {
  id: string;
  name: string;
  /** 1–4; lower is the higher seed. */
  seedPool: number;
}

/** A group and its four members, in the order used for pairing numbers. */
export interface GroupSchedule {
  id: ChampionshipGroupId;
  members: readonly GroupScheduleMember[];
}

/** One bracket node. The ids never change so the client can key off them. */
export interface KnockoutSeriesSeed {
  id: string;
  stage: ChampionshipKnockoutStage;
  /** 1-based position inside the stage. */
  slot: number;
}

/** The seven bracket nodes, in bracket order (QF 1–4, SF 1–2, final). */
export const KNOCKOUT_SERIES_BLUEPRINT: readonly KnockoutSeriesSeed[] = [
  { id: 'qf1', stage: 'quarterfinal', slot: 1 },
  { id: 'qf2', stage: 'quarterfinal', slot: 2 },
  { id: 'qf3', stage: 'quarterfinal', slot: 3 },
  { id: 'qf4', stage: 'quarterfinal', slot: 4 },
  { id: 'sf1', stage: 'semifinal', slot: 1 },
  { id: 'sf2', stage: 'semifinal', slot: 2 },
  { id: 'final', stage: 'final', slot: 1 },
];

/** Public label shown in the bracket, e.g. `八强赛 1`, `半决赛 2`, `决赛`. */
export function seriesLabel(stage: ChampionshipKnockoutStage, slot: number): string {
  switch (stage) {
    case 'quarterfinal':
      return `八强赛 ${slot}`;
    case 'semifinal':
      return `半决赛 ${slot}`;
    case 'final':
      return '决赛';
  }
}

/** Build a scheduled game view with every counter at zero. */
export function createGameView(seed: ChampionshipGameSeed): ChampionshipGameView {
  return {
    id: seed.id,
    pairIndex: seed.pairIndex,
    gameIndex: seed.gameIndex,
    redModelId: seed.redId,
    blackModelId: seed.blackId,
    redName: seed.redName,
    blackName: seed.blackName,
    status: 'scheduled',
    plies: 0,
    winnerModelId: null,
    result: null,
    error: null,
    failedSide: null,
    startedAt: null,
    finishedAt: null,
    durationMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    redTokensIn: 0,
    redTokensOut: 0,
    blackTokensIn: 0,
    blackTokensOut: 0,
    stage: seed.stage,
    groupId: seed.groupId,
    seriesId: seed.seriesId,
  };
}

/**
 * Single round-robin recipe for four seeded players. Every pair meets once.
 * Reds are distributed so two players get two red games and two get one
 * (3 games per player makes a perfectly even split impossible).
 */
const SINGLE_ROUND_ROBIN: ReadonlyArray<{
  leftSeed: number;
  rightSeed: number;
  redSeed: number;
}> = [
  { leftSeed: 1, rightSeed: 4, redSeed: 1 },
  { leftSeed: 2, rightSeed: 3, redSeed: 2 },
  { leftSeed: 1, rightSeed: 3, redSeed: 3 },
  { leftSeed: 2, rightSeed: 4, redSeed: 4 },
  { leftSeed: 1, rightSeed: 2, redSeed: 2 },
  { leftSeed: 3, rightSeed: 4, redSeed: 3 },
];

/**
 * Schedule the whole group phase upfront: one round-robin inside every group,
 * i.e. 6 pairings × 1 game = 6 games per group and 24 in total.
 *
 * Games are appended group by group, so ids run g1…g24 and the pair index is
 * scoped to the group (1…6). The recipe gives each of the four seeds one or two
 * red games while preserving one red side per pairing.
 */
export function buildGroupGames(groups: readonly GroupSchedule[]): ChampionshipGameView[] {
  const games: ChampionshipGameView[] = [];

  for (const group of groups) {
    const bySeed = new Map(
      group.members.map((member) => [member.seedPool, member] as const),
    );
    for (let pairIndex = 1; pairIndex <= SINGLE_ROUND_ROBIN.length; pairIndex += 1) {
      const recipe = SINGLE_ROUND_ROBIN[pairIndex - 1]!;
      const left = bySeed.get(recipe.leftSeed);
      const right = bySeed.get(recipe.rightSeed);
      if (!left || !right) {
        throw new Error(`小组 ${group.id} 缺少第 ${recipe.leftSeed} 或 ${recipe.rightSeed} 种子池选手`);
      }
      const red = recipe.redSeed === recipe.leftSeed ? left : right;
      const black = red === left ? right : left;
      games.push(
        createGameView({
          id: `g${games.length + 1}`,
          pairIndex,
          gameIndex: 1,
          stage: 'group',
          groupId: group.id,
          seriesId: null,
          redId: red.id,
          redName: red.name,
          blackId: black.id,
          blackName: black.name,
        }),
      );
    }
  }

  return games;
}

/** Create one bracket node. Both sides stay null until the feeder rounds are known. */
export function createSeriesView(
  id: string,
  stage: ChampionshipKnockoutStage,
  slot: number,
): ChampionshipSeriesView {
  return {
    id,
    stage,
    label: seriesLabel(stage, slot),
    slot,
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
    maxGames: championshipSeriesGameLimit(stage),
    overtime: false,
    extra: false,
    winnerModelId: null,
    decision: null,
  };
}

/** All seven bracket nodes, always present so the bracket layout never jumps. */
export function createSeriesSkeleton(): ChampionshipSeriesView[] {
  return KNOCKOUT_SERIES_BLUEPRINT.map((node) =>
    createSeriesView(node.id, node.stage, node.slot),
  );
}
