import { describe, expect, it } from 'vitest';
import { ValidationError } from '../providers/validate';
import { validateTournamentStartRequest } from './validate';

function model(name: string, patch: Record<string, unknown> = {}) {
  return {
    name,
    provider: 'openai',
    baseUrl: 'https://example.test/v1',
    model: `${name.toLowerCase()}-model`,
    apiKey: 'test-key',
    ...patch,
  };
}

describe('validateTournamentStartRequest', () => {
  it('normalizes entrants and preserves names', () => {
    const input = validateTournamentStartRequest({
      models: [model(' Alpha '), model('Beta', { thinkingLevel: 'deep', apiReasoning: true })],
      gamesPerPair: 4,
    });
    expect(input.gamesPerPair).toBe(4);
    expect(input.models.map((entrant) => entrant.name)).toEqual(['Alpha', 'Beta']);
    expect(input.models[0]?.setup.thinkingLevel).toBe('balanced');
    expect(input.models[1]?.setup.thinkingLevel).toBe('deep');
    expect(input.models[1]?.setup.apiReasoning).toBe(true);
  });

  it('rejects too few or too many models', () => {
    expect(() =>
      validateTournamentStartRequest({ models: [model('Only')], gamesPerPair: 2 }),
    ).toThrow(/至少/);
    expect(() =>
      validateTournamentStartRequest({
        models: Array.from({ length: 9 }, (_, index) => model(`M${index + 1}`)),
        gamesPerPair: 1,
      }),
    ).toThrow(/最多/);
  });

  it('rejects duplicate names, missing names and malformed model configs', () => {
    expect(() =>
      validateTournamentStartRequest({
        models: [model('Alpha'), model('alpha')],
        gamesPerPair: 1,
      }),
    ).toThrow(/名称重复/);
    expect(() =>
      validateTournamentStartRequest({
        models: [model('Alpha'), model('  ')],
        gamesPerPair: 1,
      }),
    ).toThrow(/填写名称/);
    expect(() =>
      validateTournamentStartRequest({
        models: [model('Alpha'), model('Beta', { baseUrl: 'ftp://bad' })],
        gamesPerPair: 1,
      }),
    ).toThrow(ValidationError);
  });

  it('resolves saved model-library entrants with per-game thinking overrides', () => {
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

    const input = validateTournamentStartRequest(
      {
        models: [
          { name: '甲', profileId: 'saved-a', thinkingLevel: 'deep', apiReasoning: true },
          { name: '乙', profileId: 'saved-a' },
        ],
        gamesPerPair: 2,
      },
      profiles,
    );

    expect(input.models[0]?.setup).toMatchObject({
      provider: 'anthropic',
      model: 'saved-model',
      apiKey: 'saved-secret',
      displayName: '库中模型',
      thinkingLevel: 'deep',
      apiReasoning: true,
    });
    expect(input.models[1]?.setup).toMatchObject({
      thinkingLevel: 'balanced',
      apiReasoning: false,
    });
  });

  it('rejects missing or unknown saved model entrants', () => {
    expect(() =>
      validateTournamentStartRequest(
        {
          models: [model('Alpha'), { name: 'Beta', profileId: 'gone' }],
          gamesPerPair: 1,
        },
        { resolveSetup: () => null },
      ),
    ).toThrow(/已不存在/);

    expect(() =>
      validateTournamentStartRequest(
        {
          models: [model('Alpha'), { name: 'Beta', profileId: '' }],
          gamesPerPair: 1,
        },
        { resolveSetup: () => null },
      ),
    ).toThrow(/选择/);
  });

  it.each([0, 1.5, 21, '2'])('rejects invalid gamesPerPair %s', (gamesPerPair) => {
    expect(() =>
      validateTournamentStartRequest({
        models: [model('Alpha'), model('Beta')],
        gamesPerPair,
      }),
    ).toThrow(/对局数/);
  });
});
