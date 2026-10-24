import { describe, expect, it } from 'vitest';
import { formatNotation } from './notation';

describe('formatNotation', () => {
  it('renders Black Arabic digits with Chinese numerals for display', () => {
    expect(formatNotation('马8进7', 'black')).toBe('马八进七');
    expect(formatNotation('马2进3', 'black')).toBe('马二进三');
    expect(formatNotation('车1进1', 'black')).toBe('车一进一');
    expect(formatNotation('卒5平4', 'black')).toBe('卒五平四');
    expect(formatNotation('前车进1', 'black')).toBe('前车进一');
  });

  it('keeps Red notation unchanged', () => {
    expect(formatNotation('炮二平五', 'red')).toBe('炮二平五');
  });

  it('does not rewrite digits inside a UCCI coordinate prefix', () => {
    expect(formatNotation('a4兵九进一', 'black')).toBe('a4兵九进一');
    expect(formatNotation('a4兵九进一', 'red')).toBe('a4兵九进一');
  });
});
