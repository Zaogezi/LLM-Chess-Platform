import { describe, expect, it } from 'vitest';
import type {
  TournamentGameView,
  TournamentModelView,
} from '../../shared/protocol';
import { computeStandings } from './standings';

function model(id: string, name: string): TournamentModelView {
  return {
    id,
    name,
    provider: 'openai',
    model: `${name}-model`,
    thinkingLevel: 'balanced',
    apiReasoning: false,
    keyConfigured: true,
  };
}

function game(partial: Partial<TournamentGameView>): TournamentGameView {
  return {
    id: 'g1',
    pairIndex: 1,
    gameIndex: 1,
    redModelId: 'm1',
    blackModelId: 'm2',
    redName: 'A',
    blackName: 'B',
    status: 'finished',
    plies: 10,
    winnerModelId: null,
    result: null,
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
    ...partial,
  };
}

describe('computeStandings', () => {
  it('counts wins, draws and losses and awards 3/1/0 points', () => {
    const models = [model('m1', 'A'), model('m2', 'B'), model('m3', 'C')];
    const games: TournamentGameView[] = [
      game({ id: 'g1', redModelId: 'm1', blackModelId: 'm2', result: { winner: 'red', reason: 'checkmate', text: 'A 胜' }, winnerModelId: 'm1' }),
      game({ id: 'g2', redModelId: 'm3', blackModelId: 'm1', result: { winner: null, reason: 'repetition', text: '和' } }),
      game({ id: 'g3', redModelId: 'm2', blackModelId: 'm3', result: { winner: 'black', reason: 'checkmate', text: 'C 胜' }, winnerModelId: 'm3' }),
    ];

    const standings = computeStandings(models, games);
    expect(standings.map((row) => [row.name, row.played, row.wins, row.draws, row.losses, row.points])).toEqual([
      ['A', 2, 1, 1, 0, 4],
      ['C', 2, 1, 1, 0, 4],
      ['B', 2, 0, 0, 2, 0],
    ]);
    expect(standings.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('excludes failed games from W/D/L but counts the failed side', () => {
    const models = [model('m1', 'A'), model('m2', 'B')];
    const games = [
      game({ status: 'failed', failedSide: 'black', error: 'HTTP 401', redTokensIn: 10, blackTokensIn: 4 }),
      game({ status: 'canceled', error: 'stopped' }),
    ];

    const [a, b] = computeStandings(models, games);
    expect(a).toMatchObject({ played: 0, wins: 0, draws: 0, losses: 0, failed: 0, points: 0, tokensIn: 10 });
    expect(b).toMatchObject({ played: 0, wins: 0, draws: 0, losses: 0, failed: 1, points: 0, tokensIn: 4 });
  });

  it('breaks ties by wins, draws, then input order', () => {
    const models = [model('m1', 'First'), model('m2', 'Second'), model('m3', 'Third')];
    // m1 and m2 both have one win; m3 has two draws.
    const games = [
      game({ id: 'g1', redModelId: 'm1', blackModelId: 'm3', result: { winner: 'red', reason: 'checkmate', text: '' } }),
      game({ id: 'g2', redModelId: 'm2', blackModelId: 'm3', result: { winner: 'red', reason: 'checkmate', text: '' } }),
      game({ id: 'g3', redModelId: 'm1', blackModelId: 'm2', result: { winner: null, reason: 'repetition', text: '' } }),
      game({ id: 'g4', redModelId: 'm2', blackModelId: 'm1', result: { winner: null, reason: 'repetition', text: '' } }),
    ];

    const standings = computeStandings(models, games);
    expect(standings.map((row) => row.name)).toEqual(['First', 'Second', 'Third']);
    expect(standings.map((row) => row.points)).toEqual([5, 5, 0]);
    expect(standings.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it('returns every model even before any game finishes', () => {
    const standings = computeStandings([model('m1', 'A'), model('m2', 'B')], []);
    expect(standings).toHaveLength(2);
    expect(standings.every((row) => row.played === 0 && row.rank > 0)).toBe(true);
  });
});
