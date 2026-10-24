import type { ThinkingLevel } from '../../shared/protocol';
import {
  REQUEST_TIMEOUT_MAX_SECONDS,
  REQUEST_TIMEOUT_MIN_SECONDS,
  thinkingTimeoutSecondsFor,
} from '../../shared/protocol';

interface ReasoningTimeoutFieldProps {
  id: string;
  /** Explicit override in seconds; null follows the thinking-tier default. */
  value: number | null;
  thinkingLevel: ThinkingLevel;
  disabled?: boolean;
  error?: string;
  onChange: (seconds: number | null) => void;
}

/**
 * Independent per-step wait limit. It no longer follows the thinking level
 * implicitly: leaving the field empty keeps the tier fallback (60/120/240 s),
 * while a value such as 300 lets a slow model finish without changing how much
 * reasoning the prompt asks for.
 */
export function ReasoningTimeoutField({
  id,
  value,
  thinkingLevel,
  disabled = false,
  error,
  onChange,
}: ReasoningTimeoutFieldProps) {
  const fallback = thinkingTimeoutSecondsFor(thinkingLevel);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;

  return (
    <div className={`field reasoning-timeout-field${error ? ' field--invalid' : ''}`}>
      <label className="field__label" htmlFor={id}>
        最大推理时长（秒）
      </label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={REQUEST_TIMEOUT_MIN_SECONDS}
        max={REQUEST_TIMEOUT_MAX_SECONDS}
        step={1}
        placeholder={`默认 ${fallback}`}
        value={value ?? ''}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${helpId} ${errorId}` : helpId}
        onChange={(event) => {
          const raw = event.target.value;
          if (!raw.trim()) {
            onChange(null);
            return;
          }
          const parsed = Number(raw);
          onChange(Number.isFinite(parsed) ? Math.round(parsed) : null);
        }}
      />
      <p className="field__help" id={helpId}>
        留空则沿用思考强度：{fallback} 秒。
      </p>
      {error && (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
