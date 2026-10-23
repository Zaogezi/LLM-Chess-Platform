import { describe, expect, it } from 'vitest';
import type { ChampionshipGroupId } from '../../shared/protocol';
import { CHAMPIONSHIP_GROUPS } from '../../shared/protocol';
import { ValidationError } from '../providers/validate';
import { validateChampionshipStartRequest } from './validate';

const GROUP_IDS: readonly ChampionshipGroupId[] = CHAMPIONSHIP_GROUPS;
/** A1…D4: the trailing digit is the seed pool. */
const ENTRANT_NAMES = GROUP_IDS.flatMap((groupId) =>
  [1, 2, 3, 4].map((pool) => `${groupId}${pool}`),
);

function entrant(name: string, patch: Record<string, unknown> = {}) {
  return {
    name,
    seedPool: Number(name.slice(1)),
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    model: `${name.toLocaleLowerCase()}-model`,
    apiKey: `secret-${name}`,
    thinkingLevel: 'quick',
    apiReasoning: false,
    ...patch,
  };
}

function validGroups() {
  return GROUP_IDS.map((groupId) => ({
    id: groupId,
    entrantNames: [1, 2, 3, 4].map((pool) => `${groupId}${pool}`),
  }));
}

function validBody() {
  return {
    entrants: ENTRANT_NAMES.map((name) => entrant(name)),
    groups: validGroups(),
  };
}

describe('validateChampionshipStartRequest', () => {
  it('normalizes 16 entrants and four balanced groups', () => {
    const input = validateChampionshipStartRequest(validBody());

    expect(input.entrants).toHaveLength(16);
    expect(input.entrants.map((item) => item.name)).toEqual(ENTRANT_NAMES);
    expect(input.entrants.map((item) => item.seedPool)).toEqual(
      ENTRANT_NAMES.map((name) => Number(name.slice(1))),
    );
    expect(input.entrants[0]?.setup).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      model: 'a1-model',
      apiKey: 'secret-A1',
      thinkingLevel: 'quick',
      apiReasoning: false,
    });

    expect(input.groups.map((group) => group.id)).toEqual(['A', 'B', 'C', 'D']);
    for (const group of input.groups) {
      expect(group.entrantNames).toEqual(
        [1, 2, 3, 4].map((pool) => `${group.id}${pool}`),
      );
    }
  });

  it('canonicalizes group order, names and seed-pool order', () => {
    const body = validBody();
    body.groups = [
      { id: 'D', entrantNames: ['D4', 'D1', 'D3', 'D2'] },
      { id: 'B', entrantNames: [' b2 ', 'B1', 'B4', 'B3'] },
      { id: 'A', entrantNames: ['A3', 'A2', 'A1', 'A4'] },
      { id: 'C', entrantNames: ['C2', 'C1', 'C4', 'C3'] },
    ];

    const input = validateChampionshipStartRequest(body);

    expect(input.groups.map((group) => group.id)).toEqual(['A', 'B', 'C', 'D']);
    expect(input.groups[0]?.entrantNames).toEqual(['A1', 'A2', 'A3', 'A4']);
    expect(input.groups[1]?.entrantNames).toEqual(['B1', 'B2', 'B3', 'B4']);
    expect(input.groups[2]?.entrantNames).toEqual(['C1', 'C2', 'C3', 'C4']);
    expect(input.groups[3]?.entrantNames).toEqual(['D1', 'D2', 'D3', 'D4']);
  });

  it('resolves saved model-library entrants with per-game overrides', () => {
    const profiles = {
      resolveSetup(id: string) {
        if (id !== 'saved-a') return null;
        return {
          provider: 'anthropic' as const,
          baseUrl: 'https://saved.test/v1',
          model: 'saved-model',
          apiKey: 'saved-secret',
          displayName: '库中模型',
          thinkingLevel: 'balanced' as const,
          apiReasoning: false,
        };
      },
    };
    const body = validBody();
    body.entrants[0] = {
      name: 'A1',
      seedPool: 1,
      profileId: 'saved-a',
      thinkingLevel: 'deep',
      apiReasoning: true,
    } as never;
    body.entrants[1] = { name: 'A2', seedPool: 2, profileId: 'saved-a' } as never;

    const input = validateChampionshipStartRequest(body, profiles);

    expect(input.entrants[0]?.setup).toMatchObject({
      provider: 'anthropic',
      model: 'saved-model',
      apiKey: 'saved-secret',
      displayName: '库中模型',
      thinkingLevel: 'deep',
      apiReasoning: true,
    });
    expect(input.entrants[1]?.setup).toMatchObject({
      thinkingLevel: 'balanced',
      apiReasoning: false,
    });
  });

  it('rejects a non-object body', () => {
    for (const body of [null, [], 'x', 3]) {
      expect(() => validateChampionshipStartRequest(body)).toThrow(ValidationError);
    }
  });

  it('rejects the wrong entrant count', () => {
    const body = validBody();
    body.entrants = body.entrants.slice(0, 15);
    expect(() => validateChampionshipStartRequest(body)).toThrow(/16 位参赛模型/);

    body.entrants = [...validBody().entrants, entrant('E1', { seedPool: 1 })];
    expect(() => validateChampionshipStartRequest(body)).toThrow(/16 位参赛模型/);
  });

  it('rejects missing, duplicate and invalid entrant fields', () => {
    const missingName = validBody();
    missingName.entrants[0] = entrant('A1', { name: '   ' });
    expect(() => validateChampionshipStartRequest(missingName)).toThrow(/填写名称/);

    const duplicate = validBody();
    duplicate.entrants[1] = entrant('a1', { seedPool: 2 });
    expect(() => validateChampionshipStartRequest(duplicate)).toThrow(/名称重复/);

    for (const seedPool of [0, 5, 1.5, '1', null]) {
      const bad = validBody();
      bad.entrants[0] = { ...entrant('A1'), seedPool } as never;
      expect(() => validateChampionshipStartRequest(bad)).toThrow(/种子池/);
    }

    const badSetup = validBody();
    badSetup.entrants[0] = entrant('A1', { baseUrl: 'ftp://bad' });
    expect(() => validateChampionshipStartRequest(badSetup)).toThrow(ValidationError);
  });

  it('rejects unbalanced seed pools', () => {
    const body = validBody();
    body.entrants[0] = entrant('A1', { seedPool: 1 });
    body.entrants[1] = entrant('A2', { seedPool: 1 });
    body.entrants[2] = entrant('A3', { seedPool: 1 });
    body.entrants[3] = entrant('A4', { seedPool: 1 });
    body.entrants[4] = entrant('B1', { seedPool: 1 });
    body.entrants[5] = entrant('B2', { seedPool: 2 });
    expect(() => validateChampionshipStartRequest(body)).toThrow(/种子池必须恰好/);
  });

  it('rejects malformed group lists', () => {
    const notArray = validBody();
    notArray.groups = 'x' as never;
    expect(() => validateChampionshipStartRequest(notArray)).toThrow(/分组数组/);

    const tooFew = validBody();
    tooFew.groups = tooFew.groups.slice(0, 3);
    expect(() => validateChampionshipStartRequest(tooFew)).toThrow(/四组/);

    const duplicateId = validBody();
    duplicateId.groups[1] = { ...duplicateId.groups[1]!, id: 'A' };
    expect(() => validateChampionshipStartRequest(duplicateId)).toThrow(/重复配置/);

    const badId = validBody();
    badId.groups[0] = { ...badId.groups[0]!, id: 'E' as never };
    expect(() => validateChampionshipStartRequest(badId)).toThrow(/A、B、C 或 D/);

    const wrongSize = validBody();
    wrongSize.groups[0] = { id: 'A', entrantNames: ['A1', 'A2', 'A3'] };
    expect(() => validateChampionshipStartRequest(wrongSize)).toThrow(/恰好有 4 位/);
  });

  it('validates the optional concurrency limit', () => {
    expect(validateChampionshipStartRequest(validBody()).concurrency).toBe(1);

    const body = validBody() as Record<string, unknown>;
    body.concurrency = 4;
    expect(validateChampionshipStartRequest(body).concurrency).toBe(4);

    for (const concurrency of [0, 9, 2.5, '4', -1]) {
      const bad = validBody() as Record<string, unknown>;
      bad.concurrency = concurrency;
      expect(() => validateChampionshipStartRequest(bad)).toThrow(/并发局数/);
    }
  });

  it('rejects unknown, duplicated and missing group members', () => {
    const unknown = validBody();
    unknown.groups[0] = { id: 'A', entrantNames: ['A1', 'A2', 'A3', 'Z9'] };
    expect(() => validateChampionshipStartRequest(unknown)).toThrow(/不存在/);

    const duplicated = validBody();
    duplicated.groups[0] = { id: 'A', entrantNames: ['A1', 'A1', 'A3', 'A4'] };
    expect(() => validateChampionshipStartRequest(duplicated)).toThrow(/重复/);

    const crossGroup = validBody();
    crossGroup.groups[1] = { id: 'B', entrantNames: ['B1', 'B2', 'B3', 'A1'] };
    // A1 is claimed by group A as well, so the duplicate assignment is caught.
    expect(() => validateChampionshipStartRequest(crossGroup)).toThrow(/重复分配/);

    const wrongPools = validBody();
    // All 16 names are used exactly once, but neither group is balanced.
    wrongPools.groups[0] = { id: 'A', entrantNames: ['A1', 'A2', 'A3', 'B1'] };
    wrongPools.groups[1] = { id: 'B', entrantNames: ['B2', 'B3', 'B4', 'A4'] };
    expect(() => validateChampionshipStartRequest(wrongPools)).toThrow(/种子池/);
  });
});
