import { describe, expect, it } from 'vitest';
import type { QualifierGroupId } from '../../shared/protocol';
import {
  CHAMPIONSHIP_QUALIFIER_ENTRANTS,
  CHAMPIONSHIP_QUALIFIER_GROUPS,
  CHAMPIONSHIP_QUALIFIER_GROUP_SIZE,
} from '../../shared/protocol';
import { ValidationError } from '../providers/validate';
import { validateQualifierStartRequest } from './qualifierValidate';

const GROUP_IDS: readonly QualifierGroupId[] = CHAMPIONSHIP_QUALIFIER_GROUPS;
/** Five entrants per qualifying group, named after their group. */
const GROUP_NAMES: Record<QualifierGroupId, readonly string[]> = {
  A: ['A1', 'A2', 'A3', 'A4', 'A5'],
  B: ['B1', 'B2', 'B3', 'B4', 'B5'],
};
const ENTRANT_NAMES = GROUP_IDS.flatMap((groupId) => GROUP_NAMES[groupId]);

function entrant(name: string, patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name,
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    model: `${name.toLocaleLowerCase()}-model`,
    apiKey: `secret-${name}`,
    thinkingLevel: 'quick',
    apiReasoning: false,
    ...patch,
  };
}

function validGroups(): { id: QualifierGroupId; entrantNames: string[] }[] {
  return GROUP_IDS.map((groupId) => ({
    id: groupId,
    entrantNames: [...GROUP_NAMES[groupId]],
  }));
}

function validBody(): {
  entrants: Record<string, unknown>[];
  groups: { id: QualifierGroupId; entrantNames: string[] }[];
} {
  return {
    entrants: ENTRANT_NAMES.map((name) => entrant(name)),
    groups: validGroups(),
  };
}

describe('validateQualifierStartRequest', () => {
  it('normalizes exactly ten entrants and two groups of five', () => {
    const input = validateQualifierStartRequest(validBody());

    expect(input.entrants).toHaveLength(CHAMPIONSHIP_QUALIFIER_ENTRANTS);
    expect(input.entrants.map((item) => item.name)).toEqual(ENTRANT_NAMES);
    expect(input.entrants[0]?.setup).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      model: 'a1-model',
      apiKey: 'secret-A1',
      thinkingLevel: 'quick',
      apiReasoning: false,
    });
    expect(input.groups.map((group) => group.id)).toEqual(['A', 'B']);
    for (const group of input.groups) {
      expect(group.entrantNames).toEqual([...GROUP_NAMES[group.id]]);
      expect(group.entrantNames).toHaveLength(CHAMPIONSHIP_QUALIFIER_GROUP_SIZE);
    }
    // Omitted concurrency means serial for API callers.
    expect(input.concurrency).toBe(1);
  });

  it('canonicalizes group order and trims names without reordering the seats', () => {
    const body = validBody();
    body.groups = [
      { id: 'B', entrantNames: [' b5 ', 'B2', 'B1', 'B4', 'B3'] },
      { id: 'A', entrantNames: ['A3', 'A2', 'A1', 'A5', 'A4'] },
    ];

    const input = validateQualifierStartRequest(body);

    expect(input.groups.map((group) => group.id)).toEqual(['A', 'B']);
    // Seat order is the order the user configured; validation must not sort it.
    expect(input.groups[0]?.entrantNames).toEqual(['A3', 'A2', 'A1', 'A5', 'A4']);
    expect(input.groups[1]?.entrantNames).toEqual(['B5', 'B2', 'B1', 'B4', 'B3']);
    // Entrant ids stay assigned in the request's entrant order.
    expect(input.entrants.map((item) => item.name)).toEqual(ENTRANT_NAMES);
  });

  it('resolves saved model-library entrants with per-entrant overrides', () => {
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
    body.entrants[0] = { name: 'A1', profileId: 'saved-a', thinkingLevel: 'deep', apiReasoning: true };
    body.entrants[1] = { name: 'A2', profileId: 'saved-a' };

    const input = validateQualifierStartRequest(body, profiles);

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

  it('rejects non-object bodies', () => {
    for (const body of [null, undefined, [], 'x', 3, true]) {
      expect(() => validateQualifierStartRequest(body)).toThrow(
        new ValidationError('请求体必须是 JSON 对象'),
      );
    }
  });

  it('rejects a non-array or wrong-sized entrant list', () => {
    const notArray = validBody() as Record<string, unknown>;
    notArray.entrants = 'x';
    expect(() => validateQualifierStartRequest(notArray)).toThrow(/entrants 必须是参赛模型配置数组/);

    for (const count of [9, 11, 0]) {
      const body = validBody();
      body.entrants =
        count < ENTRANT_NAMES.length
          ? ENTRANT_NAMES.slice(0, count).map((name) => entrant(name))
          : [
              ...ENTRANT_NAMES.map((name) => entrant(name)),
              entrant('C1'),
              entrant('C2'),
            ].slice(0, count);
      expect(() => validateQualifierStartRequest(body)).toThrow(/入围赛需要 10 位参赛模型/);
    }
  });

  it('rejects missing, duplicated and invalid entrant fields', () => {
    const missing = validBody();
    missing.entrants[0] = undefined as never;
    expect(() => validateQualifierStartRequest(missing)).toThrow(/第 1 个入围赛模型配置缺失/);

    const blank = validBody();
    blank.entrants[0] = entrant('   ');
    expect(() => validateQualifierStartRequest(blank)).toThrow(/请为第 1 个入围赛模型填写名称/);

    const tooLong = validBody();
    tooLong.entrants[0] = entrant('x'.repeat(81));
    expect(() => validateQualifierStartRequest(tooLong)).toThrow(/名称过长/);

    const duplicate = validBody();
    duplicate.entrants[1] = entrant('A1');
    expect(() => validateQualifierStartRequest(duplicate)).toThrow(/入围赛模型名称重复：A1/);

    const badUrl = validBody();
    badUrl.entrants[0] = entrant('A1', { baseUrl: 'ftp://bad' });
    expect(() => validateQualifierStartRequest(badUrl)).toThrow(/接口地址只支持 http 或 https/);

    const missingModel = validBody();
    missingModel.entrants[0] = entrant('A1', { model: '  ' });
    expect(() => validateQualifierStartRequest(missingModel)).toThrow(/请填写模型 ID/);
  });

  it('rejects malformed group lists', () => {
    const notArray = validBody() as Record<string, unknown>;
    notArray.groups = 'x';
    expect(() => validateQualifierStartRequest(notArray)).toThrow(/groups 必须是分组数组/);

    const tooFew = validBody();
    tooFew.groups = validGroups().slice(0, 1);
    expect(() => validateQualifierStartRequest(tooFew)).toThrow(/必须包含 A、B 两组/);

    const tooMany = validBody();
    tooMany.groups = [...validGroups(), { id: 'A', entrantNames: [...GROUP_NAMES.A] }];
    expect(() => validateQualifierStartRequest(tooMany)).toThrow(/必须包含 A、B 两组/);

    const badId = validBody();
    badId.groups[0] = { id: 'C' as never, entrantNames: [...GROUP_NAMES.A] };
    expect(() => validateQualifierStartRequest(badId)).toThrow(/分组编号必须是 A 或 B/);

    const duplicateId = validBody();
    duplicateId.groups[1] = { id: 'A', entrantNames: [...GROUP_NAMES.B] };
    expect(() => validateQualifierStartRequest(duplicateId)).toThrow(/分组 A 被重复配置/);

    const namesNotArray = validBody() as unknown as {
      groups: { id: QualifierGroupId; entrantNames: unknown }[];
    };
    namesNotArray.groups[0] = { id: 'A', entrantNames: 'x' };
    expect(() => validateQualifierStartRequest(namesNotArray)).toThrow(
      /分组 A 的参赛名单必须是数组/,
    );
  });

  it('rejects the wrong group size and empty or duplicated seats', () => {
    const wrongSize = validBody();
    wrongSize.groups[0] = { id: 'A', entrantNames: ['A1', 'A2', 'A3', 'A4'] };
    expect(() => validateQualifierStartRequest(wrongSize)).toThrow(/分组 A 必须恰好有 5 位/);

    const oversized = validBody();
    oversized.groups[0] = { id: 'A', entrantNames: ['A1', 'A2', 'A3', 'A4', 'A5', 'B1'] };
    expect(() => validateQualifierStartRequest(oversized)).toThrow(/分组 A 必须恰好有 5 位/);

    const empty = validBody();
    empty.groups[0] = { id: 'A', entrantNames: ['A1', 'A2', '  ', 'A4', 'A5'] };
    expect(() => validateQualifierStartRequest(empty)).toThrow(/分组 A 的参赛名单包含空名称/);

    const duplicateSeat = validBody();
    duplicateSeat.groups[0] = { id: 'A', entrantNames: ['A1', 'A2', 'A3', 'A4', 'A4'] };
    expect(() => validateQualifierStartRequest(duplicateSeat)).toThrow(/分组 A 中参赛模型重复：A4/);
  });

  it('rejects unknown and cross-group duplicated members', () => {
    const unknown = validBody();
    unknown.groups[0] = { id: 'A', entrantNames: ['A1', 'A2', 'A3', 'A4', 'Z9'] };
    expect(() => validateQualifierStartRequest(unknown)).toThrow(/分组 A 中的参赛模型不存在：Z9/);

    const crossGroup = validBody();
    // A1 is claimed by group A as well, so the second claim is a duplicate.
    crossGroup.groups[1] = { id: 'B', entrantNames: ['B1', 'B2', 'B3', 'B4', 'A1'] };
    expect(() => validateQualifierStartRequest(crossGroup)).toThrow(/被重复分配到分组 A 与 B/);
  });

  it('validates the optional concurrency limit', () => {
    expect(validateQualifierStartRequest(validBody()).concurrency).toBe(1);

    for (const concurrency of [1, 2, 4, 8]) {
      const body = validBody() as Record<string, unknown>;
      body.concurrency = concurrency;
      expect(validateQualifierStartRequest(body).concurrency).toBe(concurrency);
    }

    for (const concurrency of [0, 9, 2.5, '4', -1, true]) {
      const body = validBody() as Record<string, unknown>;
      body.concurrency = concurrency;
      expect(() => validateQualifierStartRequest(body)).toThrow(/并发局数必须是 1 到 8 之间的整数/);
    }
  });

  it('rejects unresolvable model-library references', () => {
    const profiles = {
      resolveSetup() {
        return null;
      },
    };

    const unknown = validBody();
    unknown.entrants[0] = { name: 'A1', profileId: 'missing' };
    expect(() => validateQualifierStartRequest(unknown, profiles)).toThrow(
      /模型库配置已不存在/,
    );

    const blank = validBody();
    blank.entrants[0] = { name: 'A1', profileId: '   ' };
    expect(() => validateQualifierStartRequest(blank, profiles)).toThrow(
      /请为第 1 个入围赛模型选择模型库配置/,
    );

    const withoutLookup = validBody();
    withoutLookup.entrants[0] = { name: 'A1', profileId: 'saved-a' };
    expect(() => validateQualifierStartRequest(withoutLookup)).toThrow(
      /暂不支持模型库选择/,
    );
  });
});
