import type { ModelSetup, QualifierGroupId, QualifierGroupInput } from '../../shared/protocol';
import {
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_QUALIFIER_GROUPS,
  CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
} from '../../shared/protocol';
import type { ModelProfileLookup } from '../providers/validate';
import { ValidationError } from '../providers/validate';
import { asRecord, resolveEntrantSetup, validateEntrantName } from './entrants';
import { validateConcurrency } from './validate';

/** One validated qualifying-round entrant, before the engine assigns ids. */
export interface QualifierEntrant {
  name: string;
  setup: ModelSetup;
}

/**
 * Fully validated qualifying-round payload. The engine reassigns ids (m1…m10
 * in input order), derives each entrant's group from `groups`, and keeps the
 * name order inside `groups` as the seat order used by the schedule.
 */
export interface ValidatedQualifierStart {
  entrants: QualifierEntrant[];
  /** Groups A and B in canonical order; five names each in seat order. */
  groups: QualifierGroupInput[];
  /** Max simultaneous games; omitted in the request means serial. */
  concurrency: number;
}

function validateEntrants(
  rawEntrants: unknown,
  profiles: ModelProfileLookup | undefined,
): QualifierEntrant[] {
  if (!Array.isArray(rawEntrants)) {
    throw new ValidationError('entrants 必须是参赛模型配置数组');
  }
  if (rawEntrants.length !== CHAMPIONSHIP_QUALIFIER_ENTRANTS) {
    throw new ValidationError(
      `入围赛需要 ${CHAMPIONSHIP_QUALIFIER_ENTRANTS} 位参赛模型，当前为 ${rawEntrants.length} 位`,
    );
  }

  const names = new Set<string>();
  return rawEntrants.map((raw, index) => {
    const label = `第 ${index + 1} 个入围赛模型`;
    const item = asRecord(raw);
    if (!item) {
      throw new ValidationError(`${label}配置缺失`);
    }

    const name = validateEntrantName(item.name, label);
    const key = name.toLocaleLowerCase();
    if (names.has(key)) {
      throw new ValidationError(`入围赛模型名称重复：${name}`);
    }
    names.add(key);

    return { name, setup: resolveEntrantSetup(item, label, name, profiles) };
  });
}

function validateGroups(
  rawGroups: unknown,
  entrants: readonly QualifierEntrant[],
): QualifierGroupInput[] {
  if (!Array.isArray(rawGroups)) {
    throw new ValidationError('groups 必须是分组数组');
  }
  if (rawGroups.length !== CHAMPIONSHIP_QUALIFIER_GROUPS.length) {
    throw new ValidationError('入围赛必须包含 A、B 两组');
  }

  const entrantByKey = new Map<string, QualifierEntrant>(
    entrants.map((entrant) => [entrant.name.toLocaleLowerCase(), entrant]),
  );
  const seenGroups = new Set<QualifierGroupId>();
  const assigned = new Map<string, QualifierGroupId>();
  const groups: QualifierGroupInput[] = [];

  for (const raw of rawGroups) {
    const item = asRecord(raw);
    if (!item) {
      throw new ValidationError('入围赛分组配置缺失');
    }
    const id = item.id;
    if (
      typeof id !== 'string' ||
      !CHAMPIONSHIP_QUALIFIER_GROUPS.includes(id as QualifierGroupId)
    ) {
      throw new ValidationError('入围赛分组编号必须是 A 或 B');
    }
    const groupId = id as QualifierGroupId;
    if (seenGroups.has(groupId)) {
      throw new ValidationError(`入围赛分组 ${groupId} 被重复配置`);
    }
    seenGroups.add(groupId);

    if (!Array.isArray(item.entrantNames)) {
      throw new ValidationError(`入围赛分组 ${groupId} 的参赛名单必须是数组`);
    }
    if (item.entrantNames.length !== CHAMPIONSHIP_QUALIFIER_GROUP_SIZE) {
      throw new ValidationError(
        `入围赛分组 ${groupId} 必须恰好有 ${CHAMPIONSHIP_QUALIFIER_GROUP_SIZE} 位参赛模型`,
      );
    }

    const memberKeys = new Set<string>();
    const memberNames: string[] = [];
    for (const rawName of item.entrantNames) {
      if (typeof rawName !== 'string' || !rawName.trim()) {
        throw new ValidationError(`入围赛分组 ${groupId} 的参赛名单包含空名称`);
      }
      const name = rawName.trim();
      const key = name.toLocaleLowerCase();
      if (memberKeys.has(key)) {
        throw new ValidationError(`入围赛分组 ${groupId} 中参赛模型重复：${name}`);
      }
      memberKeys.add(key);

      const entrant = entrantByKey.get(key);
      if (!entrant) {
        throw new ValidationError(`入围赛分组 ${groupId} 中的参赛模型不存在：${name}`);
      }
      const previous = assigned.get(key);
      if (previous) {
        throw new ValidationError(
          `参赛模型 ${entrant.name} 被重复分配到分组 ${previous} 与 ${groupId}`,
        );
      }
      assigned.set(key, groupId);
      memberNames.push(entrant.name);
    }

    groups.push({ id: groupId, entrantNames: memberNames });
  }

  for (const groupId of CHAMPIONSHIP_QUALIFIER_GROUPS) {
    if (!seenGroups.has(groupId)) {
      throw new ValidationError(`缺少入围赛分组 ${groupId} 的配置`);
    }
  }
  for (const entrant of entrants) {
    if (!assigned.has(entrant.name.toLocaleLowerCase())) {
      throw new ValidationError(`参赛模型 ${entrant.name} 未分配到任何入围赛分组`);
    }
  }

  groups.sort(
    (a, b) =>
      CHAMPIONSHIP_QUALIFIER_GROUPS.indexOf(a.id) -
      CHAMPIONSHIP_QUALIFIER_GROUPS.indexOf(b.id),
  );
  return groups;
}

/**
 * Validate a qualifying-round start request: exactly ten uniquely named
 * entrants and two groups of five that together use all ten exactly once.
 */
export function validateQualifierStartRequest(
  body: unknown,
  profiles?: ModelProfileLookup,
): ValidatedQualifierStart {
  const input = asRecord(body);
  if (!input) {
    throw new ValidationError('请求体必须是 JSON 对象');
  }

  const entrants = validateEntrants(input.entrants, profiles);
  const groups = validateGroups(input.groups, entrants);
  const concurrency = validateConcurrency(input.concurrency);

  return { entrants, groups, concurrency };
}
