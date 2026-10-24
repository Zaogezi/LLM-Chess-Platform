interface RequireReasonFieldProps {
  id: string;
  /** When false the prompt only asks for a move and omits the reason field. */
  value: boolean;
  disabled?: boolean;
  onChange: (requireReason: boolean) => void;
}

/**
 * Per-model switch for the JSON answer shape. Sending `false` drops the
 * `reason` field from the prompt, which saves output tokens but leaves the move
 * sheet without a reason. Absent means true, so old profiles keep their
 * behaviour and the checkbox defaults to checked.
 */
export function RequireReasonField({
  id,
  value,
  disabled = false,
  onChange,
}: RequireReasonFieldProps) {
  return (
    <div className="field require-reason-field">
      <label className="check-field" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="check-field__copy">
          <span className="check-field__title">要求输出理由</span>
          <span className="check-field__sub">
            {value
              ? '提示词要求 {"move","reason"}，棋谱会记录模型理由。'
              : '只要求 {"move":"..."}，可省 token；棋谱理由显示为空/未提供。'}
          </span>
        </span>
      </label>
    </div>
  );
}
