import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  ChampionshipArchive,
  ChampionshipGroupId,
  ChampionshipState,
} from '../../shared/protocol';
import { CHAMPIONSHIP_GROUPS } from '../../shared/protocol';
import { XiangqiGame } from '../xiangqi/index';
import {
  DEFAULT_CHAMPIONSHIP_ARCHIVE_FILE,
  ChampionshipArchiveStore,
  parseChampionshipArchive,
  toChampionshipArchiveSummary,
} from './archive';
import { Championship } from './championship';
import { validateChampionshipStartRequest } from './validate';

/** Black is checkmated at once, so red wins without any model call. */
const MATE_RED_WINS = '3Rk4/3R5/9/9/9/9/9/9/9/4K4 b - - 0 1';

const GROUP_IDS: readonly ChampionshipGroupId[] = CHAMPIONSHIP_GROUPS;
const ENTRANT_NAMES = GROUP_IDS.flatMap((groupId) =>
  [1, 2, 3, 4].map((pool) => `${groupId}${pool}`),
);

const activeChampionships: Championship[] = [];
const temporaryDirectories: string[] = [];
let archiveFixture: ChampionshipArchive;

afterEach(() => {
  while (activeChampionships.length) activeChampionships.pop()?.dispose();
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

function temporaryFile(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'xiangqi-archive-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'championships.json');
}

function startInput() {
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

async function runChampionshipForArchive(): Promise<ChampionshipArchive> {
  const archives: ChampionshipArchive[] = [];
  const championship = new Championship({
    providerFactory: () => ({
      provider: 'openai',
      async complete() {
        throw new Error('terminal positions must not call a model');
      },
    }),
    createInitialGame: () => XiangqiGame.fromFen(MATE_RED_WINS),
    onArchive: (archive) => archives.push(archive),
  });
  activeChampionships.push(championship);

  const done = new Promise<ChampionshipState>((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error('timed out waiting for the archive'));
    }, 10_000);
    const unsubscribe = championship.onState((state) => {
      if (state.phase !== 'finished') return;
      clearTimeout(timer);
      unsubscribe();
      resolve(state);
    });
  });
  championship.start(startInput());
  await done;

  expect(archives).toHaveLength(1);
  return archives[0]!;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

beforeAll(async () => {
  archiveFixture = await runChampionshipForArchive();
});

describe('championship archive snapshot', () => {
  it('captures a finished edition without exposing API keys', () => {
    expect(archiveFixture).toMatchObject({
      version: 1,
      phase: 'finished',
      championModelId: 'm2',
      championName: 'A2',
      seriesTotal: 7,
      seriesProcessed: 7,
    });
    expect(archiveFixture.championshipId).toBeTruthy();
    expect(archiveFixture.entrantNames).toHaveLength(16);
    expect(archiveFixture.entrants).toHaveLength(16);
    expect(archiveFixture.groups).toHaveLength(4);
    expect(archiveFixture.series).toHaveLength(7);
    expect(archiveFixture.scheduledGames).toBe(59);
    expect(archiveFixture.completedGames).toBe(59);
    expect(archiveFixture.groupGamesTotal).toBe(24);
    expect(archiveFixture.groupGamesProcessed).toBe(24);
    expect(archiveFixture.finishedAt).not.toBeNull();
    expect(archiveFixture.archivedAt).toBeGreaterThanOrEqual(
      archiveFixture.startedAt,
    );
    expect(JSON.stringify(archiveFixture)).not.toContain('secret-');
    expect(JSON.stringify(archiveFixture)).not.toContain('apiKey');
  });

  it('re-validates its own snapshot and strips unknown fields', () => {
    const parsed = parseChampionshipArchive(clone(archiveFixture));
    expect(parsed).not.toBeNull();
    expect(parsed?.championshipId).toBe(archiveFixture.championshipId);

    const withExtra = clone(archiveFixture) as unknown as Record<string, unknown>;
    withExtra.foo = 'bar';
    const sanitized = parseChampionshipArchive(withExtra);
    expect(sanitized).not.toBeNull();
    expect(JSON.stringify(sanitized)).not.toContain('"foo"');
  });

  it('rejects snapshots that smuggle API keys', () => {
    const withKey = clone(archiveFixture) as unknown as {
      entrants: Array<Record<string, unknown>>;
    };
    withKey.entrants[0]!.apiKey = 'secret-leak';
    expect(parseChampionshipArchive(withKey)).toBeNull();

    const withSetup = clone(archiveFixture) as unknown as {
      entrants: Array<Record<string, unknown>>;
    };
    withSetup.entrants[0]!.setup = { apiKey: 'secret-leak' };
    expect(parseChampionshipArchive(withSetup)).toBeNull();
  });
});

describe('ChampionshipArchiveStore', () => {
  it('saves, lists newest first and reads editions by id', () => {
    const store = new ChampionshipArchiveStore({ filePath: null });
    const first = clone(archiveFixture);
    const second = clone(archiveFixture);
    second.championshipId = 'championship-2';
    second.startedAt = first.startedAt + 10_000;
    second.archivedAt = first.archivedAt + 20_000;
    second.championModelId = null;
    second.championName = null;
    second.phase = 'stopped';

    expect(store.save(first)).toBe(true);
    expect(store.save(second)).toBe(true);
    expect(store.size).toBe(2);

    const list = store.list();
    expect(list.map((summary) => summary.championshipId)).toEqual([
      'championship-2',
      archiveFixture.championshipId,
    ]);
    expect(list[0]).toEqual(toChampionshipArchiveSummary(second));

    expect(store.get('championship-2')?.phase).toBe('stopped');
    expect(store.get('missing')).toBeNull();
  });

  it('upserts by championshipId instead of duplicating', () => {
    const store = new ChampionshipArchiveStore({ filePath: null });
    const firstSave = clone(archiveFixture);
    store.save(firstSave);

    const updated = clone(archiveFixture);
    updated.archivedAt += 5_000;
    updated.phase = 'stopped';
    updated.championModelId = null;
    updated.championName = null;
    expect(store.save(updated)).toBe(true);

    expect(store.size).toBe(1);
    expect(store.list()[0]?.phase).toBe('stopped');
    expect(store.get(archiveFixture.championshipId)?.archivedAt).toBe(
      updated.archivedAt,
    );
  });

  it('persists to disk, reloads, and never writes keys', () => {
    const filePath = temporaryFile();
    const store = new ChampionshipArchiveStore({ filePath });
    expect(store.save(clone(archiveFixture))).toBe(true);
    expect(existsSync(filePath)).toBe(true);

    const raw = readFileSync(filePath, 'utf8');
    expect(raw).not.toContain('secret-');
    expect(raw).not.toContain('apiKey');
    const onDisk = JSON.parse(raw) as unknown[];
    expect(onDisk).toHaveLength(1);

    const reloaded = new ChampionshipArchiveStore({ filePath });
    expect(reloaded.size).toBe(1);
    expect(reloaded.get(archiveFixture.championshipId)?.championName).toBe('A2');
  });

  it('ignores malformed files and invalid entries without crashing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const malformedPath = temporaryFile();
    writeFileSync(malformedPath, '{not valid json', 'utf8');
    expect(new ChampionshipArchiveStore({ filePath: malformedPath }).size).toBe(0);

    const wrongShapePath = temporaryFile();
    writeFileSync(wrongShapePath, JSON.stringify({ archives: [] }), 'utf8');
    expect(new ChampionshipArchiveStore({ filePath: wrongShapePath }).size).toBe(0);

    const mixedPath = temporaryFile();
    writeFileSync(
      mixedPath,
      JSON.stringify([clone(archiveFixture), { championshipId: 'broken' }]),
      'utf8',
    );
    const mixed = new ChampionshipArchiveStore({ filePath: mixedPath });
    expect(mixed.size).toBe(1);
    expect(mixed.get(archiveFixture.championshipId)).not.toBeNull();

    expect(warn).toHaveBeenCalled();
  });

  it('refuses to save an invalid archive and exposes the production default path', () => {
    const store = new ChampionshipArchiveStore({ filePath: null });
    expect(
      store.save({ championshipId: 'broken' } as unknown as ChampionshipArchive),
    ).toBe(false);
    expect(store.size).toBe(0);

    expect(DEFAULT_CHAMPIONSHIP_ARCHIVE_FILE.endsWith(
      path.join('data', 'championships.json'),
    )).toBe(true);
  });

  it('clears both memory and the backing file', () => {
    const filePath = temporaryFile();
    const store = new ChampionshipArchiveStore({ filePath });
    store.save(clone(archiveFixture));
    expect(existsSync(filePath)).toBe(true);

    store.clear();
    expect(store.size).toBe(0);
    expect(existsSync(filePath)).toBe(false);
    expect(new ChampionshipArchiveStore({ filePath }).size).toBe(0);
  });
});
