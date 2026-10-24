import type { Side } from '../../shared/protocol';

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/**
 * Display-only numeral normalization for Chinese move notation.
 *
 * Traditional notation writes Black with Arabic digits (`马8进7`) while Red
 * already uses Chinese numerals. The move list shows both sides with Chinese
 * numerals for a consistent reading; the server, prompts and history keep
 * storing the standard notation, and the model still only outputs UCCI.
 *
 * Digits that belong to a UCCI coordinate prefix (the rare fallback
 * `a4兵九进一`) are left unchanged because they are addresses, not counts.
 */
export function formatNotation(notation: string, side: Side): string {
  if (side === 'red') return notation;
  return notation.replace(/(?<![A-Za-z])[1-9]/g, (digit) => CN_DIGITS[Number(digit)] ?? digit);
}
