import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChampionshipGroupId,
  ChampionshipSetupDraft,
  ChampionshipSetupDraw,
  ChampionshipSetupSaveRequest,
  QualifierGroupId,
} from '../../shared/protocol';
import { CHAMPIONSHIP_GROUPS } from '../../shared/protocol';
import {
  CHAMPIONSHIP_SETUP_DRAFT_COUNT,
  ChampionshipSetupStore,
  parseChampionshipSetupSnapshot,
} from './setup';

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryFile(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'xiangqi-championship-setup-'));
  temporaryDirectories.push(directory);
  return path.join(directory, 'championship-setup.json');
}

function setupDraft(
  index: number,
  overrides: Partial<ChampionshipSetupDraft> = {},
): ChampionshipSetupDraft {
  const seeded = index < 12;
  const qualifierGroup: QualifierGroupId | null = seeded ? null : index < 17 ? 'A' : 'B';
  return {
    id: `entrant-${index + 1}`,
    profileId: null,
    name: `模型 ${index + 1}`,
    preset: 'deepseek',
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    model: `model-${index + 1}`,
    thinkingLevel: 'balanced',
    thinkingOptions: ['quick', 'balanced', 'deep'],
    apiReasoning: false,
    apiKey: `secret-${index + 1}`,
    seedPool: seeded ? Math.floor(index / 4) + 1 : 4,
    qualifierGroup,
    ...overrides,
  };
}

function setupDrafts(): ChampionshipSetupDraft[] {
  return Array.from({ length: CHAMPIONSHIP_SETUP_DRAFT_COUNT }, (_, index) =>
    setupDraft(index),
  );
}

/** A structurally valid draw: one entrant per pool per group. */
function setupDraw(drafts: readonly ChampionshipSetupDraft[] = setupDrafts()): ChampionshipSetupDraw {
  const byPool = new Map<number, ChampionshipSetupDraft[]>();
  for (const pool of [1, 2, 3, 4]) {
    byPool.set(
      pool,
      drafts.filter((draft) => draft.seedPool === pool).slice(0, 4),
    );
  }
  const groups = CHAMPIONSHIP_GROUPS.map((id, groupIndex) => ({
    id,
    slots: [1, 2, 3, 4].map((pool) => {
      const draft = byPool.get(pool)![groupIndex]!;
      return { pool, draftId: draft.id, name: draft.name };
    }),
  }));
  const groupByDraftId: Record<string, ChampionshipGroupId> = {};
  for (const group of groups) {
    for (const slot of group.slots) {
      groupByDraftId[slot.draftId] = group.id;
    }
  }
  return { groups, groupByDraftId };
}

function saveRequest(
  overrides: Partial<ChampionshipSetupSaveRequest> = {},
): ChampionshipSetupSaveRequest {
  return {
    drafts: setupDrafts(),
    draw: setupDraw(),
    concurrency: 4,
    ...overrides,
  };
}

describe('ChampionshipSetupStore', () => {
  it('saves to disk and reloads the same seats, draw and concurrency', () => {
    const filePath = temporaryFile();
    const store = new ChampionshipSetupStore({ filePath });
    expect(store.has()).toBe(false);
    expect(store.load()).toBeNull();

    const request = saveRequest();
    const saved = store.save(request);

    expect(saved).not.toBeNull();
    expect(saved).toMatchObject({ version: 1, concurrency: 4 });
    expect(typeof saved?.savedAt).toBe('number');
    expect(saved?.drafts).toHaveLength(CHAMPIONSHIP_SETUP_DRAFT_COUNT);
    expect(saved?.draw?.groups).toHaveLength(CHAMPIONSHIP_GROUPS.length);

    // Loaded from disk, so this is a genuine restart round-trip.
    const reloaded = new ChampionshipSetupStore({ filePath });
    expect(reloaded.has()).toBe(true);
    const snapshot = reloaded.load();
    expect(snapshot).not.toBeNull();
    expect(snapshot?.concurrency).toBe(4);
    expect(snapshot?.drafts.map((draft) => draft.id)).toEqual(
      request.drafts.map((draft) => draft.id),
    );
    expect(snapshot?.drafts[0]?.apiKey).toBe('secret-1');
    // Each group keeps one entrant per pool, ordered 1→4.
    for (const group of snapshot?.draw?.groups ?? []) {
      expect(group.slots.map((slot) => slot.pool)).toEqual([1, 2, 3, 4]);
    }
    // The reverse index is rebuilt from the groups.
    expect(snapshot?.draw?.groupByDraftId[request.drafts[0]!.id]).toBe('A');
    expect(snapshot?.savedAt).toBe(saved?.savedAt);
  });

  it('leaves no temporary file behind after an atomic write', () => {
    const filePath = temporaryFile();
    const store = new ChampionshipSetupStore({ filePath });
    expect(store.save(saveRequest())).not.toBeNull();
    expect(readdirSync(path.dirname(filePath))).toEqual(['championship-setup.json']);
  });

  it('writes owner-only permissions on POSIX platforms', () => {
    const filePath = temporaryFile();
    const store = new ChampionshipSetupStore({ filePath });
    expect(store.save(saveRequest())).not.toBeNull();

    const stats = statSync(filePath);
    expect(stats.isFile()).toBe(true);
    // Windows does not expose POSIX mode bits; the store still calls chmod 0600.
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o777).toBe(0o600);
    }
  });

  it('returns an isolated copy so callers cannot mutate the stored snapshot', () => {
    const store = new ChampionshipSetupStore({ filePath: null });
    expect(store.save(saveRequest())).not.toBeNull();

    const first = store.load()!;
    first.drafts[0]!.name = 'mutated';
    first.drafts[0]!.thinkingOptions.push('mutated');
    first.draw!.groups[0]!.slots[0]!.name = 'mutated';

    const second = store.load()!;
    expect(second.drafts[0]!.name).toBe('模型 1');
    expect(second.drafts[0]!.thinkingOptions).not.toContain('mutated');
    expect(second.draw!.groups[0]!.slots[0]!.name).toBe('模型 1');
  });

  it('keeps the previous snapshot when an invalid save is rejected', () => {
    const filePath = temporaryFile();
    const store = new ChampionshipSetupStore({ filePath });
    expect(store.save(saveRequest())).not.toBeNull();

    expect(store.save(saveRequest({ drafts: setupDrafts().slice(0, 21) }))).toBeNull();
    expect(store.load()?.drafts).toHaveLength(CHAMPIONSHIP_SETUP_DRAFT_COUNT);
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('clears the in-memory copy and the file', () => {
    const filePath = temporaryFile();
    const store = new ChampionshipSetupStore({ filePath });
    expect(store.save(saveRequest())).not.toBeNull();
    store.clear();
    expect(store.has()).toBe(false);
    expect(new ChampionshipSetupStore({ filePath }).has()).toBe(false);
  });
});

describe('ChampionshipSetupStore parsing', () => {
  it('round-trips a null draw', () => {
    const store = new ChampionshipSetupStore({ filePath: null });
    const saved = store.save(saveRequest({ draw: null }));
    expect(saved?.draw).toBeNull();
    expect(store.load()?.draw).toBeNull();
  });

  it('accepts partially filled seats so autosave never fights the user', () => {
    const store = new ChampionshipSetupStore({ filePath: null });
    const drafts = setupDrafts();
    drafts[3] = { ...drafts[3]!, name: '', baseUrl: '', model: '', apiKey: '' };
    expect(store.save(saveRequest({ drafts }))).not.toBeNull();
  });

  it('persists an independent request timeout per seat', () => {
    const store = new ChampionshipSetupStore({ filePath: null });
    const drafts = setupDrafts();
    drafts[0] = { ...drafts[0]!, requestTimeoutSeconds: 300 };
    const saved = store.save(saveRequest({ drafts }));

    expect(saved?.drafts[0]?.requestTimeoutSeconds).toBe(300);
    expect(saved?.drafts[1]?.requestTimeoutSeconds ?? null).toBeNull();

    const invalid = setupDrafts();
    invalid[0] = { ...invalid[0]!, requestTimeoutSeconds: 3 };
    expect(store.save(saveRequest({ drafts: invalid }))).toBeNull();
  });

  it('round-trips prompt level and token caps through the disk file', () => {
    const filePath = temporaryFile();
    const store = new ChampionshipSetupStore({ filePath });
    const drafts = setupDrafts();
    drafts[0] = {
      ...drafts[0]!,
      promptLevel: 'deep',
      maxThinkingTokens: 4096,
      maxCompletionTokens: 8192,
    };
    expect(store.save(saveRequest({ drafts }))).not.toBeNull();

    const snapshot = new ChampionshipSetupStore({ filePath }).load();
    expect(snapshot?.drafts[0]?.promptLevel).toBe('deep');
    expect(snapshot?.drafts[0]?.maxThinkingTokens).toBe(4096);
    expect(snapshot?.drafts[0]?.maxCompletionTokens).toBe(8192);
    // Seats that never configured the new fields persist as null.
    expect(snapshot?.drafts[1]?.promptLevel ?? null).toBeNull();
    expect(snapshot?.drafts[1]?.maxThinkingTokens ?? null).toBeNull();
    expect(snapshot?.drafts[1]?.maxCompletionTokens ?? null).toBeNull();
  });

  it('accepts explicit nulls for the prompt level and token caps', () => {
    const store = new ChampionshipSetupStore({ filePath: null });
    const drafts = setupDrafts();
    drafts[0] = {
      ...drafts[0]!,
      promptLevel: null,
      maxThinkingTokens: null,
      maxCompletionTokens: null,
    };
    const saved = store.save(saveRequest({ drafts }));
    expect(saved).not.toBeNull();
    expect(saved?.drafts[0]?.promptLevel ?? null).toBeNull();
    expect(saved?.drafts[0]?.maxThinkingTokens ?? null).toBeNull();
    expect(saved?.drafts[0]?.maxCompletionTokens ?? null).toBeNull();
  });

  it.each<[string, Partial<ChampionshipSetupDraft>]>([
    ['an empty prompt level', { promptLevel: '' }],
    ['a blank prompt level', { promptLevel: '   ' }],
    ['a non-string prompt level', { promptLevel: 2 as never }],
    ['an over-long prompt level', { promptLevel: 'x'.repeat(65) }],
    ['a fractional thinking cap', { maxThinkingTokens: 4096.5 }],
    ['a thinking cap below 1024', { maxThinkingTokens: 1023 }],
    ['a thinking cap above 32768', { maxThinkingTokens: 32769 }],
    ['a non-numeric thinking cap', { maxThinkingTokens: '4096' as never }],
    ['a fractional completion cap', { maxCompletionTokens: 8192.5 }],
    ['a completion cap below 256', { maxCompletionTokens: 255 }],
    ['a completion cap above 131072', { maxCompletionTokens: 131073 }],
    ['a non-numeric completion cap', { maxCompletionTokens: '8192' as never }],
  ])('rejects a draft with %s', (_label, patch) => {
    const drafts = setupDrafts();
    drafts[0] = { ...drafts[0]!, ...patch };
    expect(new ChampionshipSetupStore({ filePath: null }).save(saveRequest({ drafts }))).toBeNull();
  });

  it('loads a version-1 file written before the new model fields existed', () => {
    const filePath = temporaryFile();
    // setupDrafts() has no promptLevel/token-cap keys, mimicking an old file.
    const payload = {
      version: 1,
      savedAt: Date.now(),
      drafts: setupDrafts(),
      draw: null,
      concurrency: 2,
    };
    writeFileSync(filePath, JSON.stringify(payload), 'utf8');

    const store = new ChampionshipSetupStore({ filePath });
    expect(store.has()).toBe(true);
    const snapshot = store.load();
    expect(snapshot?.drafts).toHaveLength(CHAMPIONSHIP_SETUP_DRAFT_COUNT);
    expect(snapshot?.drafts[0]?.promptLevel ?? null).toBeNull();
    expect(snapshot?.drafts[0]?.maxThinkingTokens ?? null).toBeNull();
    expect(snapshot?.drafts[0]?.maxCompletionTokens ?? null).toBeNull();
    expect(snapshot?.draw).toBeNull();
    expect(snapshot?.concurrency).toBe(2);
  });

  it('ignores a corrupt JSON file and warns', () => {
    const filePath = temporaryFile();
    writeFileSync(filePath, '{"version":1,"drafts":oops', 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const store = new ChampionshipSetupStore({ filePath });

    expect(store.has()).toBe(false);
    expect(store.load()).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it('ignores a file with an unknown version and warns', () => {
    const filePath = temporaryFile();
    const payload = {
      version: 2,
      savedAt: Date.now(),
      drafts: setupDrafts(),
      draw: null,
      concurrency: 2,
    };
    writeFileSync(filePath, JSON.stringify(payload), 'utf8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(new ChampionshipSetupStore({ filePath }).has()).toBe(false);
    expect(warn).toHaveBeenCalled();
  });

  it('ignores a valid-looking file that fails strict validation', () => {
    const filePath = temporaryFile();
    const payload = {
      version: 1,
      savedAt: Date.now(),
      drafts: setupDrafts().slice(0, 21),
      draw: null,
      concurrency: 2,
    };
    writeFileSync(filePath, JSON.stringify(payload), 'utf8');
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(new ChampionshipSetupStore({ filePath }).has()).toBe(false);
  });

  it.each<[string, Partial<ChampionshipSetupDraft>]>([
    ['missing api key', { apiKey: undefined as unknown as string }],
    ['unknown provider', { provider: 'gemini' as never }],
    ['invalid seed pool', { seedPool: 5 }],
    ['invalid qualifier group', { qualifierGroup: 'C' as never }],
    ['non-string thinking options', { thinkingOptions: [1] as never }],
    ['non-boolean apiReasoning', { apiReasoning: 'yes' as never }],
    ['missing id', { id: '' }],
  ])('rejects a draft with %s', (_label, patch) => {
    const drafts = setupDrafts();
    drafts[0] = { ...drafts[0]!, ...patch };
    expect(new ChampionshipSetupStore({ filePath: null }).save(saveRequest({ drafts }))).toBeNull();
  });

  it('rejects duplicate draft ids', () => {
    const drafts = setupDrafts();
    drafts[1] = { ...drafts[1]!, id: drafts[0]!.id };
    expect(new ChampionshipSetupStore({ filePath: null }).save(saveRequest({ drafts }))).toBeNull();
  });

  it.each(['draw with a duplicate pool in one group', 'draw missing a group', 'draw with a repeated entrant'])(
    'rejects a %s',
    (label) => {
      const draw = setupDraw();
      if (label === 'draw with a duplicate pool in one group') {
        draw.groups[0]!.slots[1]!.pool = draw.groups[0]!.slots[0]!.pool;
      } else if (label === 'draw missing a group') {
        draw.groups.pop();
      } else {
        draw.groups[1]!.slots[0]!.draftId = draw.groups[0]!.slots[0]!.draftId;
      }
      expect(new ChampionshipSetupStore({ filePath: null }).save(saveRequest({ draw }))).toBeNull();
    },
  );

  it('rejects an unknown group label in the draw', () => {
    const draw = setupDraw();
    draw.groups[0] = { ...draw.groups[0]!, id: 'E' as never };
    expect(new ChampionshipSetupStore({ filePath: null }).save(saveRequest({ draw }))).toBeNull();
  });

  it.each([0, 9, 2.5, '4'])('rejects an invalid concurrency (%s)', (concurrency) => {
    expect(
      new ChampionshipSetupStore({ filePath: null }).save(
        saveRequest({ concurrency: concurrency as never }),
      ),
    ).toBeNull();
  });
});

describe('parseChampionshipSetupSnapshot', () => {
  it('rejects a snapshot without a numeric savedAt', () => {
    expect(
      parseChampionshipSetupSnapshot({
        version: 1,
        savedAt: 'today',
        drafts: setupDrafts(),
        draw: null,
        concurrency: 1,
      }),
    ).toBeNull();
  });

  it('normalizes draw group order to A→D', () => {
    const shuffledDraw = setupDraw();
    shuffledDraw.groups.reverse();
    const parsed = parseChampionshipSetupSnapshot({
      version: 1,
      savedAt: 1,
      drafts: setupDrafts(),
      draw: shuffledDraw,
      concurrency: 1,
    });
    expect(parsed?.draw?.groups.map((group) => group.id)).toEqual([...CHAMPIONSHIP_GROUPS]);
    expect(parsed?.draw?.groupByDraftId).toEqual(setupDraw().groupByDraftId);
  });
});
