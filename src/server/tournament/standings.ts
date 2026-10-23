import type {
  TournamentGameView,
  TournamentModelView,
  TournamentStanding,
} from '../../shared/protocol';
import { TOURNAMENT_POINTS } from '../../shared/protocol';

/**
 * Build the live round-robin table. Only adjudicated games contribute to
 * wins/draws/losses and points; API failures are reported separately so a
 * broken key cannot masquerade as a chess loss.
 *
 * Tie-breaks: points, wins, draws, then the entrant's original input order.
 */
export function computeStandings(
  models: readonly TournamentModelView[],
  games: readonly TournamentGameView[],
): TournamentStanding[] {
  const order = new Map(models.map((model, index) => [model.id, index]));
  const rows = new Map<string, TournamentStanding>(
    models.map((model) => [
      model.id,
      {
        rank: 0,
        modelId: model.id,
        name: model.name,
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
      },
    ]),
  );

  for (const game of games) {
    const red = rows.get(game.redModelId);
    const black = rows.get(game.blackModelId);
    if (!red || !black) continue;

    if (game.status === 'failed') {
      const failed = game.failedSide === 'red' ? red : game.failedSide === 'black' ? black : null;
      if (failed) failed.failed += 1;
      red.tokensIn += game.redTokensIn;
      red.tokensOut += game.redTokensOut;
      black.tokensIn += game.blackTokensIn;
      black.tokensOut += game.blackTokensOut;
      continue;
    }

    if (game.status !== 'finished' || !game.result) continue;

    red.played += 1;
    black.played += 1;
    red.redGames += 1;
    black.blackGames += 1;
    red.tokensIn += game.redTokensIn;
    red.tokensOut += game.redTokensOut;
    black.tokensIn += game.blackTokensIn;
    black.tokensOut += game.blackTokensOut;

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

  for (const row of rows.values()) {
    row.points = row.wins * TOURNAMENT_POINTS.win + row.draws * TOURNAMENT_POINTS.draw;
  }

  return [...rows.values()]
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.wins - a.wins ||
        b.draws - a.draws ||
        (order.get(a.modelId) ?? 0) - (order.get(b.modelId) ?? 0),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
