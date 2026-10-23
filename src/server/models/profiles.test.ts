import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ModelProfileStore,
  validateProfileCreate,
  validateProfileUpdate,
} from './profiles';

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length) {
    rmSync(cleanup.pop()!, { recursive: true, force: true });
  }
});

function tempFile(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'xiangqi-models-'));
  cleanup.push(directory);
  return path.join(directory, 'data', 'models.json');
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: 'DeepSeek 主力',
    provider: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    thinkingLevel: 'deep',
    apiReasoning: true,
    apiKey: 'sk-secret-value-1234',
    ...overrides,
  };
}

describe('ModelProfileStore', () => {
  it('creates, lists and persists saved models without exposing keys', () => {
    const filePath = tempFile();
    const store = new ModelProfileStore({ filePath });
    const created = store.create(validateProfileCreate(input()));

    expect(created).toMatchObject({
      name: 'DeepSeek 主力',
      provider: 'openai',
      model: 'deepseek-chat',
      thinkingLevel: 'deep',
      apiReasoning: true,
      keyConfigured: true,
      keyHint: '••••1234',
    });
    expect(JSON.stringify(created)).not.toContain('sk-secret-value');
    expect(store.size).toBe(1);

    const reloaded = new ModelProfileStore({ filePath });
    expect(reloaded.list()).toEqual([created]);
    expect(JSON.stringify(reloaded.list())).not.toContain('sk-secret-value');

    const onDisk = readFileSync(filePath, 'utf8');
    expect(onDisk).toContain('sk-secret-value-1234');
    expect(onDisk).toContain('"version": 1');
  });

  it('resolves a server-only setup with the stored key and display name', () => {
    const store = new ModelProfileStore({ filePath: null });
    const created = store.create(validateProfileCreate(input()));

    const setup = store.resolveSetup(created.id);
    expect(setup).toMatchObject({
      provider: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      apiKey: 'sk-secret-value-1234',
      displayName: 'DeepSeek 主力',
      thinkingLevel: 'deep',
      apiReasoning: true,
    });
    expect(store.resolveSetup('missing')).toBeNull();
    expect(store.find(created.id)?.keyConfigured).toBe(true);
    expect(store.has(created.id)).toBe(true);
  });

  it('updates fields while keeping, replacing or clearing the secret', () => {
    const store = new ModelProfileStore({ filePath: null });
    const created = store.create(validateProfileCreate(input()));

    const kept = store.update(
      created.id,
      validateProfileUpdate(input({ name: '改名后', apiKey: undefined, model: 'deepseek-reasoner' })),
    );
    expect(kept).toMatchObject({ name: '改名后', model: 'deepseek-reasoner', keyConfigured: true });
    expect(store.resolveSetup(created.id)?.apiKey).toBe('sk-secret-value-1234');

    const replaced = store.update(
      created.id,
      validateProfileUpdate(input({ name: '改名后', apiKey: 'sk-new-key-9876' })),
    );
    expect(replaced?.keyHint).toBe('••••9876');
    expect(store.resolveSetup(created.id)?.apiKey).toBe('sk-new-key-9876');

    const cleared = store.update(
      created.id,
      validateProfileUpdate(input({ name: '改名后', apiKey: undefined, clearApiKey: true })),
    );
    expect(cleared).toMatchObject({ keyConfigured: false, keyHint: null });
    expect(store.resolveSetup(created.id)?.apiKey).toBe('');
  });

  it('rejects duplicate names and invalid configuration', () => {
    const store = new ModelProfileStore({ filePath: null });
    store.create(validateProfileCreate(input()));

    expect(() => store.create(validateProfileCreate(input({ name: 'deepseek 主力' })))).toThrow(
      /已存在/,
    );
    expect(() => validateProfileCreate(input({ name: '   ' }))).toThrow(/名称/);
    expect(() => validateProfileCreate(input({ provider: 'other' }))).toThrow(/接入协议/);
    expect(() => validateProfileCreate(input({ baseUrl: 'ftp://example.test' }))).toThrow(
      /http/,
    );
    expect(() =>
      validateProfileUpdate(input({ apiKey: 'sk-new', clearApiKey: true })),
    ).toThrow(/不能同时/);
  });

  it('persists API-discovered thinking level lists and keeps the selected level inside them', () => {
    const filePath = tempFile();
    const store = new ModelProfileStore({ filePath });
    const created = store.create(
      validateProfileCreate(
        input({
          thinkingLevel: 'high',
          thinkingLevels: ['minimal', 'low', 'medium', 'high'],
        }),
      ),
    );
    expect(created.thinkingLevel).toBe('high');
    expect(created.thinkingLevels).toEqual(['minimal', 'low', 'medium', 'high']);

    const reloaded = new ModelProfileStore({ filePath });
    expect(reloaded.list()[0]).toMatchObject({
      thinkingLevel: 'high',
      thinkingLevels: ['minimal', 'low', 'medium', 'high'],
    });

    const selectedOutside = validateProfileCreate(
      input({ thinkingLevel: 'custom-high', thinkingLevels: ['low', 'medium'] }),
    );
    expect(selectedOutside.thinkingLevels).toEqual(['custom-high', 'low', 'medium']);
  });

  it('removes a model and persists the removal', () => {
    const filePath = tempFile();
    const store = new ModelProfileStore({ filePath });
    const first = store.create(validateProfileCreate(input()));
    const second = store.create(validateProfileCreate(input({ name: 'OpenAI 备用' })));

    expect(store.remove(first.id)).toBe(true);
    expect(store.remove(first.id)).toBe(false);
    expect(store.size).toBe(1);
    expect(store.find(second.id)).not.toBeNull();

    const reloaded = new ModelProfileStore({ filePath });
    expect(reloaded.list().map((profile) => profile.name)).toEqual(['OpenAI 备用']);
  });

  it('skips malformed entries and starts empty for an unreadable file', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'xiangqi-models-'));
    cleanup.push(directory);
    const filePath = path.join(directory, 'models.json');
    const valid = validateProfileCreate(input());
    const stored = {
      id: 'kept',
      ...valid,
      createdAt: 1,
      updatedAt: 1,
    };
    writeFileSync(
      filePath,
      JSON.stringify({ version: 1, profiles: [stored, { broken: true }] }),
      'utf8',
    );
    const store = new ModelProfileStore({ filePath });
    expect(store.size).toBe(1);
    expect(store.list()[0]?.id).toBe('kept');

    const badPath = path.join(directory, 'bad-models.json');
    writeFileSync(badPath, '{not json', 'utf8');
    expect(new ModelProfileStore({ filePath: badPath }).size).toBe(0);
  });
});
