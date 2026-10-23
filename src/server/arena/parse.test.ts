import { describe, expect, it } from 'vitest';
import { DecisionParseError, parseDecision } from './parse';

describe('parseDecision', () => {
  it('parses a direct JSON object', () => {
    expect(parseDecision('{"move":"h2e2","reason":"中炮开局"}')).toEqual({
      move: 'h2e2',
      reason: '中炮开局',
    });
  });

  it('finds JSON inside a fenced code block and prose', () => {
    const raw = [
      '我认为应该走中炮：',
      '```json',
      '{"move":"h2e2","reason":"中炮"}',
      '```',
      '请审阅。',
    ].join('\n');
    expect(parseDecision(raw)).toEqual({ move: 'h2e2', reason: '中炮' });
  });

  it('normalizes separators, whitespace and case', () => {
    expect(parseDecision('{"move":" H2 → E2 ","reason":" out "}')).toEqual({
      move: 'h2e2',
      reason: 'out',
    });
    expect(parseDecision('{"move":"h2-e2"}')).toEqual({
      move: 'h2e2',
      reason: '未提供理由',
    });
  });

  it('accepts a from/to move object from a model', () => {
    expect(parseDecision('{"move":{"from":"h2","to":"e2"},"reason":"列炮"}')).toEqual({
      move: 'h2e2',
      reason: '列炮',
    });
  });

  it('extracts an object from a JSON array', () => {
    expect(parseDecision('[{"move":"h0g2","reason":"起马"}]').move).toBe('h0g2');
  });

  it('handles near-JSON output', () => {
    expect(parseDecision('move: "b2e2", reason: "炮八平五"').move).toBe('b2e2');
  });

  it('sanitizes and truncates reasons', () => {
    const parsed = parseDecision(`{"move":"h2e2","reason":"${'长'.repeat(300)}\\n第二行"}`);
    expect(parsed.reason.length).toBeLessThanOrEqual(200);
    expect(parsed.reason).not.toContain('\n');
  });

  it.each([
    ['', '没有找到'],
    ['I cannot decide.', '没有找到'],
    ['{"reason":"no move"}', '没有找到'],
    ['{"move":"z9z9","reason":"bad"}', 'UCCI'],
    ['{"move":"h2","reason":"too short"}', 'UCCI'],
  ])('rejects invalid output %#', (raw, needle) => {
    expect(() => parseDecision(raw)).toThrow(DecisionParseError);
    expect(() => parseDecision(raw)).toThrow(needle);
  });
});
