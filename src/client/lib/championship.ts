import type {
  ChampionshipEntrantRequest,
  ChampionshipEntrantView,
  ChampionshipGameView,
  ChampionshipGroupId,
  ChampionshipGroupInput,
  ChampionshipGroupView,
  ChampionshipKnockoutStage,
  ChampionshipPhase,
  ChampionshipSeriesDecision,
  ChampionshipSeriesStatus,
  ChampionshipSeriesView,
  ChampionshipStage,
  ChampionshipStartRequest,
  ChampionshipState,
  ModelProfileView,
  QualifierGroupId,
  QualifierState,
  TournamentStanding,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_ENTRANTS,
  CHAMPIONSHIP_ENTRANTS_PER_POOL,
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_GROUP_GAMES,
  CHAMPIONSHIP_GROUP_GAMES_PER_ENTRANT,
  CHAMPIONSHIP_GROUP_GAMES_PER_GROUP,
  CHAMPIONSHIP_GROUP_SIZE,
  CHAMPIONSHIP_MAX_GAMES,
  CHAMPIONSHIP_POOLS,
  CHAMPIONSHIP_QUALIFIERS_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_ADVANCE_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_QUALIFIER_GROUPS,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
  CHAMPIONSHIP_SEED_POOLS,
  CHAMPIONSHIP_SERIES_COUNT,
  CHAMPIONSHIP_SERIES_DRAW_POINTS,
  CHAMPIONSHIP_SERIES_GAME_LIMIT,
  CHAMPIONSHIP_SERIES_POINTS_TARGET,
  CHAMPIONSHIP_SERIES_WIN_POINTS,
  TOURNAMENT_POINTS,
  championshipSeriesGameLimit,
} from '../../shared/protocol';
import type { PresetKey } from '../presets';
import { PRESETS, presetByKey, validateModelConfig } from '../presets';
import type {
  TournamentFieldErrors,
  TournamentModelDraft,
  TournamentModelErrors,
  TournamentTone,
} from './tournament';
import {
  applyPresetToDraft,
  applyProfileToDraft,
  createTournamentDraft,
  describeTournamentGameResult,
  formatTournamentClock,
  normalizeModelName,
  uniqueModelName,
} from './tournament';

/**
 * Re-export the protocol constants the championship UI needs, so components
 * only ever import from this lib and can never drift from the shared plan.
 */
export {
  CHAMPIONSHIP_ENTRANTS,
  CHAMPIONSHIP_ENTRANTS_PER_POOL,
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_GROUP_GAMES,
  CHAMPIONSHIP_GROUP_GAMES_PER_ENTRANT,
  CHAMPIONSHIP_GROUP_GAMES_PER_GROUP,
  CHAMPIONSHIP_GROUP_SIZE,
  CHAMPIONSHIP_MAX_GAMES,
  CHAMPIONSHIP_POOLS,
  CHAMPIONSHIP_QUALIFIERS_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_ADVANCE_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_QUALIFIER_GROUPS,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES,
  CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP,
  CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
  CHAMPIONSHIP_SEED_POOLS,
  CHAMPIONSHIP_SERIES_COUNT,
  CHAMPIONSHIP_SERIES_DRAW_POINTS,
  CHAMPIONSHIP_SERIES_GAME_LIMIT,
  CHAMPIONSHIP_SERIES_POINTS_TARGET,
  CHAMPIONSHIP_SERIES_WIN_POINTS,
  championshipSeriesFormatLabel,
  championshipSeriesGameLimit,
} from '../../shared/protocol';

/* ------------------------------------------------------------------ */
/* Draft model: 12 seeded seats (pools 1–3) plus 10 qualifying seats   */
/* ------------------------------------------------------------------ */

/**
 * A championship seat is a regular tournament model draft plus its seed pool.
 * Seeded seats live in pools 1–3. The ten qualifying seats use pool 4 and are
 * assigned to qualifying group A or B; the top two of each group fill pool 4.
 */
export interface ChampionshipDraft extends TournamentModelDraft {
  /** 1–4; seeded seats use 1–3, qualifying seats use 4. */
  seedPool: number;
  /** 'A' or 'B' for a qualifying seat; null for a seeded seat. */
  qualifierGroup: QualifierGroupId | null;
}

/** 12 seeded seats + 10 qualifying seats; pool 4 is filled by the qualifier. */
export const CHAMPIONSHIP_DRAFT_COUNT =
  CHAMPIONSHIP_ENTRANTS -
  CHAMPIONSHIP_ENTRANTS_PER_POOL +
  CHAMPIONSHIP_QUALIFIER_ENTRANTS;
export const CHAMPIONSHIP_POOL_SEALS: Record<number, string> = {
  1: '甲',
  2: '乙',
  3: '丙',
  4: '丁',
};
export const CHAMPIONSHIP_POOL_LABELS: Record<number, string> = {
  1: '一号种子池',
  2: '二号种子池',
  3: '三号种子池',
  4: '四号种子池',
};
/** The pool 4 tab doubles as the qualifying-round roster. */
export const CHAMPIONSHIP_QUALIFIER_POOL_LABEL = '四号种子池 · 入围赛';
export const QUALIFIER_GROUP_LABELS: Record<QualifierGroupId, string> = {
  A: 'A 组',
  B: 'B 组',
};

/** Presets cycled across the fixed seats; "custom" stays out of the defaults. */
const DEFAULT_DRAFT_PRESETS: readonly PresetKey[] = [
  'deepseek',
  'openai',
  'anthropic',
  'moonshot',
  'zhipu',
  'openrouter',
  'ollama',
];

export function championshipPoolSeal(pool: number): string {
  return CHAMPIONSHIP_POOL_SEALS[pool] ?? String(pool);
}

export function championshipPoolLabel(pool: number): string {
  return CHAMPIONSHIP_POOL_LABELS[pool] ?? `${pool} 号种子池`;
}

export function championshipGroupLabel(id: ChampionshipGroupId | null | undefined): string {
  return id ? `${id} 组` : '待定';
}

export function createChampionshipDraft(
  presetKey: PresetKey = 'deepseek',
  seedPool = 1,
  name?: string,
  qualifierGroup: QualifierGroupId | null = null,
): ChampionshipDraft {
  const draft = createTournamentDraft(presetKey, name);
  return { ...draft, seedPool, qualifierGroup };
}

/**
 * The fixed 22-seat board: four seeded seats in each of pools 1–3 plus ten
 * qualifying seats (A/B groups of five). Every seat is pre-filled with a
 * built-in preset so the page is immediately legible; users only ever edit the
 * seats — there is no add/remove.
 */
export function createDefaultChampionshipDrafts(): ChampionshipDraft[] {
  const drafts: ChampionshipDraft[] = [];
  const seededCount = CHAMPIONSHIP_ENTRANTS - CHAMPIONSHIP_ENTRANTS_PER_POOL;

  for (let index = 0; index < seededCount; index += 1) {
    const pool = Math.floor(index / CHAMPIONSHIP_ENTRANTS_PER_POOL) + 1;
    const presetKey = DEFAULT_DRAFT_PRESETS[index % DEFAULT_DRAFT_PRESETS.length]!;
    const preset = presetByKey(presetKey);
    const name = `${preset.label} ${championshipPoolSeal(pool)}`;
    drafts.push(createChampionshipDraft(presetKey, pool, name));
  }

  CHAMPIONSHIP_QUALIFIER_GROUPS.forEach((group, groupIndex) => {
    for (let seat = 0; seat < CHAMPIONSHIP_QUALIFIER_GROUP_SIZE; seat += 1) {
      const index = groupIndex * CHAMPIONSHIP_QUALIFIER_GROUP_SIZE + seat;
      const presetKey =
        DEFAULT_DRAFT_PRESETS[(index + 2) % DEFAULT_DRAFT_PRESETS.length]!;
      const preset = presetByKey(presetKey);
      drafts.push(
        createChampionshipDraft(
          presetKey,
          4,
          `${preset.label} 围${group}${seat + 1}`,
          group,
        ),
      );
    }
  });

  return drafts;
}

/** Seeded championship seats (pools 1–3); the ten qualifier seats are excluded. */
export function seededDrafts(
  drafts: readonly ChampionshipDraft[],
): ChampionshipDraft[] {
  return drafts.filter((draft) => draft.qualifierGroup === null);
}

/** The ten qualifying-round seats, in A-group then B-group order. */
export function qualifierDrafts(
  drafts: readonly ChampionshipDraft[],
): ChampionshipDraft[] {
  return drafts.filter((draft) => draft.qualifierGroup !== null);
}

export function draftsForQualifierGroup(
  drafts: readonly ChampionshipDraft[],
  group: QualifierGroupId,
): ChampionshipDraft[] {
  return drafts.filter(
    (draft) => draft.qualifierGroup === group && draft.seedPool === 4,
  );
}

export function draftsForPool(
  drafts: readonly ChampionshipDraft[],
  pool: number,
): ChampionshipDraft[] {
  if (pool === 4) {
    return qualifierDrafts(drafts);
  }
  return drafts.filter(
    (draft) => draft.seedPool === pool && draft.qualifierGroup === null,
  );
}

export function countDraftsByPool(
  drafts: readonly ChampionshipDraft[],
): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const pool of CHAMPIONSHIP_SEED_POOLS) {
    counts[pool] = 0;
  }
  for (const draft of drafts) {
    counts[draft.seedPool] = (counts[draft.seedPool] ?? 0) + 1;
  }
  return counts;
}

export function countQualifierDraftsByGroup(
  drafts: readonly ChampionshipDraft[],
): Record<QualifierGroupId, number> {
  const counts: Record<QualifierGroupId, number> = { A: 0, B: 0 };
  for (const draft of qualifierDrafts(drafts)) {
    if (draft.qualifierGroup) counts[draft.qualifierGroup] += 1;
  }
  return counts;
}

/** A seat is blank when it has no usable label or no usable endpoint. */
export function isChampionshipDraftBlank(draft: ChampionshipDraft): boolean {
  const hasName = draft.name.trim().length > 0;
  const hasEndpoint = Boolean(
    draft.profileId ||
      (draft.baseUrl.trim().length > 0 && draft.model.trim().length > 0),
  );
  return !hasName || !hasEndpoint;
}

/** Apply a patch without ever letting the seed pool or qualifier group drift. */
export function updateChampionshipDraft(
  draft: ChampionshipDraft,
  patch: Partial<TournamentModelDraft>,
): ChampionshipDraft {
  return {
    ...draft,
    ...patch,
    seedPool: draft.seedPool,
    qualifierGroup: draft.qualifierGroup,
  };
}

export function applyPresetToChampionshipDraft(
  draft: ChampionshipDraft,
  presetKey: PresetKey,
): ChampionshipDraft {
  return {
    ...applyPresetToDraft(draft, presetKey),
    seedPool: draft.seedPool,
    qualifierGroup: draft.qualifierGroup,
  };
}

export function applyProfileToChampionshipDraft(
  draft: ChampionshipDraft,
  profile: ModelProfileView,
  existing: readonly ChampionshipDraft[],
): ChampionshipDraft {
  const others = existing.filter((item) => item.id !== draft.id);
  return {
    ...applyProfileToDraft(draft, profile, existing),
    // Championship seats always adopt the saved library name. A repeated
    // library object gets a numeric suffix so the entrant names stay unique.
    name: uniqueModelName(profile.name, others),
    seedPool: draft.seedPool,
    qualifierGroup: draft.qualifierGroup,
  };
}

export interface FillBlankSeatsResult {
  drafts: ChampionshipDraft[];
  filled: number;
}

/**
 * Atomically fill one seeded pool (1–3) from four saved profiles. Replacing the
 * whole pool at once prevents old names in that pool from being mistaken for
 * other seats, so re-applying the same four profiles never creates spurious "2"
 * suffixes. Names still get suffixes when another seat already uses them.
 */
export function fillChampionshipPoolWithProfiles(
  drafts: readonly ChampionshipDraft[],
  pool: number,
  profiles: readonly ModelProfileView[],
): ChampionshipDraft[] {
  if (
    !Number.isInteger(pool) ||
    pool < 1 ||
    pool > CHAMPIONSHIP_ENTRANTS_PER_POOL ||
    draftsForPool(drafts, pool).length !== CHAMPIONSHIP_ENTRANTS_PER_POOL
  ) {
    throw new Error('种子池不存在或席位数量不完整。');
  }

  return fillSeatsWithProfiles(drafts, draftsForPool(drafts, pool), profiles, '四个');
}

/**
 * Atomically fill one qualifying group (A or B, five seats) from five saved
 * profiles. Replacing the whole group at once means re-applying the same five
 * profiles never creates spurious suffixes; names still get suffixes when
 * another seat on the board already uses them.
 */
export function fillChampionshipQualifierGroupWithProfiles(
  drafts: readonly ChampionshipDraft[],
  group: QualifierGroupId,
  profiles: readonly ModelProfileView[],
): ChampionshipDraft[] {
  if (!CHAMPIONSHIP_QUALIFIER_GROUPS.includes(group)) {
    throw new Error('入围赛分组不存在。');
  }
  const groupDrafts = draftsForQualifierGroup(drafts, group);
  if (groupDrafts.length !== CHAMPIONSHIP_QUALIFIER_GROUP_SIZE) {
    throw new Error('入围赛分组席位数量不完整。');
  }

  return fillSeatsWithProfiles(drafts, groupDrafts, profiles, '五个');
}

/**
 * Shared atomic replacement for a fixed seat block (a seeded pool of four or a
 * qualifying group of five). Profiles are applied left to right so each new
 * name is checked against every seat that is not being replaced.
 */
function fillSeatsWithProfiles(
  drafts: readonly ChampionshipDraft[],
  target: readonly ChampionshipDraft[],
  profiles: readonly ModelProfileView[],
  duplicateLabel: string,
): ChampionshipDraft[] {
  if (profiles.length !== target.length) {
    throw new Error(`快速填充需要选择 ${target.length} 个模型。`);
  }
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
    throw new Error(`快速填充的${duplicateLabel}模型不能重复。`);
  }

  const targetIds = new Set(target.map((draft) => draft.id));
  const others = drafts.filter((draft) => !targetIds.has(draft.id));
  const filled: ChampionshipDraft[] = [];

  for (let index = 0; index < target.length; index += 1) {
    const draft = target[index]!;
    const profile = profiles[index]!;
    filled.push(applyProfileToChampionshipDraft(draft, profile, [...others, ...filled]));
  }

  const filledById = new Map(filled.map((draft) => [draft.id, draft]));
  return drafts.map((draft) => filledById.get(draft.id) ?? draft);
}

/**
 * "用模型库填充空位": walks the fixed seats in order and fills only the blank
 * ones from the saved model library, cycling through profiles and keeping every
 * name unique. Placeholder names (built-in preset labels such as "DeepSeek 甲")
 * are replaced by the profile name; a name the user typed is preserved.
 */
export function fillBlankSeatsWithProfiles(
  drafts: readonly ChampionshipDraft[],
  profiles: readonly ModelProfileView[],
): FillBlankSeatsResult {
  if (profiles.length === 0) {
    return { drafts: [...drafts], filled: 0 };
  }

  const next: ChampionshipDraft[] = [...drafts];
  let cursor = 0;
  let filled = 0;

  for (let index = 0; index < next.length; index += 1) {
    const draft = next[index]!;
    if (!isChampionshipDraftBlank(draft)) {
      continue;
    }
    const profile = profiles[cursor % profiles.length]!;
    cursor += 1;
    const applied = applyProfileToChampionshipDraft(draft, profile, next);
    next[index] = isPlaceholderSeatName(draft.name)
      ? {
          ...applied,
          name: uniqueModelName(
            profile.name,
            next.filter((candidate) => candidate.id !== draft.id),
          ),
        }
      : applied;
    filled += 1;
  }

  return { drafts: next, filled };
}

/** Built-in preset placeholder labels, e.g. "DeepSeek" or "DeepSeek 甲". */
function isPlaceholderSeatName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return true;
  }
  return PRESETS.some(
    (preset) => trimmed === preset.label || trimmed.startsWith(`${preset.label} `),
  );
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const CHAMPIONSHIP_PHASE_LABELS: Record<ChampionshipPhase, string> = {
  idle: '待抽签',
  running: '锦标赛进行中',
  finished: '已完赛',
  stopped: '已中止',
  error: '异常中止',
  interrupted: '中断待续',
};

export const CHAMPIONSHIP_PHASE_HINTS: Record<ChampionshipPhase, string> = {
  idle: '先完成入围赛（10 位模型分两组单循环，每组前二进入四号种子池），再抽签进入 16 强小组赛。',
  running:
    '小组单循环后按名次晋级；淘汰赛统一 6 局制、先到 3 分，决胜局胜者得 1 分、和局双方各得 1 分；可随时中止。',
  finished: '全部系列赛结束，冠军与晋级路径已经结算。',
  stopped: '锦标赛已中止，已完成成绩和断点均已保存；可继续锦标赛或重新配置下一届。',
  error: '锦标赛因异常中止，断点已保存；可继续锦标赛，或查看错误后重新配置下一届。',
  interrupted:
    '服务重启或断电后已恢复断点；已完成的对局与系列赛成绩保留，点击「继续锦标赛」接着进行。',
};

export const CHAMPIONSHIP_STAGE_LABELS: Record<ChampionshipStage, string> = {
  qualifier: '入围赛',
  group: '小组赛',
  quarterfinal: '八强赛',
  semifinal: '半决赛',
  final: '决赛',
};

export const CHAMPIONSHIP_STAGE_SHORT_LABELS: Record<ChampionshipStage, string> = {
  qualifier: '入围',
  group: '小组',
  quarterfinal: '八强',
  semifinal: '半决',
  final: '决赛',
};

export const CHAMPIONSHIP_STAGE_ORDER: readonly ChampionshipStage[] = [
  'group',
  'quarterfinal',
  'semifinal',
  'final',
];

export const CHAMPIONSHIP_KNOCKOUT_STAGES: readonly ChampionshipKnockoutStage[] = [
  'quarterfinal',
  'semifinal',
  'final',
];

export const CHAMPIONSHIP_SERIES_STATUS_LABELS: Record<ChampionshipSeriesStatus, string> = {
  pending: '待赛',
  running: '进行中',
  finished: '已结束',
  stopped: '已中止',
};

export const CHAMPIONSHIP_DECISION_LABELS: Record<ChampionshipSeriesDecision, string> = {
  points: `先到 ${CHAMPIONSHIP_SERIES_POINTS_TARGET} 分`,
  overtime: '同时 3 分 · 加赛先胜',
  ranking: `${CHAMPIONSHIP_SERIES_GAME_LIMIT} 局封顶 · 依小组排名`,
};

/** Used when both sides' group-phase rankings are identical and extra games decide. */
export const CHAMPIONSHIP_EXTRA_DECISION_LABEL = '小组排名相同 · 加赛决胜';

/**
 * Human-readable way the series was decided. `extra` wins the label because a
 * ranking tie sends the series past the six-game cap until someone wins.
 */
export function championshipSeriesDecisionLabel(
  series: Pick<ChampionshipSeriesView, 'decision' | 'extra'>,
): string | null {
  if (!series.decision) {
    return null;
  }
  if (series.extra) {
    return CHAMPIONSHIP_EXTRA_DECISION_LABEL;
  }
  return CHAMPIONSHIP_DECISION_LABELS[series.decision];
}

/**
 * Small in-progress badge for the overtime / extra-game states, or null when
 * the series is on the regular six-game track.
 */
export function championshipSeriesStageFlag(
  series: Pick<ChampionshipSeriesView, 'overtime' | 'extra' | 'status'>,
): string | null {
  if (series.extra) {
    return series.status === 'finished' ? '加赛决胜' : '加赛';
  }
  if (series.overtime) {
    return series.status === 'finished' ? '加赛胜出' : '加时';
  }
  return null;
}

const SERIES_STATUS_TONES: Record<ChampionshipSeriesStatus, TournamentTone> = {
  pending: 'idle',
  running: 'running',
  finished: 'finished',
  stopped: 'paused',
};

export function championshipStageLabel(stage: ChampionshipStage | null | undefined): string {
  return stage ? CHAMPIONSHIP_STAGE_LABELS[stage] : '待定';
}

export function championshipPhaseTone(phase: ChampionshipPhase): TournamentTone {
  switch (phase) {
    case 'running':
      return 'running';
    case 'finished':
      return 'finished';
    case 'stopped':
    case 'interrupted':
      return 'paused';
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

export function championshipSeriesStatusTone(
  status: ChampionshipSeriesStatus,
): TournamentTone {
  return SERIES_STATUS_TONES[status];
}

/* ------------------------------------------------------------------ */
/* Plan + rules copy                                                   */
/* ------------------------------------------------------------------ */

export interface ChampionshipPlan {
  entrants: number;
  pools: number;
  entrantsPerPool: number;
  groupSize: number;
  groups: number;
  groupGames: number;
  groupGamesPerEntrant: number;
  qualifiersPerGroup: number;
  seriesCount: number;
  /** Base games per knockout series (6). */
  seriesGameLimit: number;
  /** Series points needed to advance (3). */
  pointsTarget: number;
  /** Series points a decisive-game winner gets (1). */
  winPoints: number;
  /** Series points each side gets from a draw (1). */
  drawPoints: number;
  /** 7 series × 6 base games = 42 (extra games are outside this cap). */
  maxSeriesGames: number;
  /** 24 group games + 42 base knockout games = 66. */
  maxTotalGames: number;
}

export function calculateChampionshipPlan(): ChampionshipPlan {
  const seriesGameLimit = championshipSeriesGameLimit();
  return {
    entrants: CHAMPIONSHIP_ENTRANTS,
    pools: CHAMPIONSHIP_POOLS,
    entrantsPerPool: CHAMPIONSHIP_ENTRANTS_PER_POOL,
    groupSize: CHAMPIONSHIP_GROUP_SIZE,
    groups: CHAMPIONSHIP_GROUPS.length,
    groupGames: CHAMPIONSHIP_GROUP_GAMES,
    groupGamesPerEntrant: CHAMPIONSHIP_GROUP_GAMES_PER_ENTRANT,
    qualifiersPerGroup: CHAMPIONSHIP_QUALIFIERS_PER_GROUP,
    seriesCount: CHAMPIONSHIP_SERIES_COUNT,
    seriesGameLimit,
    pointsTarget: CHAMPIONSHIP_SERIES_POINTS_TARGET,
    winPoints: CHAMPIONSHIP_SERIES_WIN_POINTS,
    drawPoints: CHAMPIONSHIP_SERIES_DRAW_POINTS,
    maxSeriesGames: CHAMPIONSHIP_SERIES_COUNT * seriesGameLimit,
    maxTotalGames: CHAMPIONSHIP_MAX_GAMES,
  };
}

export const CHAMPIONSHIP_PLAN: ChampionshipPlan = calculateChampionshipPlan();

export const CHAMPIONSHIP_POINTS_LEGEND = `胜 +${TOURNAMENT_POINTS.win} · 和 +${TOURNAMENT_POINTS.draw} · 负 +${TOURNAMENT_POINTS.loss}`;

export const CHAMPIONSHIP_TIEBREAK_LEGEND =
  '同分依次比较：同分集团内的相互对局积分 → 胜场 → 和局 → 种子池位次（数字小者优先） → 报名顺序。';

export const CHAMPIONSHIP_RULES: readonly string[] = [
  `入围赛：10 位模型分入 A、B 两组（每组 5 人），组内单循环；每组前 ${CHAMPIONSHIP_QUALIFIER_ADVANCE_PER_GROUP} 名进入四号种子池，共 ${CHAMPIONSHIP_QUALIFIER_GROUP_GAMES} 局。`,
  `16 位选手分入四个种子池，抽签时每个池独立洗牌，再逐列转置成 A–D 四组，每组从每个池各取 1 位。`,
  `小组赛为组内单循环：每对选手交手一局，每组 ${CHAMPIONSHIP_GROUP_GAMES_PER_GROUP} 局，四组合计 ${CHAMPIONSHIP_GROUP_GAMES} 局；红黑按赛程平衡，每组前 ${CHAMPIONSHIP_QUALIFIERS_PER_GROUP} 名晋级八强。`,
  `小组同分时依次比较：同分集团内的相互对局积分 → 胜场 → 和局 → 种子池位次（数字小者优先） → 报名顺序。`,
  `八强赛、半决赛与决赛统一为 ${CHAMPIONSHIP_SERIES_GAME_LIMIT} 局制：决胜局胜者得 ${CHAMPIONSHIP_SERIES_WIN_POINTS} 分，和局双方各得 ${CHAMPIONSHIP_SERIES_DRAW_POINTS} 分，先到 ${CHAMPIONSHIP_SERIES_POINTS_TARGET} 分者晋级。`,
  `若同一局后双方同时达到 ${CHAMPIONSHIP_SERIES_POINTS_TARGET} 分（例如三连和形成 3:3），进入加赛：下一局决出胜负者赢得系列赛。`,
  `${CHAMPIONSHIP_SERIES_GAME_LIMIT} 局内无人先到 ${CHAMPIONSHIP_SERIES_POINTS_TARGET} 分时，依小组赛排名判定晋级；若双方小组排名完全相同，则继续加赛，直到出现决胜局。`,
  `常规总对局上限 ${CHAMPIONSHIP_MAX_GAMES} 局（小组 ${CHAMPIONSHIP_GROUP_GAMES} + 系列赛 ${CHAMPIONSHIP_SERIES_COUNT} × ${CHAMPIONSHIP_SERIES_GAME_LIMIT}）；小组排名相同触发的加赛不占用 ${CHAMPIONSHIP_SERIES_GAME_LIMIT} 局上限，可能超出，请预估模型调用与时间成本。`,
  `每局结束、中止或服务关闭时自动保存断点；服务重启或断电后可点「继续锦标赛」续赛。已完成对局保留，中断瞬间未结束的一局会重赛。`,
];

export const CHAMPIONSHIP_COST_WARNING = `整届锦标赛通常最多 ${CHAMPIONSHIP_MAX_GAMES} 局（小组 ${CHAMPIONSHIP_GROUP_GAMES} + 系列赛 ${CHAMPIONSHIP_SERIES_COUNT * CHAMPIONSHIP_SERIES_GAME_LIMIT}）；若双方小组排名完全相同，系列赛会加赛直到分出胜负，实际局数可能更多。均为真实模型调用，请确认额度充足，并可在任意时刻中止。`;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface ChampionshipValidation {
  ok: boolean;
  draftErrors: TournamentModelErrors;
  formErrors: string[];
}

export function validateChampionshipDrafts(
  drafts: readonly ChampionshipDraft[],
  profiles?: readonly ModelProfileView[],
): ChampionshipValidation {
  const draftErrors: TournamentModelErrors = {};
  const formErrors: string[] = [];
  const nameCounts = new Map<string, number>();

  for (const draft of drafts) {
    const key = normalizeModelName(draft.name);
    if (key.length > 0) {
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
  }

  for (const draft of drafts) {
    const errors: TournamentFieldErrors = { ...validateModelConfig(draft) };
    if (
      draft.profileId &&
      profiles &&
      !profiles.some((profile) => profile.id === draft.profileId)
    ) {
      errors.profile = '所选模型已不存在，请重新选择。';
    }

    const name = draft.name.trim();
    if (!name) {
      errors.name = '请填写名称。';
    } else if (name.length > 80) {
      errors.name = '名称过长，最多 80 个字符。';
    } else if ((nameCounts.get(normalizeModelName(name)) ?? 0) > 1) {
      errors.name = '名称不可重复。';
    }

    if (Object.keys(errors).length > 0) {
      draftErrors[draft.id] = errors;
    }
  }

  if (drafts.length !== CHAMPIONSHIP_DRAFT_COUNT) {
    formErrors.push(
      `本届固定 ${CHAMPIONSHIP_DRAFT_COUNT} 席（12 个直邀席 + 10 个入围赛席位），当前 ${drafts.length} 席，请刷新页面重试。`,
    );
  }

  const seededCounts = countDraftsByPool(seededDrafts(drafts));
  for (const pool of [1, 2, 3]) {
    const count = seededCounts[pool] ?? 0;
    if (count !== CHAMPIONSHIP_ENTRANTS_PER_POOL) {
      formErrors.push(
        `${championshipPoolLabel(pool)}须恰好 ${CHAMPIONSHIP_ENTRANTS_PER_POOL} 位，当前 ${count} 位。`,
      );
    }
  }

  const qualifierGroupCounts = countQualifierDraftsByGroup(drafts);
  for (const group of CHAMPIONSHIP_QUALIFIER_GROUPS) {
    const count = qualifierGroupCounts[group];
    if (count !== CHAMPIONSHIP_QUALIFIER_GROUP_SIZE) {
      formErrors.push(
        `${QUALIFIER_GROUP_LABELS[group]}须恰好 ${CHAMPIONSHIP_QUALIFIER_GROUP_SIZE} 位，当前 ${count} 位。`,
      );
    }
  }

  const misplaced = drafts.filter((draft) =>
    draft.qualifierGroup === null
      ? draft.seedPool < 1 || draft.seedPool > 3
      : draft.seedPool !== 4,
  );
  if (misplaced.length > 0) {
    formErrors.push('存在未正确归入种子池或入围赛组的席位，请刷新页面重试。');
  }

  return {
    ok: Object.keys(draftErrors).length === 0 && formErrors.length === 0,
    draftErrors,
    formErrors,
  };
}

/** Count of fields currently showing a validation error, for compact badges. */
export function championshipErrorCount(validation: ChampionshipValidation): number {
  const draftCount = Object.keys(validation.draftErrors).length;
  return draftCount + validation.formErrors.length;
}

/* ------------------------------------------------------------------ */
/* Random draw                                                         */
/* ------------------------------------------------------------------ */

/** Injectable 0–1 random source; the default uses Web Crypto. */
export type RandomSource = () => number;

export function webCryptoRandom(): number {
  const cryptoApi = typeof globalThis === 'undefined' ? undefined : globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    // 32 random bits — enough for a 4-item Fisher–Yates shuffle.
    const buffer = new Uint32Array(1);
    cryptoApi.getRandomValues(buffer);
    return buffer[0]! / 0x1_0000_0000;
  }
  // Non-secure fallback for exotic environments; browsers always hit Web Crypto.
  return Math.random();
}

/** Fisher–Yates shuffle that never mutates the input. */
export function shuffleWithRandom<T>(
  items: readonly T[],
  random: RandomSource = webCryptoRandom,
): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const raw = random();
    const unit = Number.isFinite(raw) ? Math.min(0.9999999999, Math.max(0, raw)) : 0;
    const swapIndex = Math.floor(unit * (index + 1));
    const temporary = result[index]!;
    result[index] = result[swapIndex]!;
    result[swapIndex] = temporary;
  }
  return result;
}

export interface ChampionshipDrawSlot {
  /** Seed pool the entrant came from (1–4). */
  pool: number;
  draftId: string;
  name: string;
}

export interface ChampionshipDrawGroup {
  id: ChampionshipGroupId;
  /** Exactly one slot per seed pool, ordered 甲→丁. */
  slots: ChampionshipDrawSlot[];
}

export interface ChampionshipDraw {
  groups: ChampionshipDrawGroup[];
  /** Reverse index used to badge the setup cards with their drawn group. */
  groupByDraftId: Record<string, ChampionshipGroupId>;
}

/**
 * The sixteen drafts that enter the main draw: the twelve seeded seats plus the
 * four qualifier winners (assigned to pool 4 by the qualifying round).
 */
export function composeDrawDrafts(
  drafts: readonly ChampionshipDraft[],
  qualified: readonly ChampionshipDraft[],
): ChampionshipDraft[] {
  const seeded = seededDrafts(drafts).filter((draft) => draft.seedPool <= 3);
  return [...seeded, ...qualified];
}

/**
 * Map the qualifier's four qualified model ids onto the current ten qualifier
 * seats. Returns null when the qualifying roster changed after the run (the
 * user must run the qualifier again) or when the state is not complete.
 */
export function qualifiedDraftsFromState(
  drafts: readonly ChampionshipDraft[],
  state: QualifierState | null,
): ChampionshipDraft[] | null {
  if (
    !state ||
    state.phase !== 'finished' ||
    state.qualifiedModelIds.length !== CHAMPIONSHIP_ENTRANTS_PER_POOL
  ) {
    return null;
  }

  const nameById = new Map(
    state.entrants.map((entrant) => [entrant.id, normalizeModelName(entrant.name)]),
  );
  const byName = new Map(
    qualifierDrafts(drafts).map((draft) => [normalizeModelName(draft.name), draft]),
  );
  const selected: ChampionshipDraft[] = [];

  for (const modelId of state.qualifiedModelIds) {
    const name = nameById.get(modelId);
    if (!name) return null;
    const draft = byName.get(name);
    if (!draft) return null;
    byName.delete(name);
    selected.push(draft);
  }

  return selected.length === CHAMPIONSHIP_ENTRANTS_PER_POOL ? selected : null;
}

/**
 * The championship draw: shuffle every seed pool independently, then transpose
 * the four shuffled columns into groups A–D. Each group therefore contains
 * exactly one entrant from every pool and no entrant appears twice.
 */
export function createChampionshipDraw(
  drafts: readonly ChampionshipDraft[],
  random: RandomSource = webCryptoRandom,
): ChampionshipDraw {
  const shuffledByPool = new Map<number, ChampionshipDraft[]>();

  for (const pool of CHAMPIONSHIP_SEED_POOLS) {
    const poolDrafts = draftsForPool(drafts, pool);
    if (poolDrafts.length !== CHAMPIONSHIP_ENTRANTS_PER_POOL) {
      throw new Error(
        `${championshipPoolLabel(pool)}须恰好 ${CHAMPIONSHIP_ENTRANTS_PER_POOL} 位，当前 ${poolDrafts.length} 位。`,
      );
    }
    shuffledByPool.set(pool, shuffleWithRandom(poolDrafts, random));
  }

  const groups: ChampionshipDrawGroup[] = CHAMPIONSHIP_GROUPS.map((id, groupIndex) => ({
    id,
    slots: CHAMPIONSHIP_SEED_POOLS.map((pool) => {
      const draft = shuffledByPool.get(pool)?.[groupIndex];
      if (!draft) {
        throw new Error('抽签数据不完整，请重试。');
      }
      return { pool, draftId: draft.id, name: draft.name.trim() };
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

/** Rebuild the drawn board from a server snapshot (running/finished state). */
export function championshipDrawFromState(
  state: ChampionshipState | null,
): ChampionshipDraw | null {
  if (!state || state.groups.length === 0) {
    return null;
  }

  const entrantById = new Map(state.entrants.map((entrant) => [entrant.id, entrant]));
  const groups: ChampionshipDrawGroup[] = [];

  for (const id of CHAMPIONSHIP_GROUPS) {
    const group = state.groups.find((candidate) => candidate.id === id);
    if (!group) {
      return null;
    }
    const slots: ChampionshipDrawSlot[] = [];
    for (const entrantId of group.entrantIds) {
      const entrant = entrantById.get(entrantId);
      if (!entrant) {
        return null;
      }
      slots.push({ pool: entrant.seedPool, draftId: entrant.id, name: entrant.name });
    }
    slots.sort((left, right) => left.pool - right.pool);
    groups.push({ id, slots });
  }

  const groupByDraftId: Record<string, ChampionshipGroupId> = {};
  for (const group of groups) {
    for (const slot of group.slots) {
      groupByDraftId[slot.draftId] = group.id;
    }
  }

  return { groups, groupByDraftId };
}

export interface ChampionshipGroupPreview {
  entrants: ChampionshipEntrantView[];
  groups: ChampionshipGroupView[];
}

/**
 * Build the four zero-point group tables from the local draw. This is used
 * before the server starts: the page can show each group's occupants and the
 * ranking/points layout immediately after the draw, not only after game one.
 */
export function buildChampionshipGroupPreview(
  drafts: readonly ChampionshipDraft[],
  draw: ChampionshipDraw | null,
): ChampionshipGroupPreview {
  if (!draw) {
    return { entrants: [], groups: [] };
  }

  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const entrants: ChampionshipEntrantView[] = [];

  for (const group of draw.groups) {
    for (const slot of group.slots) {
      const draft = draftById.get(slot.draftId);
      if (!draft) continue;
      entrants.push({
        id: draft.id,
        name: draft.name.trim() || '待配置',
        provider: draft.provider,
        model: draft.model.trim() || '待配置',
        thinkingLevel: draft.thinkingLevel,
        apiReasoning: draft.apiReasoning,
        keyConfigured: Boolean(draft.profileId || draft.apiKey),
        seedPool: draft.seedPool,
        groupId: group.id,
      });
    }
  }

  const entrantById = new Map(entrants.map((entrant) => [entrant.id, entrant]));
  const groups: ChampionshipGroupView[] = draw.groups.map((group) => {
    const groupEntrants = group.slots
      .map((slot) => entrantById.get(slot.draftId))
      .filter((entrant): entrant is ChampionshipEntrantView => Boolean(entrant));
    const standings: TournamentStanding[] = groupEntrants.map((entrant, index) => ({
      rank: index + 1,
      modelId: entrant.id,
      name: entrant.name,
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
    }));
    return {
      id: group.id,
      entrantIds: group.slots.map((slot) => slot.draftId),
      standings,
      complete: false,
      qualifiedModelIds: [],
    };
  });

  return { entrants, groups };
}

const SERIES_PREVIEW_SPEC: ReadonlyArray<{
  id: string;
  stage: Exclude<ChampionshipStage, 'qualifier' | 'group'>;
  slot: number;
  label: string;
  leftPlaceholder: string;
  rightPlaceholder: string;
}> = [
  {
    id: 'qf1',
    stage: 'quarterfinal',
    slot: 1,
    label: '八强赛 1',
    leftPlaceholder: 'A1',
    rightPlaceholder: 'B2',
  },
  {
    id: 'qf2',
    stage: 'quarterfinal',
    slot: 2,
    label: '八强赛 2',
    leftPlaceholder: 'C1',
    rightPlaceholder: 'D2',
  },
  {
    id: 'qf3',
    stage: 'quarterfinal',
    slot: 3,
    label: '八强赛 3',
    leftPlaceholder: 'B1',
    rightPlaceholder: 'A2',
  },
  {
    id: 'qf4',
    stage: 'quarterfinal',
    slot: 4,
    label: '八强赛 4',
    leftPlaceholder: 'D1',
    rightPlaceholder: 'C2',
  },
  {
    id: 'sf1',
    stage: 'semifinal',
    slot: 1,
    label: '半决赛 1',
    leftPlaceholder: '八强赛 1 胜者',
    rightPlaceholder: '八强赛 2 胜者',
  },
  {
    id: 'sf2',
    stage: 'semifinal',
    slot: 2,
    label: '半决赛 2',
    leftPlaceholder: '八强赛 3 胜者',
    rightPlaceholder: '八强赛 4 胜者',
  },
  {
    id: 'final',
    stage: 'final',
    slot: 1,
    label: '决赛',
    leftPlaceholder: '半决赛 1 胜者',
    rightPlaceholder: '半决赛 2 胜者',
  },
];

export const SERIES_SEED_PLACEHOLDERS: Readonly<
  Record<string, { left: string; right: string }>
> = Object.fromEntries(
  SERIES_PREVIEW_SPEC.map((spec) => [
    spec.id,
    { left: spec.leftPlaceholder, right: spec.rightPlaceholder },
  ]),
);

export function seriesSeedPlaceholder(
  series: Pick<ChampionshipSeriesView, 'id'>,
  side: 'left' | 'right',
): string {
  return SERIES_SEED_PLACEHOLDERS[series.id]?.[side] ?? '待定';
}

/**
 * Seven-node bracket preview. It shows the A1/B2 seed slots and "winner of…"
 * placeholders. The actual QF names are only known after the group stage, so we
 * deliberately do not fill them from the draw.
 */
export function buildChampionshipSeriesPreview(): ChampionshipSeriesView[] {
  return SERIES_PREVIEW_SPEC.map((spec) => ({
    id: spec.id,
    stage: spec.stage,
    label: spec.label,
    slot: spec.slot,
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
    maxGames: championshipSeriesGameLimit(spec.stage),
    overtime: false,
    extra: false,
    winnerModelId: null,
    decision: null,
  }));
}

export function toChampionshipStartRequest(
  drafts: readonly ChampionshipDraft[],
  draw: ChampionshipDraw,
): ChampionshipStartRequest {
  return {
    entrants: drafts.map((draft): ChampionshipEntrantRequest => {
      if (draft.profileId) {
        return {
          name: draft.name.trim(),
          seedPool: draft.seedPool,
          profileId: draft.profileId,
          thinkingLevel: draft.thinkingLevel,
          apiReasoning: draft.apiReasoning,
        };
      }
      return {
        name: draft.name.trim(),
        seedPool: draft.seedPool,
        provider: draft.provider,
        baseUrl: draft.baseUrl.trim(),
        model: draft.model.trim(),
        apiKey: draft.apiKey,
        thinkingLevel: draft.thinkingLevel,
        apiReasoning: draft.apiReasoning,
      };
    }),
    groups: draw.groups.map(
      (group): ChampionshipGroupInput => ({
        id: group.id,
        entrantNames: group.slots.map((slot) => slot.name),
      }),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Game / series grouping helpers                                      */
/* ------------------------------------------------------------------ */

export function groupStageGames(
  games: readonly ChampionshipGameView[],
): ChampionshipGameView[] {
  return games.filter((game) => game.stage === 'group');
}

export function gamesForGroup(
  games: readonly ChampionshipGameView[],
  groupId: ChampionshipGroupId,
): ChampionshipGameView[] {
  return groupStageGames(games).filter((game) => game.groupId === groupId);
}

export function gamesForSeries(
  games: readonly ChampionshipGameView[],
  seriesId: string,
): ChampionshipGameView[] {
  return games
    .filter((game) => game.seriesId === seriesId)
    .slice()
    .sort((left, right) => left.gameIndex - right.gameIndex);
}

export function findCurrentChampionshipGame(
  state: ChampionshipState | null,
): ChampionshipGameView | null {
  if (!state || !state.currentGameId) {
    return null;
  }
  return state.games.find((game) => game.id === state.currentGameId) ?? null;
}

export function findCurrentSeries(
  state: ChampionshipState | null,
): ChampionshipSeriesView | null {
  if (!state || !state.currentSeriesId) {
    return null;
  }
  return state.series.find((series) => series.id === state.currentSeriesId) ?? null;
}

export interface ChampionshipBracket {
  quarterfinal: ChampionshipSeriesView[];
  semifinal: ChampionshipSeriesView[];
  final: ChampionshipSeriesView[];
}

const KNOCKOUT_STAGE_KEYS: ReadonlyArray<keyof ChampionshipBracket> = [
  'quarterfinal',
  'semifinal',
  'final',
];

export function buildChampionshipBracket(
  series: readonly ChampionshipSeriesView[],
): ChampionshipBracket {
  const bracket: ChampionshipBracket = {
    quarterfinal: [],
    semifinal: [],
    final: [],
  };

  for (const item of series) {
    const key = item.stage as keyof ChampionshipBracket;
    if (KNOCKOUT_STAGE_KEYS.includes(key)) {
      bracket[key].push(item);
    }
  }

  for (const key of KNOCKOUT_STAGE_KEYS) {
    bracket[key].sort((left, right) => left.slot - right.slot);
  }

  return bracket;
}

export function seriesWinnerName(series: ChampionshipSeriesView): string | null {
  if (!series.winnerModelId) {
    return null;
  }
  if (series.left?.modelId === series.winnerModelId) {
    return series.left.name;
  }
  if (series.right?.modelId === series.winnerModelId) {
    return series.right.name;
  }
  return null;
}

export function seriesSideName(
  side: ChampionshipSeriesView['left'],
): string {
  return side ? side.name : '待定';
}

/** Top-two marker for the live group table: final qualifiers vs. provisional. */
export function groupStandingQualified(
  group: ChampionshipGroupView,
  standing: TournamentStanding,
): boolean {
  if (group.complete && group.qualifiedModelIds.length > 0) {
    return group.qualifiedModelIds.includes(standing.modelId);
  }
  return standing.rank <= CHAMPIONSHIP_QUALIFIERS_PER_GROUP;
}

export function groupQualificationLabel(
  group: ChampionshipGroupView,
  standing: TournamentStanding,
): string {
  if (!groupStandingQualified(group, standing)) {
    return '';
  }
  return group.complete ? '已晋级' : '暂列晋级';
}

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */

export function formatChampionshipClock(timestamp: number | null): string {
  return formatTournamentClock(timestamp);
}

/** Primary scoreboard number: series points (win = 1 to winner, draw = 1 each). */
export function formatChampionshipScore(series: ChampionshipSeriesView): string {
  return `${series.leftPoints} : ${series.rightPoints}`;
}

/** Decisive-game wins, shown as secondary meta next to the points score. */
export function formatChampionshipWins(series: ChampionshipSeriesView): string {
  return `${series.leftWins} : ${series.rightWins}`;
}

export function formatSeriesProgress(series: ChampionshipSeriesView): string {
  const max =
    series.maxGames > 0
      ? series.maxGames
      : championshipSeriesGameLimit(series.stage);
  return `${series.playedGames}/${max}${series.extra ? '+' : ''}`;
}

export function formatSeriesRecord(series: ChampionshipSeriesView): string {
  return `决胜 ${formatChampionshipWins(series)} · 和 ${series.draws} · 异常 ${series.failed}`;
}

export function formatChampionshipGameResult(game: ChampionshipGameView): string {
  return describeTournamentGameResult(game);
}

/** Short description of the current game, including its bracket slot. */
export function describeCurrentGame(state: ChampionshipState | null): string | null {
  const game = findCurrentChampionshipGame(state);
  if (!game) {
    return null;
  }

  if (game.stage === 'group') {
    return `${championshipGroupLabel(game.groupId)} · 红方 ${game.redName} 对 黑方 ${game.blackName} · 第 ${game.pairIndex} 对`;
  }

  const series = state?.series.find((item) => item.id === game.seriesId);
  const label = series ? championshipSeriesLabel(series) : championshipStageLabel(game.stage);
  return `${label} · 第 ${game.gameIndex} 局 · 红方 ${game.redName} 对 黑方 ${game.blackName}`;
}

export function championshipSeriesLabel(series: ChampionshipSeriesView): string {
  const trimmed = series.label.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }
  return `${championshipStageLabel(series.stage)} · 第 ${series.slot} 场`;
}

export interface ChampionshipProgress {
  maxGames: number;
  processedGames: number;
  completedGames: number;
  percent: number;
  groupGamesProcessed: number;
  groupGamesTotal: number;
  seriesProcessed: number;
  seriesTotal: number;
}

/** Stage weights for the monotonic progress bar: group 60%, knockout 40%. */
const GROUP_STAGE_PROGRESS_WEIGHT = 60;
const KNOCKOUT_STAGE_PROGRESS_WEIGHT = 40;

function clampFraction(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(1, value);
}

/**
 * Stage-weighted progress. `processedGames / scheduledGames` is not monotonic
 * because knockout games are only scheduled as each series begins, so the bar
 * is driven by completed stage work instead: 60% for the group phase (24 games)
 * and 40% for the seven knockout series. Exact counts stay in the chips.
 */
export function championshipProgress(state: ChampionshipState | null): ChampionshipProgress {
  const groupGamesTotal =
    state && state.groupGamesTotal > 0
      ? state.groupGamesTotal
      : CHAMPIONSHIP_GROUP_GAMES;
  const seriesTotal =
    state && state.seriesTotal > 0 ? state.seriesTotal : CHAMPIONSHIP_SERIES_COUNT;
  // Stopping a run marks every unplayed game as canceled. Canceled games were
  // never played, so they must not inflate the progress counters.
  const canceledGames = state?.games.filter((game) => game.status === 'canceled') ?? [];
  const canceledGroupGames = canceledGames.filter(
    (game) => game.stage === 'group',
  ).length;
  const groupGamesProcessed = Math.max(
    0,
    (state?.groupGamesProcessed ?? 0) - canceledGroupGames,
  );
  const processedGames = Math.max(0, (state?.processedGames ?? 0) - canceledGames.length);
  const seriesProcessed = state?.seriesProcessed ?? 0;
  const groupFraction = clampFraction(groupGamesProcessed / groupGamesTotal);
  const knockoutFraction = clampFraction(seriesProcessed / seriesTotal);
  const weighted =
    groupFraction * GROUP_STAGE_PROGRESS_WEIGHT +
    knockoutFraction * KNOCKOUT_STAGE_PROGRESS_WEIGHT;
  const percent =
    state?.phase === 'finished' ? 100 : Math.min(99, Math.round(weighted));

  return {
    maxGames: CHAMPIONSHIP_MAX_GAMES,
    processedGames,
    completedGames: state?.completedGames ?? 0,
    percent: Math.max(0, percent),
    groupGamesProcessed,
    groupGamesTotal,
    seriesProcessed,
    seriesTotal,
  };
}

export function championshipAriaSummary(
  state: ChampionshipState | null,
  loadError: string | null,
): string {
  if (!state) {
    return loadError ? '锦标赛服务尚未就绪。' : '正在连接锦标赛服务。';
  }

  const progress = championshipProgress(state);
  const parts: string[] = [
    `十六强锦标赛，${CHAMPIONSHIP_PHASE_LABELS[state.phase]}`,
    state.stage ? `当前阶段 ${championshipStageLabel(state.stage)}` : '',
    `已完成进度 ${progress.percent}%`,
    `已处理 ${progress.processedGames} 局`,
    `小组赛 ${progress.groupGamesProcessed}/${progress.groupGamesTotal} 局`,
    `系列赛 ${progress.seriesProcessed}/${progress.seriesTotal} 场`,
  ];

  if (state.championName) {
    parts.push(`冠军 ${state.championName}`);
  }

  if (state.error) {
    parts.push(`锦标赛异常：${state.error}`);
  }

  return `${parts.filter((part) => part.length > 0).join('，')}。`;
}

/** Small badge label used by the setup cards to show the drawn group. */
export function drawnGroupBadge(draw: ChampionshipDraw | null, draftId: string): string {
  const group = draw?.groupByDraftId[draftId];
  return group ? championshipGroupLabel(group) : '';
}

/** Whether the seeded pools and qualifying groups are complete. */
export function isChampionshipPoolLayoutValid(
  drafts: readonly ChampionshipDraft[],
): boolean {
  const seededCounts = countDraftsByPool(seededDrafts(drafts));
  const qualifierCounts = countQualifierDraftsByGroup(drafts);
  return (
    [1, 2, 3].every(
      (pool) => (seededCounts[pool] ?? 0) === CHAMPIONSHIP_ENTRANTS_PER_POOL,
    ) &&
    CHAMPIONSHIP_QUALIFIER_GROUPS.every(
      (group) => qualifierCounts[group] === CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
    )
  );
}
