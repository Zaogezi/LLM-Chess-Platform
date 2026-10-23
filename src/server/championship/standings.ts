import type {
  ChampionshipGameView,
  TournamentStanding,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_QUALIFIERS_PER_GROUP,
  TOURNAMENT_POINTS,
} from '../../shared/protocol';

/** The per-group metadata needed to resolve every tie-break in the rules. */
export interface GroupStandingMember {
  id: string;
  name: string;
  /** 1–4; lower is the higher seed. */
  seedPool: number;
  /** Position in the validated entrant list; lower wins the final tie-break. */
  inputIndex: number;
}

/** Everything needed to decide which of two knockout entrants ranks higher. */
export interface ChampionshipRankingInfo {
  modelId: string;
  /** 1-based rank inside the entrant's group (1 is best). */
  rank: number;
  points: number;
  wins: number;
  draws: number;
  seedPool: number;
  inputIndex: number;
}

type InternalRow = TournamentStanding & {
  seedPool: number;
  inputIndex: number;
};

function createRow(member: GroupStandingMember): InternalRow {
  return {
    rank: 0,
    modelId: member.id,
    name: member.name,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    failed: 0,
    points: 0,
    redGames: 0,
    blackGames: 0,
    tokensIn: 0,
    tokensOut: 0,
    seedPool: member.seedPool,
    inputIndex: member.inputIndex,
  };
}

function addTokens(row: InternalRow, tokensIn: number, tokensOut: number): void {
  row.tokensIn += tokensIn;
  row.tokensOut += tokensOut;
}

function accumulateGames(
  rows: Map<string, InternalRow>,
  games: readonly ChampionshipGameView[],
): void {
  for (const game of games) {
    const red = rows.get(game.redModelId);
    const black = rows.get(game.blackModelId);
    if (!red || !black) continue;

    if (game.status === 'failed') {
      // A broken API is reported separately; it is never a chess loss.
      const failed =
        game.failedSide === 'red' ? red : game.failedSide === 'black' ? black : null;
      if (failed) failed.failed += 1;
      addTokens(red, game.redTokensIn, game.redTokensOut);
      addTokens(black, game.blackTokensIn, game.blackTokensOut);
      continue;
    }

    if (game.status !== 'finished' || !game.result) continue;

    red.played += 1;
    black.played += 1;
    red.redGames += 1;
    black.blackGames += 1;
    addTokens(red, game.redTokensIn, game.redTokensOut);
    addTokens(black, game.blackTokensIn, game.blackTokensOut);

    if (game.result.winner === 'red') {
      red.wins += 1;
      black.losses += 1;
    } else if (game.result.winner === 'black') {
      black.wins += 1;
      red.losses += 1;
    } else {
      red.draws += 1;
      black.draws += 1;
    }
  }
}

function pointsFor(row: InternalRow): number {
  return row.wins * TOURNAMENT_POINTS.win + row.draws * TOURNAMENT_POINTS.draw;
}

/** Points each block member collected in games against the other tied members. */
function headToHeadPoints(
  block: readonly InternalRow[],
  games: readonly ChampionshipGameView[],
): Map<string, number> {
  const ids = new Set(block.map((row) => row.modelId));
  const points = new Map<string, number>(block.map((row) => [row.modelId, 0]));

  for (const game of games) {
    if (game.status !== 'finished' || !game.result) continue;
    if (!ids.has(game.redModelId) || !ids.has(game.blackModelId)) continue;

    if (game.result.winner === 'red') {
      points.set(game.redModelId, (points.get(game.redModelId) ?? 0) + TOURNAMENT_POINTS.win);
    } else if (game.result.winner === 'black') {
      points.set(
        game.blackModelId,
        (points.get(game.blackModelId) ?? 0) + TOURNAMENT_POINTS.win,
      );
    } else {
      points.set(game.redModelId, (points.get(game.redModelId) ?? 0) + TOURNAMENT_POINTS.draw);
      points.set(
        game.blackModelId,
        (points.get(game.blackModelId) ?? 0) + TOURNAMENT_POINTS.draw,
      );
    }
  }

  return points;
}

/**
 * Rank the members of one group. Only adjudicated games count towards the
 * table; failed games are tallied separately and canceled games are ignored.
 *
 * Tie-breaks: points, then head-to-head points among the tied block, then wins,
 * draws, lower seed pool, and finally the entrant's input order.
 */
export function computeGroupStandings(
  members: readonly GroupStandingMember[],
  games: readonly ChampionshipGameView[],
): TournamentStanding[] {
  const rows = new Map<string, InternalRow>(
    members.map((member) => [member.id, createRow(member)]),
  );

  accumulateGames(rows, games);
  for (const row of rows.values()) row.points = pointsFor(row);

  const sorted = [...rows.values()].sort((a, b) => b.points - a.points);
  const ranked: InternalRow[] = [];
  let index = 0;
  while (index < sorted.length) {
    const blockPoints = sorted[index]!.points;
    let end = index + 1;
    while (end < sorted.length && sorted[end]!.points === blockPoints) end += 1;

    const block = sorted.slice(index, end);
    if (block.length > 1) {
      const headToHead = headToHeadPoints(block, games);
      block.sort(
        (a, b) =>
          (headToHead.get(b.modelId) ?? 0) - (headToHead.get(a.modelId) ?? 0) ||
          b.wins - a.wins ||
          b.draws - a.draws ||
          a.seedPool - b.seedPool ||
          a.inputIndex - b.inputIndex,
      );
    }
    ranked.push(...block);
    index = end;
  }

  return ranked.map((row, position) => ({
    rank: position + 1,
    modelId: row.modelId,
    name: row.name,
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    failed: row.failed,
    points: row.points,
    redGames: row.redGames,
    blackGames: row.blackGames,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
  }));
}

/** Top finishers of a finished group, in order (defaults to the top two). */
export function qualifiedModelIds(
  standings: readonly TournamentStanding[],
  count: number = CHAMPIONSHIP_QUALIFIERS_PER_GROUP,
): string[] {
  return standings.slice(0, count).map((row) => row.modelId);
}

/**
 * Compare two knockout entrants by their group-phase pedigree. Negative means
 * `left` ranks higher and therefore takes red on odd games and wins a series
 * that hits its stage game cap without a decisive result.
 */
export function compareChampionshipRanking(
  left: ChampionshipRankingInfo,
  right: ChampionshipRankingInfo,
): number {
  return (
    left.rank - right.rank ||
    right.points - left.points ||
    right.wins - left.wins ||
    right.draws - left.draws ||
    left.seedPool - right.seedPool ||
    left.inputIndex - right.inputIndex
  );
}

/**
 * Compare two knockout entrants for the six-game cap. This is the documented
 * "group-stage ranking" used to break an undecided series: rank, points, wins,
 * draws, seed pool — deliberately WITHOUT the final input-order tie-break.
 * Returns 0 when the two entrants are still exactly equal, which is the only
 * case that forces extra games past the cap.
 */
export function compareChampionshipGroupRanking(
  left: ChampionshipRankingInfo,
  right: ChampionshipRankingInfo,
): number {
  return (
    left.rank - right.rank ||
    right.points - left.points ||
    right.wins - left.wins ||
    right.draws - left.draws ||
    left.seedPool - right.seedPool
  );
}
