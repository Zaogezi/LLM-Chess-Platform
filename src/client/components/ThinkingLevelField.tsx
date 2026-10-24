import { useEffect, useMemo, useState } from 'react';
import type { ProviderKind, ThinkingLevel } from '../../shared/protocol';
import { fetchThinkingOptions } from '../api';
import { thinkingLevelLabel } from '../lib/format';
import {
  availableThinkingLevels,
  normalizeThinkingLevel,
} from '../lib/thinking';
import { Spinner } from './Icons';

interface ThinkingLevelFieldProps {
  id: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  profileId?: string | null;
  value: ThinkingLevel;
  options: readonly ThinkingLevel[];
  disabled?: boolean;
  onChange: (level: ThinkingLevel) => void;
  onOptionsChange: (options: ThinkingLevel[], selected?: ThinkingLevel | null) => void;
}

function uniqueOptions(
  options: readonly ThinkingLevel[],
  ...extra: Array<ThinkingLevel | null | undefined>
): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const option of [...options, ...extra]) {
    const value = option?.trim();
    if (!value) continue;
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

/**
 * Thinking-level picker backed by model metadata. OpenAI-protocol models always
 * expose the standard `reasoning_effort` levels; the button can additionally
 * read Ollama `/api/show` or an OpenAI/OpenRouter catalog and probe with one
 * tiny request when the catalog is silent. Anthropic keeps the built-in list.
 */
export function ThinkingLevelField({
  id,
  provider,
  baseUrl,
  model,
  apiKey,
  profileId,
  value,
  options,
  disabled = false,
  onChange,
  onOptionsChange,
}: ThinkingLevelFieldProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    setNote(null);
  }, [baseUrl, model, profileId, provider]);

  const displayValue = normalizeThinkingLevel(provider, value);
  const available = useMemo(
    () => availableThinkingLevels(provider, options, value),
    [provider, options, value],
  );

  const readFromApi = async () => {
    if (loading || disabled) return;
    if (!baseUrl.trim() || !model.trim()) {
      setError('请先填写 Base URL 与模型 ID。');
      return;
    }

    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const result = await fetchThinkingOptions({
        provider,
        baseUrl: baseUrl.trim(),
        model: model.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(profileId ? { profileId } : {}),
      });
      const nextOptions = uniqueOptions(
        result.options,
        result.defaultLevel ?? result.options[0] ?? value,
      );
      const current = nextOptions.find(
        (option) => option.toLocaleLowerCase() === value.toLocaleLowerCase(),
      );
      const selected =
        current ??
        nextOptions.find(
          (option) =>
            option.toLocaleLowerCase() === result.defaultLevel?.toLocaleLowerCase(),
        ) ??
        nextOptions[0] ??
        value;
      onOptionsChange(nextOptions, selected);
      setNote(result.note);
    } catch (fetchError) {
      setError(
        fetchError instanceof Error && fetchError.message.trim()
          ? fetchError.message
          : '读取模型思考档位失败，请检查接口配置。',
      );
    } finally {
      setLoading(false);
    }
  };

  const noteId = `${id}-note`;
  const errorId = `${id}-error`;

  return (
    <div className="field thinking-field">
      <div className="thinking-field__head">
        <label className="field__label" htmlFor={id}>
          思考强度
        </label>
        <button
          type="button"
          className="thinking-fetch"
          onClick={() => {
            void readFromApi();
          }}
          disabled={disabled || loading}
          aria-busy={loading}
          aria-describedby={note || error ? `${note ? noteId : errorId}` : undefined}
          title="从模型 API 读取可用思考档位"
        >
          {loading ? <Spinner /> : 'API'}
        </button>
      </div>

      <span className="select-wrap">
        <select
          id={id}
          value={displayValue}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : note ? noteId : undefined}
          onChange={(event) => onChange(event.target.value)}
        >
          {available.map((level) => (
            <option key={level} value={level}>
              {thinkingLevelLabel(level)}
            </option>
          ))}
        </select>
      </span>

      {note && (
        <p className="field__help thinking-field__note" id={noteId}>
          {note}
        </p>
      )}
      {error && (
        <p className="field__error thinking-field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
