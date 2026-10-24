import { describe, expect, it } from 'vitest';
import type {
  ChampionshipGroupId,
  ChampionshipSetupDraft,
  ChampionshipSetupDraw,
  ChampionshipSetupSaveRequest,
  QualifierGroupId,
} from '../../shared/protocol';
import { CHAMPIONSHIP_GROUPS } from '../../shared/protocol';
import type { ChampionshipDraft } from './championship';
import { createDefaultChampionshipDrafts } from './championship';
import {
  CHAMPIONSHIP_SETUP_DRAFT_COUNT,
  ensureDraw,
  fromSetupDrafts,
  isValidSetupSnapshot,
  toSetupDrafts,
} from './championshipSetup';

function defaultDrafts(): ChampionshipDraft[] {
  return createDefaultChampionshipDrafts();
}

/** A valid 16-slot draw: one entrant per pool per group. */
function drawFor(drafts: readonly ChampionshipDraft[]): ChampionshipSetupDraw {
  const byPool = new Map<number, ChampionshipDraft[]>();
  for (const pool of [1, 2, 3, 4]) {
    byPool.set(pool, drafts.filter((draft) => draft.seedPool === pool).slice(0, 4));
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

function setupDraftsFromDefault(): ChampionshipSetupDraft[] {
  return toSetupDrafts(defaultDrafts());
}

function snapshotPayload(overrides: Record<string, unknown> = {}): unknown {
  const request: ChampionshipSetupSaveRequest = {
    drafts: setupDraftsFromDefault(),
    draw: drawFor(defaultDrafts()),
    concurrency: 4,
  };
  return { version: 1, savedAt: 1_700_000_000_000, ...request, ...overrides };
}

describe('championship setup draft conversion', () => {
  it('round-trips the 22 editable seats', () => {
    const drafts = defaultDrafts();
    const setupDrafts = toSetupDrafts(drafts);

    expect(setupDrafts).toHaveLength(CHAMPIONSHIP_SETUP_DRAFT_COUNT);
    expect(setupDrafts.every((draft) => !('showKey' in draft))).toBe(true);
    expect(fromSetupDrafts(setupDrafts)).toEqual(drafts);
  });

  it('drops inline showKey flags when saving', () => {
    const drafts = defaultDrafts();
    drafts[0] = { ...drafts[0]!, showKey: true };
    const setupDrafts = toSetupDrafts(drafts);
    expect(setupDrafts.every((draft) => !('showKey' in draft))).toBe(true);
  });

  it('restores every persisted field and resets showKey to false', () => {
    const drafts = defaultDrafts();
    const setupDrafts = toSetupDrafts(drafts);
    setupDrafts[2] = {
      ...setupDrafts[2]!,
      profileId: 'profile-1',
      name: '恢复的模型',
      preset: 'anthropic',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-restored',
      thinkingLevel: 'deep',
      thinkingOptions: ['quick', 'deep'],
      apiReasoning: true,
      apiKey: 'restored-key',
      seedPool: 1,
      qualifierGroup: null,
    };

    const restored = fromSetupDrafts(setupDrafts);
    expect(restored).toHaveLength(CHAMPIONSHIP_SETUP_DRAFT_COUNT);
    expect(restored.every((draft) => draft.showKey === false)).toBe(true);
    expect(restored[2]).toMatchObject({
      id: setupDrafts[2]!.id,
      profileId: 'profile-1',
      name: '恢复的模型',
      preset: 'anthropic',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-restored',
      thinkingLevel: 'deep',
      thinkingOptions: ['quick', 'deep'],
      apiReasoning: true,
      apiKey: 'restored-key',
      seedPool: 1,
      qualifierGroup: null,
    });
  });

  it('falls back to the custom preset for an unknown saved preset key', () => {
    const setupDrafts = setupDraftsFromDefault();
    setupDrafts[0] = { ...setupDrafts[0]!, preset: 'retired-provider' };
    expect(fromSetupDrafts(setupDrafts)[0]?.preset).toBe('custom');
  });

  it('copies thinking option arrays instead of sharing them', () => {
    const drafts = defaultDrafts();
    const setupDrafts = toSetupDrafts(drafts);
    setupDrafts[0]!.thinkingOptions.push('mutated-on-save');
    expect(drafts[0]!.thinkingOptions).not.toContain('mutated-on-save');

    const restored = fromSetupDrafts(setupDrafts);
    restored[0]!.thinkingOptions.push('mutated-on-restore');
    expect(setupDrafts[0]!.thinkingOptions).not.toContain('mutated-on-restore');
  });

  it('keeps qualifier seats on pool 4 and seeded seats on pools 1–3', () => {
    const setupDrafts = setupDraftsFromDefault();
    const qualifier = setupDrafts.filter((draft) => draft.qualifierGroup !== null);
    const seeded = setupDrafts.filter((draft) => draft.qualifierGroup === null);
    expect(qualifier).toHaveLength(10);
    expect(qualifier.every((draft) => draft.seedPool === 4)).toBe(true);
    expect(seeded).toHaveLength(12);
    expect(seeded.every((draft) => draft.seedPool >= 1 && draft.seedPool <= 3)).toBe(true);
  });
});

describe('ensureDraw', () => {
  it('converts a valid saved draw into the client draw shape', () => {
    const drafts = defaultDrafts();
    const saved = drawFor(drafts);
    const draw = ensureDraw(saved);

    expect(draw).not.toBeNull();
    expect(draw?.groups.map((group) => group.id)).toEqual([...CHAMPIONSHIP_GROUPS]);
    for (const group of draw?.groups ?? []) {
      expect(group.slots.map((slot) => slot.pool)).toEqual([1, 2, 3, 4]);
    }
    expect(draw?.groupByDraftId).toEqual(saved.groupByDraftId);
  });

  it('returns null for an absent draw', () => {
    expect(ensureDraw(null)).toBeNull();
    expect(ensureDraw(undefined)).toBeNull();
    expect(ensureDraw({})).toBeNull();
  });

  it('rejects malformed draws', () => {
    const drafts = defaultDrafts();
    const duplicatePool = drawFor(drafts);
    duplicatePool.groups[0]!.slots[1]!.pool = duplicatePool.groups[0]!.slots[0]!.pool;
    expect(ensureDraw(duplicatePool)).toBeNull();

    const repeatedEntrant = drawFor(drafts);
    repeatedEntrant.groups[1]!.slots[0]!.draftId =
      repeatedEntrant.groups[0]!.slots[0]!.draftId;
    expect(ensureDraw(repeatedEntrant)).toBeNull();

    const missingGroup = drawFor(drafts);
    missingGroup.groups.pop();
    expect(ensureDraw(missingGroup)).toBeNull();

    const badGroup = drawFor(drafts);
    badGroup.groups[0] = { ...badGroup.groups[0]!, id: 'E' as never };
    expect(ensureDraw(badGroup)).toBeNull();
  });
});

describe('isValidSetupSnapshot', () => {
  it('accepts a structurally valid snapshot', () => {
    expect(isValidSetupSnapshot(snapshotPayload())).toBe(true);
    expect(isValidSetupSnapshot(snapshotPayload({ draw: null }))).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    ['unknown version', { version: 2 }],
    ['missing savedAt', { savedAt: 'now' }],
    ['too few drafts', { drafts: setupDraftsFromDefault().slice(0, 21) }],
    ['invalid concurrency', { concurrency: 0 }],
    ['invalid draw', { draw: { groups: [] } }],
  ])('rejects a snapshot with %s', (_label, overrides) => {
    expect(isValidSetupSnapshot(snapshotPayload(overrides))).toBe(false);
  });

  it('rejects a non-object payload', () => {
    expect(isValidSetupSnapshot(null)).toBe(false);
    expect(isValidSetupSnapshot('setup')).toBe(false);
  });

  it('rejects a snapshot with an invalid draft field', () => {
    const drafts = setupDraftsFromDefault();
    drafts[0] = {
      ...drafts[0]!,
      qualifierGroup: 'C' as QualifierGroupId,
    };
    expect(isValidSetupSnapshot(snapshotPayload({ drafts }))).toBe(false);
  });
});
