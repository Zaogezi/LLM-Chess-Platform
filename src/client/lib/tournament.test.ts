import { describe, expect, it } from 'vitest';
import type { ModelProfileView } from '../../shared/protocol';
import {
  applyProfileToDraft,
  createTournamentDraft,
  toTournamentStartRequest,
  validateTournamentDrafts,
} from './tournament';

const profile: ModelProfileView = {
  id: 'saved-1',
  name: '存档模型',
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

describe('tournament saved-profile integration', () => {
  it('fills entrants from saved profiles and sends profile references', () => {
    const first = createTournamentDraft('deepseek', 'DeepSeek');
    const second = createTournamentDraft('openai', 'OpenAI');
    const updatedFirst = applyProfileToDraft(first, profile, [first, second]);
    const updatedSecond = applyProfileToDraft(second, profile, [updatedFirst, second]);

    expect(updatedFirst).toMatchObject({
      profileId: 'saved-1',
      name: '存档模型',
      provider: 'anthropic',
      baseUrl: 'https://saved.test/v1',
      model: 'saved-model',
      thinkingLevel: 'deep',
      apiReasoning: true,
      apiKey: '',
    });
    expect(updatedSecond.name).toBe('存档模型 2');

    const request = toTournamentStartRequest(
      [updatedFirst, { ...updatedSecond, thinkingLevel: 'quick' }],
      3,
    );
    expect(request.gamesPerPair).toBe(3);
    expect(request.models[0]).toEqual({
      name: '存档模型',
      profileId: 'saved-1',
      thinkingLevel: 'deep',
      apiReasoning: true,
    });
    expect(request.models[1]).toMatchObject({
      name: '存档模型 2',
      profileId: 'saved-1',
      thinkingLevel: 'quick',
    });
  });

  it('reports a missing saved profile before starting', () => {
    const draft = applyProfileToDraft(
      createTournamentDraft('deepseek', 'DeepSeek'),
      profile,
      [],
    );
    const second = createTournamentDraft('openai', 'OpenAI');
    const validation = validateTournamentDrafts([draft, second], 1, []);
    expect(validation.ok).toBe(false);
    expect(validation.modelErrors[draft.id]?.profile).toMatch(/已不存在/);
  });
});
