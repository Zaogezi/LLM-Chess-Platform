import type { ProviderKind, ThinkingLevel } from '../../shared/protocol';
import {
  MAX_COMPLETION_TOKENS_MAX,
  MAX_COMPLETION_TOKENS_MIN,
  MAX_THINKING_TOKENS_MAX,
  MAX_THINKING_TOKENS_MIN,
  thinkingBudgetTokens,
} from '../../shared/protocol';

interface TokenLimitsFieldProps {
  /** Prefix for the two input ids, e.g. `red-token`. */
  idPrefix: string;
  provider: ProviderKind;
  apiReasoning: boolean;
  thinkingLevel: ThinkingLevel;
  /** Hard thinking-token cap; null uses the provider/tier default. */
  maxThinkingTokens: number | null;
  /** Hard total-output cap; null sends no cap. */
  maxCompletionTokens: number | null;
  disabled?: boolean;
  thinkingError?: string;
  completionError?: string;
  onChange: (patch: {
    maxThinkingTokens?: number | null;
    maxCompletionTokens?: number | null;
  }) => void;
}

function parseCap(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

/**
 * Optional hard token caps. Both can stay empty: no thinking cap means the
 * provider/tier default budget, no completion cap means no max_tokens is sent.
 * The help copy makes clear which gateways actually honour each cap.
 */
export function TokenLimitsField({
  idPrefix,
  provider,
  apiReasoning,
  thinkingLevel,
  maxThinkingTokens,
  maxCompletionTokens,
  disabled = false,
  thinkingError,
  completionError,
  onChange,
}: TokenLimitsFieldProps) {
  const thinkingId = `${idPrefix}-thinking`;
  const completionId = `${idPrefix}-completion`;
  const thinkingHelpId = `${thinkingId}-help`;
  const completionHelpId = `${completionId}-help`;
  const thinkingErrorId = `${thinkingId}-error`;
  const completionErrorId = `${completionId}-error`;

  const tierBudget =
    provider === 'anthropic' && apiReasoning
      ? thinkingBudgetTokens(thinkingLevel)
      : null;
  const thinkingPlaceholder =
    tierBudget !== null ? `默认 ${tierBudget}` : '留空不设置';

  return (
    <>
      <div className={`field token-limit-field${thinkingError ? ' field--invalid' : ''}`}>
        <label className="field__label" htmlFor={thinkingId}>
          最大思考 token
          <span className="field__optional">可留空</span>
        </label>
        <input
          id={thinkingId}
          type="number"
          inputMode="numeric"
          min={MAX_THINKING_TOKENS_MIN}
          max={MAX_THINKING_TOKENS_MAX}
          step={1}
          placeholder={thinkingPlaceholder}
          value={maxThinkingTokens ?? ''}
          disabled={disabled}
          aria-invalid={Boolean(thinkingError)}
          aria-describedby={
            thinkingError ? `${thinkingHelpId} ${thinkingErrorId}` : thinkingHelpId
          }
          onChange={(event) =>
            onChange({ maxThinkingTokens: parseCap(event.target.value) })
          }
        />
        <p className="field__help" id={thinkingHelpId}>
          需开启「API 推理参数」；仅 Anthropic（budget_tokens）与 OpenRouter（reasoning.max_tokens）生效，其余网关忽略。留空沿用档位默认。
        </p>
        {thinkingError && (
          <p className="field__error" id={thinkingErrorId} role="alert">
            {thinkingError}
          </p>
        )}
      </div>

      <div className={`field token-limit-field${completionError ? ' field--invalid' : ''}`}>
        <label className="field__label" htmlFor={completionId}>
          最大输出 token
          <span className="field__optional">可留空</span>
        </label>
        <input
          id={completionId}
          type="number"
          inputMode="numeric"
          min={MAX_COMPLETION_TOKENS_MIN}
          max={MAX_COMPLETION_TOKENS_MAX}
          step={1}
          placeholder="留空不限制"
          value={maxCompletionTokens ?? ''}
          disabled={disabled}
          aria-invalid={Boolean(completionError)}
          aria-describedby={
            completionError ? `${completionHelpId} ${completionErrorId}` : completionHelpId
          }
          onChange={(event) =>
            onChange({ maxCompletionTokens: parseCap(event.target.value) })
          }
        />
        <p className="field__help" id={completionHelpId}>
          OpenAI / o 系列发送 max_completion_tokens，旧网关与 Anthropic 发送 max_tokens；超出上限会截断回复，可能立即判负。
        </p>
        {completionError && (
          <p className="field__error" id={completionErrorId} role="alert">
            {completionError}
          </p>
        )}
      </div>
    </>
  );
}
