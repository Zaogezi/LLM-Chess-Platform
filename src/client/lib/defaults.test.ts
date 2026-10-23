import { describe, expect, it } from 'vitest';
import {
  applyProfileFormPreset,
  createProfileForm,
} from './profiles';
import {
  applyPresetToDraft,
  createTournamentDraft,
} from './tournament';
import {
  applyPresetToChampionshipDraft,
  createChampionshipDraft,
} from './championship';
import { createModelConfig } from '../presets';

describe('default API reasoning sending', () => {
  it('defaults arena configs to auto-send for OpenAI and off for Anthropic', () => {
    expect(createModelConfig('deepseek').apiReasoning).toBe(true);
    expect(createModelConfig('anthropic').apiReasoning).toBe(false);
  });

  it('defaults the model-library form to auto-send for OpenAI', () => {
    expect(createProfileForm().apiReasoning).toBe(true);
    const anthropic = applyProfileFormPreset(createProfileForm(), 'anthropic');
    expect(anthropic.apiReasoning).toBe(false);
    expect(applyProfileFormPreset(anthropic, 'deepseek').apiReasoning).toBe(true);
  });

  it('defaults tournament drafts to auto-send for OpenAI', () => {
    expect(createTournamentDraft('deepseek').apiReasoning).toBe(true);
    const anthropic = applyPresetToDraft(createTournamentDraft('deepseek'), 'anthropic');
    expect(anthropic.apiReasoning).toBe(false);
    expect(applyPresetToDraft(anthropic, 'openai').apiReasoning).toBe(true);
  });

  it('defaults championship drafts to auto-send for OpenAI', () => {
    const openaiDraft = createChampionshipDraft('deepseek', 1);
    expect(openaiDraft.apiReasoning).toBe(true);
    const anthropicDraft = applyPresetToChampionshipDraft(openaiDraft, 'anthropic');
    expect(anthropicDraft.apiReasoning).toBe(false);
  });
});
