import type { ThinkingLevel } from '../../shared/protocol';
import {
  PROMPT_LEVELS,
  PROMPT_TIER_LABELS,
  effectivePromptLevel,
  thinkingTierOf,
} from '../../shared/protocol';
import { promptLevelLabel } from '../lib/format';

interface PromptLevelFieldProps {
  id: string;
  /** Explicit in-app prompt level; null follows the API thinking level. */
  value: ThinkingLevel | null;
  thinkingLevel: ThinkingLevel;
  disabled?: boolean;
  onChange: (level: ThinkingLevel | null) => void;
}

/**
 * In-app prompt intensity. It intentionally shares the tier names with the
 * thinking level but never touches the provider's reasoning parameter: an
 * explicit choice decouples "how much the prompt asks for" from "how hard the
 * API is told to think".
 */
export function PromptLevelField({
  id,
  value,
  thinkingLevel,
  disabled = false,
  onChange,
}: PromptLevelFieldProps) {
  const effective = effectivePromptLevel(thinkingLevel, value);
  const explicit = Boolean(value?.trim());
  const helpId = `${id}-help`;
  const options: ThinkingLevel[] = [...PROMPT_LEVELS];
  const extra =
    value && !options.some((level) => level.toLocaleLowerCase() === value.toLocaleLowerCase())
      ? value
      : null;

  return (
    <div className="field prompt-level-field">
      <label className="field__label" htmlFor={id}>
        提示词强度
        <span className="field__optional">应用内</span>
      </label>
      <span className="select-wrap">
        <select
          id={id}
          value={value ?? ''}
          disabled={disabled}
          aria-describedby={helpId}
          onChange={(event) => onChange(event.target.value.trim() || null)}
        >
          <option value="">跟随思考强度（{promptLevelLabel(effective)}）</option>
          {options.map((level) => (
            <option key={level} value={level}>
              {PROMPT_TIER_LABELS[thinkingTierOf(level)]}
            </option>
          ))}
          {extra && <option value={extra}>{extra}</option>}
        </select>
      </span>
      <p className="field__help" id={helpId}>
        {explicit
          ? '只调整应用内提示词，不改变 API 推理参数。'
          : '与思考强度保持一致；单独选择可让提示词强度与 API 推理参数分离。'}
      </p>
    </div>
  );
}
