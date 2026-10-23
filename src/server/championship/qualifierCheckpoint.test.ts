import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChampionshipGameView, QualifierGroupId } from '../../shared/protocol';
import {
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_QUALIFIER_GROUPS,
} from '../../shared/protocol';
import {
  QualifierCheckpointStore,
  parseQualifierCheckpoint,
  type QualifierCheckpoint,
  type QualifierCheckpointEntrant,
  type QualifierCheckpointPhase,
} from './qualifierCheckpoint';
import { buildQualifierGames } from './qualifierSchedule';

const GROUP_NAMES: Record<QualifierGroupId, readonly string[]> = {
  A: ['A1', 'A2', 'A3', 'A4', 'A5'],
  B: ['B1', 'B2', 'B3', 'B4', 'B5'],
};

function entrant(name: string, index: number): QualifierCheckpointEntrant {
  return {
    id: `m${index + 1}`,
    name,
    groupId: name.slice(0, 1) as QualifierGroupId,
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

const ENTRANTS = CHAMPIONSHIP_QUALIFIER_GROUPS.flatMap((groupId) =>
  GROUP_NAMES[groupId].map((name, index) => entrant(name, groupId === 'A' ? index : index + 5)),
);

function groupGames(): ChampionshipGameView[] {
  return buildQualifierGames(
    CHAMPIONSHIP_QUALIFIER_GROUPS.map((groupId) => ({
      id: groupId,
      members: ENTRANTS.filter((item) => item.groupId === groupId).map((item) => ({
        id: item.id,
        name: item.name,
      })),
    })),
  );
}

function checkpoint(overrides: Partial<QualifierCheckpoint> = {}): QualifierCheckpoint {
  return {
    version: 1,
    savedAt: 1_700_000_000_000,
    qualifierId: 'qualifier-1',
    phase: 'running',
    startedAt: 1_699_999_000_000,
    finishedAt: null,
    error: null,
    entrants: ENTRANTS,
    games: groupGames(),
    concurrency: 2,
    ...overrides,
  };
}

function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

/** A finished game row that still passes the structural parser. */
function finishedGame(game: ChampionshipGameView): ChampionshipGameView {
  const redWins = game.redModelId === 'm1';
  return {
    ...game,
    status: 'finished',
    plies: 3,
    winnerModelId: redWins ? game.redModelId : game.blackModelId,
    result: {
      winner: redWins ? 'red' : 'black',
      reason: 'checkmate',
      text: redWins ? '红方将死黑方' : '黑方将死红方',
    },
    startedAt: 1_700_000_001_000,
    finishedAt: 1_700_000_002_000,
    durationMs: 1_000,
    tokensIn: 30,
    tokensOut: 10,
    redTokensIn: 20,
    redTokensOut: 6,
    blackTokensIn: 10,
    blackTokensOut: 4,
  };
}

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryFile(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'xiangqi-qualifier-checkpoint-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'qualifier.json');
}

describe('parseQualifierCheckpoint', () => {
  it('round-trips a valid checkpoint with decided and pending games', () => {
    const games = groupGames();
    const decided = games.slice(0, 3).map(finishedGame);
    const parsed = parseQualifierCheckpoint(
      asJson(checkpoint({ phase: 'stopped', games: [...decided, ...games.slice(3)] })),
    );

    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({
      version: 1,
      qualifierId: 'qualifier-1',
      phase: 'stopped',
      savedAt: 1_700_000_000_000,
      startedAt: 1_699_999_000_000,
      finishedAt: null,
      error: null,
      concurrency: 2,
    });
    expect(parsed?.entrants).toHaveLength(CHAMPIONSHIP_QUALIFIER_ENTRANTS);
    expect(parsed?.entrants[0]?.setup.apiKey).toBe('secret-A1');
    for (const groupId of CHAMPIONSHIP_QUALIFIER_GROUPS) {
      expect(parsed?.entrants.filter((item) => item.groupId === groupId)).toHaveLength(5);
      expect(parsed?.games.filter((game) => game.groupId === groupId)).toHaveLength(10);
      expect(
        new Set(
          parsed?.games
            .filter((game) => game.groupId === groupId)
            .map((game) => game.pairIndex),
        ).size,
      ).toBe(10);
    }
    expect(parsed?.games.filter((game) => game.status === 'finished')).toHaveLength(3);
    expect(parsed?.games.filter((game) => game.status === 'scheduled')).toHaveLength(17);
    expect(parsed?.games.every((game) => game.stage === 'qualifier')).toBe(true);
    expect(parsed?.games.every((game) => game.seriesId === null)).toBe(true);
    expect(parsed?.games.every((game) => game.gameIndex === 1)).toBe(true);
  });

  it('accepts every resumable phase and nullable error/finishedAt', () => {
    for (const phase of ['running', 'stopped', 'error', 'interrupted'] as const) {
      const parsed = parseQualifierCheckpoint(
        asJson(
          checkpoint({
            phase,
            error: phase === 'error' ? '入围赛内部错误' : null,
            finishedAt: phase === 'error' || phase === 'stopped' ? 1_700_000_100_000 : null,
          }),
        ),
      );
      expect(parsed?.phase).toBe(phase);
    }
  });

  it('round-trips the concurrency setting and treats invalid values as serial', () => {
    expect(parseQualifierCheckpoint(asJson(checkpoint({ concurrency: 8 })))?.concurrency).toBe(8);
    expect(parseQualifierCheckpoint(asJson(checkpoint({ concurrency: 1 })))?.concurrency).toBe(1);
    expect(parseQualifierCheckpoint(asJson(checkpoint({ concurrency: undefined })))?.concurrency).toBeUndefined();

    for (const concurrency of [0, 9, 2.5, -1, '4', true]) {
      const parsed = parseQualifierCheckpoint(
        asJson(checkpoint({ concurrency: concurrency as never })),
      );
      // An invalid concurrency is dropped, not a reason to discard the checkpoint.
      expect(parsed).not.toBeNull();
      expect(parsed?.concurrency).toBeUndefined();
    }
  });

  it('rejects an unknown version or a terminal phase', () => {
    expect(parseQualifierCheckpoint(asJson(checkpoint({ version: 2 as never })))).toBeNull();
    expect(parseQualifierCheckpoint(asJson(checkpoint({ version: '1' as never })))).toBeNull();
    expect(parseQualifierCheckpoint(null)).toBeNull();
    expect(parseQualifierCheckpoint([])).toBeNull();
    for (const phase of ['idle', 'finished', 'unknown'] as readonly string[]) {
      expect(
        parseQualifierCheckpoint(asJson(checkpoint({ phase: phase as QualifierCheckpointPhase }))),
      ).toBeNull();
    }
  });

  it('rejects malformed headers', () => {
    const cases: Record<string, unknown>[] = [
      { qualifierId: undefined },
      { qualifierId: '   ' },
      { qualifierId: 3 },
      { qualifierId: 'x'.repeat(129) },
      { phase: undefined },
      { savedAt: '1700000000000' },
      { startedAt: undefined },
      { finishedAt: 'soon' },
      { error: 3 },
    ];
    for (const patch of cases) {
      expect(
        parseQualifierCheckpoint(
          asJson(checkpoint(patch as Partial<QualifierCheckpoint>)),
        ),
      ).toBeNull();
    }
    expect(parseQualifierCheckpoint(asJson(checkpoint({ finishedAt: null, error: null })))).not.toBeNull();
  });

  it('rejects malformed entrant lists', () => {
    const cases: unknown[] = [
      undefined,
      'x',
      ENTRANTS.slice(0, 9),
      [...ENTRANTS, entrant('C1', 10)],
      ENTRANTS.map((item, index) => (index === 0 ? { ...item, id: '' } : item)),
      ENTRANTS.map((item, index) => (index === 0 ? { ...item, id: 'x'.repeat(81) } : item)),
      ENTRANTS.map((item, index) => (index === 0 ? { ...item, name: '   ' } : item)),
      ENTRANTS.map((item, index) => (index === 0 ? { ...item, groupId: 'C' } : item)),
      ENTRANTS.map((item, index) => (index === 1 ? { ...item, id: 'm1' } : item)),
      ENTRANTS.map((item, index) =>
        index === 1 ? { ...item, name: 'a1' } : item,
      ),
      ENTRANTS.map((item, index) =>
        index === 0 ? { ...item, setup: { ...item.setup, baseUrl: 'ftp://bad' } } : item,
      ),
      ENTRANTS.map((item, index) =>
        index === 0 ? { ...item, setup: { ...item.setup, model: '  ' } } : item,
      ),
    ];
    for (const entrants of cases) {
      expect(
        parseQualifierCheckpoint(asJson({ ...checkpoint(), entrants })),
      ).toBeNull();
    }

    // Six A members and four B members is unbalanced.
    const unbalanced = [
      ...ENTRANTS.slice(0, 5),
      { ...entrant('C1', 5), groupId: 'A' },
      ...ENTRANTS.slice(6),
    ];
    expect(parseQualifierCheckpoint(asJson({ ...checkpoint(), entrants: unbalanced }))).toBeNull();
  });

  it('rejects missing, incomplete or duplicated game schedules', () => {
    const games = groupGames();
    const cases: unknown[] = [
      undefined,
      'x',
      games.slice(0, 19),
      [...games, finishedGame(games[0]!)],
      games.map((game, index) => (index === 0 ? { ...game, stage: 'group' } : game)),
      games.map((game, index) => (index === 0 ? { ...game, seriesId: 'qf1' } : game)),
      games.map((game, index) => (index === 0 ? { ...game, gameIndex: 2 } : game)),
      games.map((game, index) => (index === 0 ? { ...game, pairIndex: 0 } : game)),
      games.map((game, index) => (index === 0 ? { ...game, pairIndex: 11 } : game)),
      games.map((game, index) => (index === 0 ? { ...game, groupId: 'C' } : game)),
      games.map((game, index) => (index === 0 ? { ...game, redModelId: 'm99' } : game)),
      games.map((game, index) =>
        index === 0 ? { ...game, blackModelId: game.redModelId } : game,
      ),
      games.map((game, index) => (index === 1 ? { ...game, id: 'g1' } : game)),
      // Ten A games but a duplicated pair index inside the group.
      games.map((game, index) =>
        index === 1 ? { ...game, pairIndex: games[0]!.pairIndex } : game,
      ),
    ];
    for (const value of cases) {
      expect(parseQualifierCheckpoint(asJson({ ...checkpoint(), games: value }))).toBeNull();
    }
  });
});

describe('QualifierCheckpointStore', () => {
  it('writes a version-1 checkpoint atomically and reloads it', () => {
    const filePath = temporaryFile();
    const store = new QualifierCheckpointStore({ filePath });
    expect(store.has()).toBe(false);
    expect(store.path).toBe(filePath);

    expect(store.save(checkpoint())).toBe(true);
    expect(store.has()).toBe(true);

    const onDisk = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    expect(onDisk.version).toBe(1);
    expect(onDisk.phase).toBe('running');
    // The local checkpoint must carry the runtime setups so resume needs no keys.
    expect(JSON.stringify(onDisk)).toContain('secret-A1');

    const reloaded = new QualifierCheckpointStore({ filePath });
    expect(reloaded.has()).toBe(true);
    expect(reloaded.load()).toMatchObject({
      version: 1,
      qualifierId: 'qualifier-1',
      concurrency: 2,
    });
    expect(reloaded.load()?.games).toHaveLength(20);

    store.clear();
    expect(new QualifierCheckpointStore({ filePath }).has()).toBe(false);
  });

  it('keeps an in-memory store when the file path is null', () => {
    const store = new QualifierCheckpointStore({ filePath: null });
    expect(store.path).toBeNull();
    expect(store.has()).toBe(false);
    expect(store.load()).toBeNull();

    expect(store.save(checkpoint({ phase: 'stopped' }))).toBe(true);
    expect(store.load()).toMatchObject({ phase: 'stopped' });
    store.clear();
    expect(store.has()).toBe(false);
  });

  it('ignores malformed and structurally invalid checkpoint files', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const malformed = temporaryFile();
    writeFileSync(malformed, '{"version":1,"entrants":oops}', 'utf8');
    expect(new QualifierCheckpointStore({ filePath: malformed }).has()).toBe(false);

    const invalid = temporaryFile();
    writeFileSync(invalid, '{"version":1}', 'utf8');
    expect(new QualifierCheckpointStore({ filePath: invalid }).has()).toBe(false);

    const terminalPhase = temporaryFile();
    writeFileSync(
      terminalPhase,
      JSON.stringify({
        ...(asJson(checkpoint()) as Record<string, unknown>),
        phase: 'finished',
      }),
      'utf8',
    );
    expect(new QualifierCheckpointStore({ filePath: terminalPhase }).has()).toBe(false);
  });
});
