import type {
  ChampionshipGroupId,
  ChampionshipGroupInput,
  ModelSetup,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_ENTRANTS,
  CHAMPIONSHIP_ENTRANTS_PER_POOL,
  CHAMPIONSHIP_GROUPS,
  CHAMPIONSHIP_GROUP_SIZE,
  CHAMPIONSHIP_MAX_CONCURRENCY,
  CHAMPIONSHIP_MIN_CONCURRENCY,
  CHAMPIONSHIP_POOLS,
  CHAMPIONSHIP_SEED_POOLS,
} from '../../shared/protocol';
import type { ModelProfileLookup } from '../providers/validate';
import { ValidationError } from '../providers/validate';
import { asRecord, resolveEntrantSetup, validateEntrantName } from './entrants';

/** One validated championship entrant, before the engine assigns ids/groups. */
export interface ChampionshipEntrant {
  name: string;
  /** 1–4; the user-defined seed pot. */
  seedPool: number;
  setup: ModelSetup;
}

/**
 * Fully validated start payload. The engine reassigns ids (m1…m16 in input
 * order) and derives the actual group membership from `groups`.
 */
export interface ValidatedChampionshipStart {
  entrants: ChampionshipEntrant[];
  /** Groups A–D in canonical order; each name list is sorted by seed pool. */
  groups: ChampionshipGroupInput[];
  /** Max simultaneous games/series; omitted in the request means serial. */
  concurrency: number;
}

function validateSeedPool(raw: unknown, label: string): number {
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < 1 ||
    raw > CHAMPIONSHIP_POOLS
  ) {
    throw new ValidationError(
      `${label}的种子池必须是 1 到 ${CHAMPIONSHIP_POOLS} 之间的整数`,
    );
  }
  return raw;
}

export function validateConcurrency(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    return 1;
  }
  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < CHAMPIONSHIP_MIN_CONCURRENCY ||
    raw > CHAMPIONSHIP_MAX_CONCURRENCY
  ) {
    throw new ValidationError(
      `并发局数必须是 ${CHAMPIONSHIP_MIN_CONCURRENCY} 到 ${CHAMPIONSHIP_MAX_CONCURRENCY} 之间的整数`,
    );
  }
  return raw;
}

function validateEntrants(
  rawEntrants: unknown,
  profiles: ModelProfileLookup | undefined,
): ChampionshipEntrant[] {
  if (!Array.isArray(rawEntrants)) {
    throw new ValidationError('entrants 必须是参赛模型配置数组');
  }
  if (rawEntrants.length !== CHAMPIONSHIP_ENTRANTS) {
    throw new ValidationError(
      `锦标赛需要 ${CHAMPIONSHIP_ENTRANTS} 位参赛模型，当前为 ${rawEntrants.length} 位`,
    );
  }

  const names = new Set<string>();
  return rawEntrants.map((raw, index) => {
    const label = `第 ${index + 1} 个参赛模型`;
    const item = asRecord(raw);
    if (!item) {
      throw new ValidationError(`${label}配置缺失`);
    }

    const name = validateEntrantName(item.name, label);
    const key = name.toLocaleLowerCase();
    if (names.has(key)) {
      throw new ValidationError(`参赛模型名称重复：${name}`);
    }
    names.add(key);

    const seedPool = validateSeedPool(item.seedPool, label);
    const setup = resolveEntrantSetup(item, label, name, profiles);
    return { name, seedPool, setup };
  });
}

function validatePoolCounts(entrants: readonly ChampionshipEntrant[]): void {
  const counts = new Map<number, number>(
    CHAMPIONSHIP_SEED_POOLS.map((pool) => [pool, 0]),
  );
  for (const entrant of entrants) {
    counts.set(entrant.seedPool, (counts.get(entrant.seedPool) ?? 0) + 1);
  }
  for (const pool of CHAMPIONSHIP_SEED_POOLS) {
    if ((counts.get(pool) ?? 0) !== CHAMPIONSHIP_ENTRANTS_PER_POOL) {
      throw new ValidationError(
        `第 ${pool} 种子池必须恰好有 ${CHAMPIONSHIP_ENTRANTS_PER_POOL} 位参赛模型`,
      );
    }
  }
}

function validateGroups(
  rawGroups: unknown,
  entrants: readonly ChampionshipEntrant[],
): ChampionshipGroupInput[] {
  if (!Array.isArray(rawGroups)) {
    throw new ValidationError('groups 必须是分组数组');
  }
  if (rawGroups.length !== CHAMPIONSHIP_GROUPS.length) {
    throw new ValidationError(`分组必须包含 A、B、C、D 四组`);
  }

  const entrantByKey = new Map<string, ChampionshipEntrant>(
    entrants.map((entrant) => [entrant.name.toLocaleLowerCase(), entrant]),
  );
  const seenGroups = new Set<ChampionshipGroupId>();
  const assignedGroups = new Map<string, ChampionshipGroupId>();
  const groups: ChampionshipGroupInput[] = [];

  for (const raw of rawGroups) {
    const item = asRecord(raw);
    if (!item) {
      throw new ValidationError('分组配置缺失');
    }
    const id = item.id;
    if (
      typeof id !== 'string' ||
      !CHAMPIONSHIP_GROUPS.includes(id as ChampionshipGroupId)
    ) {
      throw new ValidationError('分组编号必须是 A、B、C 或 D');
    }
    const groupId = id as ChampionshipGroupId;
    if (seenGroups.has(groupId)) {
      throw new ValidationError(`分组 ${groupId} 被重复配置`);
    }
    seenGroups.add(groupId);

    if (!Array.isArray(item.entrantNames)) {
      throw new ValidationError(`分组 ${groupId} 的参赛名单必须是数组`);
    }
    if (item.entrantNames.length !== CHAMPIONSHIP_GROUP_SIZE) {
      throw new ValidationError(
        `分组 ${groupId} 必须恰好有 ${CHAMPIONSHIP_GROUP_SIZE} 位参赛模型`,
      );
    }

    const members: ChampionshipEntrant[] = [];
    const memberKeys = new Set<string>();
    for (const rawName of item.entrantNames) {
      if (typeof rawName !== 'string' || !rawName.trim()) {
        throw new ValidationError(`分组 ${groupId} 的参赛名单包含空名称`);
      }
      const name = rawName.trim();
      const key = name.toLocaleLowerCase();
      if (memberKeys.has(key)) {
        throw new ValidationError(`分组 ${groupId} 中参赛模型重复：${name}`);
      }
      memberKeys.add(key);

      const entrant = entrantByKey.get(key);
      if (!entrant) {
        throw new ValidationError(`分组 ${groupId} 中的参赛模型不存在：${name}`);
      }
      const previous = assignedGroups.get(key);
      if (previous) {
        throw new ValidationError(
          `参赛模型 ${entrant.name} 被重复分配到分组 ${previous} 与 ${groupId}`,
        );
      }
      assignedGroups.set(key, groupId);
      members.push(entrant);
    }

    // Exactly one entrant from every seed pool keeps the groups balanced.
    const pools = new Set(members.map((member) => member.seedPool));
    if (pools.size !== CHAMPIONSHIP_POOLS) {
      throw new ValidationError(
        `分组 ${groupId} 必须各含一位来自 ${CHAMPIONSHIP_POOLS} 个种子池的参赛模型`,
      );
    }

    members.sort((a, b) => a.seedPool - b.seedPool);
    groups.push({ id: groupId, entrantNames: members.map((member) => member.name) });
  }

  for (const groupId of CHAMPIONSHIP_GROUPS) {
    if (!seenGroups.has(groupId)) {
      throw new ValidationError(`缺少分组 ${groupId} 的配置`);
    }
  }
  for (const entrant of entrants) {
    if (!assignedGroups.has(entrant.name.toLocaleLowerCase())) {
      throw new ValidationError(`参赛模型 ${entrant.name} 未分配到任何分组`);
    }
  }

  groups.sort(
    (a, b) => CHAMPIONSHIP_GROUPS.indexOf(a.id) - CHAMPIONSHIP_GROUPS.indexOf(b.id),
  );
  return groups;
}

/**
 * Validate a championship start request: exactly 16 uniquely named entrants,
 * four per seed pot, and four groups that each contain one entrant from every
 * pot and together use all sixteen entrants exactly once.
 */
export function validateChampionshipStartRequest(
  body: unknown,
  profiles?: ModelProfileLookup,
): ValidatedChampionshipStart {
  const input = asRecord(body);
  if (!input) {
    throw new ValidationError('请求体必须是 JSON 对象');
  }

  const entrants = validateEntrants(input.entrants, profiles);
  validatePoolCounts(entrants);
  const groups = validateGroups(input.groups, entrants);
  const concurrency = validateConcurrency(input.concurrency);

  return { entrants, groups, concurrency };
}
