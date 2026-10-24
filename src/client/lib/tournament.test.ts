import { describe, expect, it } from 'vitest';
import type { ModelProfileView } from '../../shared/protocol';
import {
  applyPresetToDraft,
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
      requireReason: true,
    });
    expect(request.models[1]).toMatchObject({
      name: '存档模型 2',
      profileId: 'saved-1',
      thinkingLevel: 'quick',
    });
  });

  it('keeps the request timeout independent from the thinking level', () => {
    const timedProfile: ModelProfileView = { ...profile, requestTimeoutSeconds: 300 };
    const draft = applyProfileToDraft(
      createTournamentDraft('deepseek', 'DeepSeek'),
      timedProfile,
      [],
    );
    expect(draft.requestTimeoutSeconds).toBe(300);

    const request = toTournamentStartRequest([draft], 1);
    expect(request.models[0]).toMatchObject({ requestTimeoutSeconds: 300 });

    const invalid = { ...draft, requestTimeoutSeconds: 3 };
    const validation = validateTournamentDrafts([invalid], 1, [timedProfile]);
    expect(validation.modelErrors[invalid.id]?.requestTimeoutSeconds).toMatch(
      /最大推理时长/,
    );
  });

  it('carries prompt level and token caps through drafts and start requests', () => {
    const richProfile: ModelProfileView = {
      ...profile,
      promptLevel: 'deep',
      maxThinkingTokens: 2048,
      maxCompletionTokens: 8192,
    };
    const draft = applyProfileToDraft(
      createTournamentDraft('deepseek', 'DeepSeek'),
      richProfile,
      [],
    );
    expect(draft).toMatchObject({
      promptLevel: 'deep',
      maxThinkingTokens: 2048,
      maxCompletionTokens: 8192,
    });
    expect(toTournamentStartRequest([draft], 1).models[0]).toMatchObject({
      profileId: 'saved-1',
      promptLevel: 'deep',
      maxThinkingTokens: 2048,
      maxCompletionTokens: 8192,
    });

    const inline = {
      ...createTournamentDraft('openai', 'OpenAI'),
      promptLevel: 'quick',
      maxThinkingTokens: 1024,
      maxCompletionTokens: 4096,
    };
    expect(toTournamentStartRequest([inline], 1).models[0]).toMatchObject({
      provider: 'openai',
      promptLevel: 'quick',
      maxThinkingTokens: 1024,
      maxCompletionTokens: 4096,
    });

    // null keeps the saved-profile default, so it is omitted from the request.
    const defaults = {
      ...createTournamentDraft('deepseek', '默认'),
      promptLevel: null,
      maxThinkingTokens: null,
      maxCompletionTokens: null,
    };
    const defaultRequest = toTournamentStartRequest([defaults], 1);
    expect(defaultRequest.models[0]).not.toHaveProperty('promptLevel');
    expect(defaultRequest.models[0]).not.toHaveProperty('maxThinkingTokens');
    expect(defaultRequest.models[0]).not.toHaveProperty('maxCompletionTokens');
  });

  it('carries the reason-output switch through drafts and requests', () => {
    // A saved profile that disabled reasons fills the draft and is sent as false.
    const noReasonProfile: ModelProfileView = { ...profile, requireReason: false };
    const draft = applyProfileToDraft(
      createTournamentDraft('deepseek', 'DeepSeek'),
      noReasonProfile,
      [],
    );
    expect(draft.requireReason).toBe(false);
    expect(toTournamentStartRequest([draft], 1).models[0]).toMatchObject({
      profileId: 'saved-1',
      requireReason: false,
    });

    // The default is always sent explicitly so a legacy profile is overridden.
    const inline = createTournamentDraft('openai', 'OpenAI');
    expect(inline.requireReason).toBe(true);
    expect(toTournamentStartRequest([inline], 1).models[0]).toMatchObject({
      requireReason: true,
    });

    // Switching preset resets the switch to the historical default.
    const toggled = { ...inline, requireReason: false };
    expect(applyPresetToDraft(toggled, 'anthropic').requireReason).toBe(true);
  });

  it('validates token caps per entrant', () => {
    const draft = createTournamentDraft('deepseek', 'DeepSeek');
    const invalid = { ...draft, maxThinkingTokens: 4096, maxCompletionTokens: 4096 };
    const validation = validateTournamentDrafts([invalid], 1);
    expect(validation.modelErrors[invalid.id]?.maxCompletionTokens).toMatch(
      /必须大于最大思考 token/,
    );
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
