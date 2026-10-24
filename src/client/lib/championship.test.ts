import { describe, expect, it } from 'vitest';
import type {
  ChampionshipGameView,
  ChampionshipSeriesView,
  ChampionshipState,
  ModelProfileView,
  QualifierState,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_ENTRANTS,
  CHAMPIONSHIP_ENTRANTS_PER_POOL,
  CHAMPIONSHIP_GROUP_GAMES,
  CHAMPIONSHIP_MAX_GAMES,
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_QUALIFIER_GROUPS,
  CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
  CHAMPIONSHIP_SEED_POOLS,
  CHAMPIONSHIP_SERIES_DRAW_POINTS,
  CHAMPIONSHIP_SERIES_GAME_LIMIT,
  CHAMPIONSHIP_SERIES_POINTS_TARGET,
  CHAMPIONSHIP_SERIES_WIN_POINTS,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_PHASE_LABELS,
  CHAMPIONSHIP_RULES,
  CHAMPIONSHIP_TIEBREAK_LEGEND,
  applyPresetToChampionshipDraft,
  applyProfileToChampionshipDraft,
  buildChampionshipGroupPreview,
  buildChampionshipSeriesPreview,
  calculateChampionshipPlan,
  championshipPhaseTone,
  championshipProgress,
  championshipSeriesDecisionLabel,
  championshipSeriesStageFlag,
  composeDrawDrafts,
  createChampionshipDraw,
  createDefaultChampionshipDrafts,
  draftsForPool,
  draftsForQualifierGroup,
  fillBlankSeatsWithProfiles,
  fillChampionshipPoolWithProfiles,
  fillChampionshipQualifierGroupWithProfiles,
  formatChampionshipScore,
  formatChampionshipWins,
  formatSeriesProgress,
  formatSeriesRecord,
  isChampionshipDraftBlank,
  qualifiedDraftsFromState,
  qualifierDrafts,
  seriesSeedPlaceholder,
  shuffleWithRandom,
  toChampionshipStartRequest,
  updateChampionshipDraft,
  validateChampionshipDrafts,
} from './championship';
import { formatHistoryChampionship } from './history';

const profile: ModelProfileView = {
  id: 'saved-champ-1',
  name: '存档冠军',
  provider: 'anthropic',
  baseUrl: 'https://saved.test/v1',
  model: 'saved-model',
  thinkingLevel: 'deep',
  thinkingLevels: ['quick', 'balanced', 'deep'],
  apiReasoning: true,
  keyConfigured: true,
  keyHint: '••••9999',
  createdAt: 1,
  updatedAt: 2,
};

function deterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The 16 draft seats that enter the main draw: the 12 seeded seats plus four
 * qualifier winners (any four qualifier seats stand in for the winners here).
 */
function drawDrafts(
  drafts: ReturnType<typeof createDefaultChampionshipDrafts> = createDefaultChampionshipDrafts(),
) {
  return composeDrawDrafts(drafts, qualifierDrafts(drafts).slice(0, 4));
}

describe('championship draft setup', () => {
  it('creates 12 seeded seats and 10 qualifying seats with unique names', () => {
    const drafts = createDefaultChampionshipDrafts();
    expect(drafts).toHaveLength(
      CHAMPIONSHIP_ENTRANTS - CHAMPIONSHIP_ENTRANTS_PER_POOL + CHAMPIONSHIP_QUALIFIER_ENTRANTS,
    );

    for (const pool of [1, 2, 3]) {
      expect(
        drafts.filter((draft) => draft.qualifierGroup === null && draft.seedPool === pool),
      ).toHaveLength(CHAMPIONSHIP_ENTRANTS_PER_POOL);
    }
    for (const group of CHAMPIONSHIP_QUALIFIER_GROUPS) {
      expect(drafts.filter((draft) => draft.qualifierGroup === group)).toHaveLength(
        CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
      );
    }
    expect(drafts.filter((draft) => draft.seedPool === 4)).toHaveLength(
      CHAMPIONSHIP_QUALIFIER_ENTRANTS,
    );

    const names = drafts.map((draft) => draft.name.trim());
    expect(new Set(names).size).toBe(names.length);
    expect(validateChampionshipDrafts(drafts, []).ok).toBe(true);
  });

  it('keeps the seed pool when editing a seat', () => {
    const draft = createDefaultChampionshipDrafts()[5]!;
    const next = updateChampionshipDraft(draft, { name: '改过的名字', apiKey: 'sk-test' });
    expect(next.seedPool).toBe(draft.seedPool);
    expect(next.name).toBe('改过的名字');
    expect(next.apiKey).toBe('sk-test');
  });

  it('fills only blank seats from saved profiles with unique names', () => {
    const drafts = createDefaultChampionshipDrafts();
    const blanked = updateChampionshipDraft(drafts[0]!, {
      name: '',
      baseUrl: '',
      model: '',
      profileId: null,
    });
    expect(isChampionshipDraftBlank(blanked)).toBe(true);

    const fixture = [blanked, ...drafts.slice(1)];
    const result = fillBlankSeatsWithProfiles(fixture, [profile]);
    expect(result.filled).toBe(1);
    expect(result.drafts[0]!.profileId).toBe(profile.id);
    expect(result.drafts[0]!.name).toBe(profile.name);
    expect(result.drafts[0]!.seedPool).toBe(blanked.seedPool);
    // Nothing else is overwritten.
    expect(result.drafts[1]).toBe(drafts[1]);
    expect(validateChampionshipDrafts(result.drafts, [profile]).ok).toBe(true);
  });

  it('adopts the saved model-library name when a profile is selected', () => {
    const drafts = createDefaultChampionshipDrafts();
    const renamed = updateChampionshipDraft(drafts[0]!, { name: '我临时改的名字' });
    const first = applyProfileToChampionshipDraft(renamed, profile, [
      renamed,
      ...drafts.slice(1),
    ]);
    expect(first).toMatchObject({
      profileId: profile.id,
      name: profile.name,
      seedPool: renamed.seedPool,
    });

    const second = applyProfileToChampionshipDraft(drafts[1]!, profile, [
      first,
      ...drafts.slice(1),
    ]);
    expect(second.name).toBe(`${profile.name} 2`);
  });
});

describe('quick fill a seed pool', () => {
  const quickProfiles: ModelProfileView[] = [1, 2, 3, 4].map((index) => ({
    ...profile,
    id: `quick-profile-${index}`,
    name: `快速模型 ${index}`,
    model: `quick-model-${index}`,
  }));

  it('fills all four seats of one pool and leaves the other pools alone', () => {
    const drafts = createDefaultChampionshipDrafts();
    const next = fillChampionshipPoolWithProfiles(drafts, 2, quickProfiles);
    const pool = draftsForPool(next, 2);

    expect(pool.map((draft) => draft.name)).toEqual(
      quickProfiles.map((profileItem) => profileItem.name),
    );
    expect(pool.map((draft) => draft.profileId)).toEqual(
      quickProfiles.map((profileItem) => profileItem.id),
    );
    expect(pool.map((draft) => draft.model)).toEqual(
      quickProfiles.map((profileItem) => profileItem.model),
    );
    expect(pool.every((draft) => draft.seedPool === 2)).toBe(true);
    expect(next.filter((draft) => draft.seedPool !== 2)).toEqual(
      drafts.filter((draft) => draft.seedPool !== 2),
    );
    expect(validateChampionshipDrafts(next, quickProfiles).ok).toBe(true);
  });

  it('is atomic: refilling the same profiles does not add spurious suffixes', () => {
    const drafts = createDefaultChampionshipDrafts();
    const first = fillChampionshipPoolWithProfiles(drafts, 1, quickProfiles);
    const again = fillChampionshipPoolWithProfiles(first, 1, quickProfiles);

    expect(draftsForPool(again, 1).map((draft) => draft.name)).toEqual(
      quickProfiles.map((profileItem) => profileItem.name),
    );

    const conflictIndex = again.findIndex(
      (draft) => draft.seedPool === 2 && draft.id === draftsForPool(again, 2)[0]?.id,
    );
    expect(conflictIndex).toBeGreaterThanOrEqual(0);
    const withConflict = again.map((draft, index) =>
      index === conflictIndex ? { ...draft, name: quickProfiles[0]!.name } : draft,
    );
    const resolved = fillChampionshipPoolWithProfiles(withConflict, 1, quickProfiles);
    expect(draftsForPool(resolved, 1)[0]?.name).toBe(`${quickProfiles[0]!.name} 2`);
  });

  it('rejects incomplete or duplicate quick selections', () => {
    const drafts = createDefaultChampionshipDrafts();
    expect(() =>
      fillChampionshipPoolWithProfiles(drafts, 1, quickProfiles.slice(0, 3)),
    ).toThrow(/4 个模型/);
    expect(() =>
      fillChampionshipPoolWithProfiles(drafts, 1, [
        quickProfiles[0]!,
        quickProfiles[0]!,
        quickProfiles[1]!,
        quickProfiles[2]!,
      ]),
    ).toThrow(/不能重复/);
  });
});

describe('quick fill a qualifying group', () => {
  const groupProfiles: ModelProfileView[] = [1, 2, 3, 4, 5].map((index) => ({
    ...profile,
    id: `group-profile-${index}`,
    name: `入围模型 ${index}`,
    model: `group-model-${index}`,
  }));

  it('fills all five seats of one group and leaves the other seats alone', () => {
    const drafts = createDefaultChampionshipDrafts();
    const next = fillChampionshipQualifierGroupWithProfiles(drafts, 'A', groupProfiles);
    const group = draftsForQualifierGroup(next, 'A');

    expect(group.map((draft) => draft.name)).toEqual(
      groupProfiles.map((profileItem) => profileItem.name),
    );
    expect(group.map((draft) => draft.profileId)).toEqual(
      groupProfiles.map((profileItem) => profileItem.id),
    );
    expect(group.every((draft) => draft.seedPool === 4)).toBe(true);
    expect(group.every((draft) => draft.qualifierGroup === 'A')).toBe(true);
    expect(next.filter((draft) => draft.qualifierGroup !== 'A')).toEqual(
      drafts.filter((draft) => draft.qualifierGroup !== 'A'),
    );
    expect(validateChampionshipDrafts(next, groupProfiles).ok).toBe(true);
  });

  it('is atomic: refilling the same five profiles does not add suffixes', () => {
    const drafts = createDefaultChampionshipDrafts();
    const first = fillChampionshipQualifierGroupWithProfiles(drafts, 'B', groupProfiles);
    const again = fillChampionshipQualifierGroupWithProfiles(first, 'B', groupProfiles);

    expect(draftsForQualifierGroup(again, 'B').map((draft) => draft.name)).toEqual(
      groupProfiles.map((profileItem) => profileItem.name),
    );
  });

  it('suffixes a name that another seat on the board already uses', () => {
    const drafts = createDefaultChampionshipDrafts();
    const conflict = updateChampionshipDraft(drafts[0]!, {
      name: groupProfiles[0]!.name,
    });
    const fixture = [conflict, ...drafts.slice(1)];
    const next = fillChampionshipQualifierGroupWithProfiles(fixture, 'A', groupProfiles);
    expect(draftsForQualifierGroup(next, 'A')[0]?.name).toBe(
      `${groupProfiles[0]!.name} 2`,
    );
  });

  it('rejects wrong seat counts, duplicates and unknown groups', () => {
    const drafts = createDefaultChampionshipDrafts();
    expect(() =>
      fillChampionshipQualifierGroupWithProfiles(
        drafts,
        'A',
        groupProfiles.slice(0, 4),
      ),
    ).toThrow(/5 个模型/);
    expect(() =>
      fillChampionshipQualifierGroupWithProfiles(drafts, 'A', [
        ...groupProfiles.slice(0, 4),
        groupProfiles[0]!,
      ]),
    ).toThrow(/不能重复/);
    expect(() =>
      fillChampionshipQualifierGroupWithProfiles(
        drafts,
        'C' as 'A',
        groupProfiles,
      ),
    ).toThrow(/分组不存在/);
  });
});

describe('championship validation', () => {
  it('rejects duplicate names and broken model configs', () => {
    const drafts = createDefaultChampionshipDrafts();
    const duplicated = updateChampionshipDraft(drafts[1]!, { name: drafts[0]!.name });
    const broken = updateChampionshipDraft(drafts[2]!, { baseUrl: '', model: '' });

    const validation = validateChampionshipDrafts(
      [drafts[0]!, duplicated, ...drafts.slice(2)],
      [],
    );
    expect(validation.ok).toBe(false);
    expect(validation.draftErrors[duplicated.id]?.name).toMatch(/重复/);

    const second = validateChampionshipDrafts([drafts[0]!, drafts[1]!, broken], []);
    expect(second.ok).toBe(false);
    expect(second.formErrors.some((message) => message.includes('22 席'))).toBe(true);
  });

  it('reports a removed saved profile before drawing', () => {
    const drafts = createDefaultChampionshipDrafts();
    const withProfile = updateChampionshipDraft(drafts[0]!, { profileId: 'missing-profile' });
    const validation = validateChampionshipDrafts(
      [withProfile, ...drafts.slice(1)],
      [profile],
    );
    expect(validation.ok).toBe(false);
    expect(validation.draftErrors[withProfile.id]?.profile).toMatch(/已不存在/);
  });

  it('requires exactly five entrants in every qualifying group', () => {
    const drafts = createDefaultChampionshipDrafts().slice(0, 12);
    const validation = validateChampionshipDrafts(drafts, []);
    expect(validation.ok).toBe(false);
    expect(validation.formErrors.some((message) => message.includes('A 组'))).toBe(true);
  });
});

describe('championship random draw', () => {
  it('shuffles deterministically with an injected RNG', () => {
    expect(shuffleWithRandom(['a', 'b', 'c', 'd'], () => 0)).toEqual(['b', 'c', 'd', 'a']);

    const drafts = createDefaultChampionshipDrafts();
    const first = createChampionshipDraw(drawDrafts(drafts), deterministicRandom(7));
    const second = createChampionshipDraw(drawDrafts(drafts), deterministicRandom(7));
    expect(first.groups).toEqual(second.groups);
    expect(first.groupByDraftId).toEqual(second.groupByDraftId);
  });

  it('puts exactly one entrant from every pool into each group', () => {
    const drafts = createDefaultChampionshipDrafts();
    const fixture = drawDrafts(drafts);
    const draw = createChampionshipDraw(fixture, deterministicRandom(42));

    expect(draw.groups.map((group) => group.id)).toEqual(['A', 'B', 'C', 'D']);
    const seenDraftIds = new Set<string>();

    for (const group of draw.groups) {
      expect(group.slots).toHaveLength(CHAMPIONSHIP_ENTRANTS_PER_POOL);
      expect(group.slots.map((slot) => slot.pool)).toEqual([...CHAMPIONSHIP_SEED_POOLS]);
      for (const slot of group.slots) {
        expect(seenDraftIds.has(slot.draftId)).toBe(false);
        seenDraftIds.add(slot.draftId);
        expect(draw.groupByDraftId[slot.draftId]).toBe(group.id);
        const draft = fixture.find((item) => item.id === slot.draftId);
        expect(draft).toBeDefined();
        expect(slot.name).toBe(draft!.name.trim());
        expect(draft!.seedPool).toBe(slot.pool);
      }
    }

    expect(seenDraftIds.size).toBe(CHAMPIONSHIP_ENTRANTS);
  });

  it('rejects a draw when a seed pool is incomplete', () => {
    const fixture = drawDrafts().slice(1);
    expect(() => createChampionshipDraw(fixture, deterministicRandom(1))).toThrow(/种子池/);
  });
});

describe('championship plan and start request', () => {
  it('plans 24 group games and at most 66 base total games', () => {
    const plan = calculateChampionshipPlan();
    expect(plan.groupGames).toBe(CHAMPIONSHIP_GROUP_GAMES);
    expect(plan.groupGames).toBe(24);
    expect(plan.groupGamesPerEntrant).toBe(3);
    expect(plan.seriesGameLimit).toBe(CHAMPIONSHIP_SERIES_GAME_LIMIT);
    expect(plan.seriesGameLimit).toBe(6);
    expect(plan.pointsTarget).toBe(CHAMPIONSHIP_SERIES_POINTS_TARGET);
    expect(plan.pointsTarget).toBe(3);
    expect(plan.winPoints).toBe(CHAMPIONSHIP_SERIES_WIN_POINTS);
    expect(plan.drawPoints).toBe(CHAMPIONSHIP_SERIES_DRAW_POINTS);
    expect(plan.maxSeriesGames).toBe(42);
    expect(plan.maxTotalGames).toBe(CHAMPIONSHIP_MAX_GAMES);
    expect(plan.maxTotalGames).toBe(66);
    expect(plan).not.toHaveProperty('bo3GameLimit');
    expect(plan).not.toHaveProperty('bo5GameLimit');
  });

  it('converts drafts and the draw into the start request', () => {
    const drafts = createDefaultChampionshipDrafts();
    const fixture = drawDrafts(drafts);
    const draw = createChampionshipDraw(fixture, deterministicRandom(3));
    const request = toChampionshipStartRequest(fixture, draw);

    expect(request.entrants).toHaveLength(CHAMPIONSHIP_ENTRANTS);
    expect(request.groups).toHaveLength(4);
    for (const entrant of request.entrants) {
      expect(entrant.seedPool).toBeGreaterThanOrEqual(1);
      expect(entrant.seedPool).toBeLessThanOrEqual(4);
      expect(entrant.name.length).toBeGreaterThan(0);
      expect(entrant).not.toHaveProperty('profileId');
    }
    for (const group of request.groups) {
      expect(group.entrantNames).toHaveLength(4);
      expect(new Set(group.entrantNames).size).toBe(4);
    }

    const names = request.entrants.map((entrant) => entrant.name);
    expect(new Set(names).size).toBe(CHAMPIONSHIP_ENTRANTS);
  });

  it('builds zero-point group tables and a QF bracket from the draw', () => {
    const drafts = createDefaultChampionshipDrafts();
    const fixture = drawDrafts(drafts);
    const draw = createChampionshipDraw(fixture, deterministicRandom(11));

    const empty = buildChampionshipGroupPreview(fixture, null);
    expect(empty.groups).toEqual([]);
    expect(empty.entrants).toEqual([]);

    const preview = buildChampionshipGroupPreview(fixture, draw);
    expect(preview.entrants).toHaveLength(CHAMPIONSHIP_ENTRANTS);
    expect(preview.groups.map((group) => group.id)).toEqual(['A', 'B', 'C', 'D']);
    for (const group of preview.groups) {
      expect(group.complete).toBe(false);
      expect(group.qualifiedModelIds).toEqual([]);
      expect(group.entrantIds).toHaveLength(4);
      expect(group.standings).toHaveLength(4);
      expect(new Set(group.standings.map((row) => row.modelId)).size).toBe(4);
      for (const row of group.standings) {
        expect(row).toMatchObject({ played: 0, wins: 0, draws: 0, losses: 0, points: 0 });
      }
      const pools = group.entrantIds.map((id) => {
        const entrant = preview.entrants.find((item) => item.id === id);
        return entrant?.seedPool;
      });
      expect(pools.sort()).toEqual([1, 2, 3, 4]);
    }

    const series = buildChampionshipSeriesPreview();
    expect(series).toHaveLength(7);
    expect(series.slice(0, 4).map((item) => item.id)).toEqual(['qf1', 'qf2', 'qf3', 'qf4']);
    expect(series.every((item) => item.left === null && item.right === null)).toBe(true);
    expect(series[4]?.left).toBeNull();
    expect(series[4]?.right).toBeNull();
    expect(series[6]?.left).toBeNull();
    expect(series[6]?.right).toBeNull();
    // Every knockout round uses the same six-game / three-point rule, final included.
    expect(series.every((item) => item.maxGames === CHAMPIONSHIP_SERIES_GAME_LIMIT)).toBe(true);
    expect(series.every((item) => item.leftPoints === 0 && item.rightPoints === 0)).toBe(true);
    expect(series.every((item) => item.overtime === false && item.extra === false)).toBe(true);
    expect(seriesSeedPlaceholder(series[0]!, 'left')).toBe('A1');
    expect(seriesSeedPlaceholder(series[0]!, 'right')).toBe('B2');
    expect(seriesSeedPlaceholder(series[4]!, 'left')).toBe('八强赛 1 胜者');
    expect(seriesSeedPlaceholder(series[6]!, 'right')).toBe('半决赛 2 胜者');
  });

  it('carries prompt level and token caps into the start request', () => {
    const drafts = createDefaultChampionshipDrafts();
    drafts[0] = {
      ...drafts[0]!,
      promptLevel: 'quick',
      maxThinkingTokens: 1024,
      maxCompletionTokens: 4096,
      requestTimeoutSeconds: 300,
    };
    const fixture = drawDrafts(drafts);
    const draw = createChampionshipDraw(fixture, deterministicRandom(5));
    const request = toChampionshipStartRequest(fixture, draw);

    expect(request.entrants[0]).toMatchObject({
      promptLevel: 'quick',
      maxThinkingTokens: 1024,
      maxCompletionTokens: 4096,
      requestTimeoutSeconds: 300,
    });
    // Unset overrides stay omitted, matching the saved-profile defaults.
    expect(request.entrants[1]).not.toHaveProperty('promptLevel');
    expect(request.entrants[1]).not.toHaveProperty('maxThinkingTokens');
    expect(request.entrants[1]).not.toHaveProperty('maxCompletionTokens');
  });

  it('sends profile references for saved seats', () => {
    const drafts = createDefaultChampionshipDrafts();
    const withProfile = updateChampionshipDraft(drafts[0]!, {
      profileId: profile.id,
      name: profile.name,
      provider: profile.provider,
      baseUrl: profile.baseUrl,
      model: profile.model,
      thinkingLevel: profile.thinkingLevel,
      apiReasoning: profile.apiReasoning,
    });
    const fixture = [withProfile, ...drafts.slice(1)];
    const drawFixture = drawDrafts(fixture);
    const draw = createChampionshipDraw(drawFixture, deterministicRandom(9));
    const request = toChampionshipStartRequest(drawFixture, draw);

    const entrant = request.entrants[0]!;
    expect(entrant).toMatchObject({
      name: profile.name,
      seedPool: withProfile.seedPool,
      profileId: profile.id,
      thinkingLevel: 'deep',
      apiReasoning: true,
    });
    expect(entrant).not.toHaveProperty('apiKey');
  });
});

describe('championship progress', () => {
  function progressState(overrides: Partial<ChampionshipState>): ChampionshipState {
    return {
      revision: 1,
      phase: 'running',
      championshipId: 'champ-test',
      stage: 'group',
      entrants: [],
      groups: [],
      series: [],
      games: [],
      groupGamesTotal: CHAMPIONSHIP_GROUP_GAMES,
      groupGamesProcessed: 0,
      seriesTotal: 7,
      seriesProcessed: 0,
      scheduledGames: CHAMPIONSHIP_GROUP_GAMES,
      processedGames: 0,
      completedGames: 0,
      currentGameId: null,
      currentGameIds: [],
      currentSeriesId: null,
      currentSeriesIds: [],
      concurrency: 4,
      championModelId: null,
      championName: null,
      error: null,
      startedAt: 1,
      finishedAt: null,
      resumable: false,
      checkpointSavedAt: null,
      ...overrides,
    };
  }

  it('uses a monotonic stage-weighted percentage instead of scheduled games', () => {
    const snapshots: ChampionshipState[] = [
      progressState({}),
      progressState({ groupGamesProcessed: 24, processedGames: 24, scheduledGames: 24 }),
      progressState({
        groupGamesProcessed: 24,
        seriesProcessed: 1,
        processedGames: 27,
        scheduledGames: 25,
        stage: 'quarterfinal',
      }),
      progressState({
        groupGamesProcessed: 24,
        seriesProcessed: 4,
        processedGames: 45,
        scheduledGames: 45,
        stage: 'semifinal',
      }),
      progressState({
        phase: 'finished',
        stage: 'final',
        groupGamesProcessed: 24,
        seriesProcessed: 7,
        processedGames: 47,
        scheduledGames: 47,
        championName: '冠军',
        finishedAt: 2,
      }),
    ];

    const percents = snapshots.map((snapshot) => championshipProgress(snapshot).percent);
    for (let index = 1; index < percents.length; index += 1) {
      expect(percents[index]!).toBeGreaterThanOrEqual(percents[index - 1]!);
    }
    expect(percents[0]).toBe(0);
    expect(percents[1]).toBe(60);
    expect(percents[2]).toBeGreaterThan(60);
    expect(percents[3]).toBeLessThan(100);
    expect(percents[4]).toBe(100);
    expect(championshipProgress(null).percent).toBe(0);
  });

  it('does not let canceled games inflate progress after stopping', () => {
    const played = Array.from(
      { length: 3 },
      () => ({ status: 'finished', stage: 'group' }) as unknown as ChampionshipGameView,
    );
    const canceled = Array.from(
      { length: 21 },
      () => ({ status: 'canceled', stage: 'group' }) as unknown as ChampionshipGameView,
    );
    const stopped = progressState({
      phase: 'stopped',
      games: [...played, ...canceled],
      groupGamesProcessed: 24,
      processedGames: 24,
      completedGames: 3,
    });

    const progress = championshipProgress(stopped);
    expect(progress.groupGamesProcessed).toBe(3);
    expect(progress.processedGames).toBe(3);
    expect(progress.percent).toBe(8);

    const allCanceled = progressState({
      phase: 'stopped',
      games: Array.from(
        { length: 24 },
        () => ({ status: 'canceled', stage: 'group' }) as unknown as ChampionshipGameView,
      ),
      groupGamesProcessed: 24,
      processedGames: 24,
      completedGames: 0,
    });
    expect(championshipProgress(allCanceled)).toMatchObject({
      percent: 0,
      groupGamesProcessed: 0,
      processedGames: 0,
    });
  });
});

describe('championship seat filling', () => {
  it('adopts the profile name for preset placeholder seats', () => {
    const drafts = createDefaultChampionshipDrafts();
    // Switching to the custom preset empties the endpoint, making the seat blank.
    const custom = applyPresetToChampionshipDraft(drafts[0]!, 'custom');
    expect(isChampionshipDraftBlank(custom)).toBe(true);

    const result = fillBlankSeatsWithProfiles([custom, ...drafts.slice(1)], [profile]);
    expect(result.filled).toBe(1);
    expect(result.drafts[0]!.name).toBe(profile.name);
    expect(result.drafts[0]!.profileId).toBe(profile.id);
    expect(result.drafts[0]!.seedPool).toBe(custom.seedPool);
    expect(validateChampionshipDrafts(result.drafts, [profile]).ok).toBe(true);
  });
});

describe('championship resume presentation', () => {
  it('labels interrupted checkpoints and uses the paused tone', () => {
    expect(CHAMPIONSHIP_PHASE_LABELS.interrupted).toContain('续');
    expect(championshipPhaseTone('interrupted')).toBe('paused');
    expect(championshipPhaseTone('stopped')).toBe('paused');
    expect(championshipPhaseTone('error')).toBe('error');
  });
});

describe('knockout series scoring helpers', () => {
  function series(
    overrides: Partial<ChampionshipSeriesView> = {},
  ): ChampionshipSeriesView {
    return {
      id: 'qf1',
      stage: 'quarterfinal',
      label: '八强赛 1',
      slot: 1,
      status: 'running',
      left: { modelId: 'm1', name: '甲' },
      right: { modelId: 'm6', name: '乙' },
      leftWins: 1,
      rightWins: 0,
      leftPoints: 2,
      rightPoints: 1,
      draws: 1,
      failed: 0,
      playedGames: 2,
      maxGames: CHAMPIONSHIP_SERIES_GAME_LIMIT,
      overtime: false,
      extra: false,
      winnerModelId: null,
      decision: null,
      ...overrides,
    };
  }

  it('shows series points as the primary score and wins as secondary meta', () => {
    expect(formatChampionshipScore(series())).toBe('2 : 1');
    expect(formatChampionshipWins(series())).toBe('1 : 0');
    expect(
      formatChampionshipScore(series({ leftPoints: 3, rightPoints: 3 })),
    ).toBe('3 : 3');
    expect(formatSeriesRecord(series())).toBe('决胜 1 : 0 · 和 1 · 异常 0');
  });

  it('reports progress against the six-game cap and marks extra games', () => {
    expect(formatSeriesProgress(series({ playedGames: 3 }))).toBe('3/6');
    expect(
      formatSeriesProgress(series({ playedGames: 5, maxGames: 6 })),
    ).toBe('5/6');
    expect(
      formatSeriesProgress(series({ playedGames: 8, extra: true })),
    ).toBe('8/6+');
  });

  it('labels every decision including extra games', () => {
    expect(
      championshipSeriesDecisionLabel(series({ decision: 'points' })),
    ).toBe('先到 3 分');
    expect(
      championshipSeriesDecisionLabel(series({ decision: 'overtime' })),
    ).toBe('同时 3 分 · 加赛先胜');
    expect(
      championshipSeriesDecisionLabel(series({ decision: 'ranking' })),
    ).toBe('6 局封顶 · 依小组排名');
    expect(
      championshipSeriesDecisionLabel(
        series({ decision: 'ranking', extra: true }),
      ),
    ).toBe('小组排名相同 · 加赛决胜');
    expect(championshipSeriesDecisionLabel(series())).toBeNull();
  });

  it('flags overtime and extra-game states for the live card', () => {
    expect(
      championshipSeriesStageFlag(series({ overtime: true, status: 'running' })),
    ).toBe('加时');
    expect(
      championshipSeriesStageFlag(series({ overtime: true, status: 'finished' })),
    ).toBe('加赛胜出');
    expect(
      championshipSeriesStageFlag(series({ extra: true, status: 'running' })),
    ).toBe('加赛');
    expect(
      championshipSeriesStageFlag(series({ extra: true, status: 'finished' })),
    ).toBe('加赛决胜');
    expect(championshipSeriesStageFlag(series())).toBeNull();
  });
});

describe('championship history refs and tie-break copy', () => {
  it('formats group pairings and knockout series slots', () => {
    expect(
      formatHistoryChampionship({
        championshipId: 'champ-1',
        stage: 'group',
        groupId: 'A',
        seriesId: null,
        pairIndex: 3,
        gameIndex: 2,
      }),
    ).toBe('A 组 · 第 3 对 · 第 2 局');

    expect(
      formatHistoryChampionship({
        championshipId: 'champ-1',
        stage: 'quarterfinal',
        groupId: null,
        seriesId: 'qf2',
        pairIndex: 2,
        gameIndex: 1,
      }),
    ).toBe('八强赛 2 · 第 1 局');

    expect(
      formatHistoryChampionship({
        championshipId: 'champ-1',
        stage: 'final',
        groupId: null,
        seriesId: 'final',
        pairIndex: 1,
        gameIndex: 3,
      }),
    ).toBe('决赛 · 第 3 局');
  });

  it('documents the server tie-break order', () => {
    for (const text of [CHAMPIONSHIP_TIEBREAK_LEGEND, ...CHAMPIONSHIP_RULES]) {
      expect(text.length).toBeGreaterThan(0);
    }
    expect(CHAMPIONSHIP_TIEBREAK_LEGEND).toContain('相互对局积分');
    expect(CHAMPIONSHIP_TIEBREAK_LEGEND).toContain('种子池位次');
    expect(CHAMPIONSHIP_RULES.some((rule) => rule.includes('相互对局积分'))).toBe(true);
    expect(CHAMPIONSHIP_RULES.some((rule) => rule.includes('先到 3 分'))).toBe(true);
    expect(CHAMPIONSHIP_RULES.some((rule) => rule.includes('继续加赛'))).toBe(true);
  });
});

describe('qualifier results feed the fourth seed pool', () => {
  function qualifierFinished(
    drafts: ReturnType<typeof createDefaultChampionshipDrafts>,
    qualifiedModelIds: string[] = ['m3', 'm6', 'm2', 'm10'],
  ): QualifierState {
    return {
      revision: 1,
      phase: 'finished',
      qualifierId: 'qualifier-1',
      entrants: qualifierDrafts(drafts).map((draft, index) => ({
        id: `m${index + 1}`,
        name: draft.name.trim(),
        provider: draft.provider,
        model: draft.model,
        thinkingLevel: draft.thinkingLevel,
        apiReasoning: draft.apiReasoning,
        keyConfigured: false,
        groupId: index < 5 ? 'A' : 'B',
      })),
      groups: [],
      games: [],
      groupGamesTotal: 20,
      groupGamesProcessed: 20,
      processedGames: 20,
      completedGames: 20,
      currentGameIds: [],
      concurrency: 4,
      qualifiedModelIds,
      error: null,
      startedAt: 1,
      finishedAt: 2,
      resumable: false,
      checkpointSavedAt: null,
    };
  }

  it('maps the four winners onto the qualifying seats in A1, B1, A2, B2 order', () => {
    const drafts = createDefaultChampionshipDrafts();
    const names = qualifierDrafts(drafts).map((draft) => draft.name.trim());
    const qualified = qualifiedDraftsFromState(drafts, qualifierFinished(drafts));

    expect(qualified?.map((draft) => draft.name.trim())).toEqual([
      names[2]!,
      names[5]!,
      names[1]!,
      names[9]!,
    ]);
  });

  it('returns null once the qualifying roster changes', () => {
    const drafts = createDefaultChampionshipDrafts();
    const qualified = qualifiedDraftsFromState(drafts, qualifierFinished(drafts));
    expect(qualified).not.toBeNull();

    const renamed = drafts.map((draft) =>
      draft.id === qualified![0]!.id
        ? updateChampionshipDraft(draft, { name: '临时改名' })
        : draft,
    );
    expect(qualifiedDraftsFromState(renamed, qualifierFinished(drafts))).toBeNull();
  });

  it('composes the twelve seeded seats and four qualifiers into a 16-seat draw', () => {
    const drafts = createDefaultChampionshipDrafts();
    const qualified = qualifiedDraftsFromState(drafts, qualifierFinished(drafts))!;
    const composed = composeDrawDrafts(drafts, qualified);

    expect(composed).toHaveLength(CHAMPIONSHIP_ENTRANTS);
    expect(
      composed.filter((draft) => draft.seedPool === 4).map((draft) => draft.id),
    ).toEqual(qualified.map((draft) => draft.id));
    expect(
      composed.filter((draft) => draft.qualifierGroup === null),
    ).toHaveLength(CHAMPIONSHIP_ENTRANTS - CHAMPIONSHIP_ENTRANTS_PER_POOL);
  });
});
