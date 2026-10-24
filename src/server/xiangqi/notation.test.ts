import { describe, expect, it } from 'vitest';
import { XiangqiGame } from './index';

function notationOf(fen: string, ucci: string): string | null {
  return XiangqiGame.fromFen(fen).findLegalMove(ucci)?.notation ?? null;
}

describe('中文记谱', () => {
  it('题目给定的示例着法', () => {
    const initial = XiangqiGame.initial();
    expect(initial.findLegalMove('h2e2')?.notation).toBe('炮二平五');
    // 炮二进七：以 h7 黑炮为炮架吃 h9 黑马
    expect(initial.findLegalMove('h2h9')?.notation).toBe('炮二进七');
    expect(initial.findLegalMove('a0a1')?.notation).toBe('车九进一');
    expect(initial.findLegalMove('b0c2')?.notation).toBe('马八进七');
    expect(initial.findLegalMove('c0e2')?.notation).toBe('相七进五');
    expect(initial.findLegalMove('d0e1')?.notation).toBe('仕六进五');
    expect(initial.findLegalMove('e0e1')?.notation).toBe('帅五进一');
    expect(initial.findLegalMove('a3a4')?.notation).toBe('兵九进一');

    const afterRed = XiangqiGame.initial();
    afterRed.apply('h2e2');
    expect(afterRed.findLegalMove('b9c7')?.notation).toBe('马二进三');
    expect(afterRed.findLegalMove('a9a8')?.notation).toBe('车一进一');
    expect(afterRed.findLegalMove('e6e5')?.notation).toBe('卒五进一');
    expect(afterRed.findLegalMove('e9e8')?.notation).toBe('将五进一');
  });

  it('平：同行移动使用目标纵线号', () => {
    expect(
      notationOf('3k5/9/9/9/9/9/9/9/9/4K4 w - - 0 1', 'e0f0'),
    ).toBe('帅五平四');
    expect(
      notationOf('4k4/9/9/4P4/9/9/9/9/9/3K5 w - - 0 1', 'e6d6'),
    ).toBe('兵五平六');
  });

  it('马/相/仕用目标纵线号，车/炮/兵/帅用走的步数（红方中文数字）', () => {
    expect(
      notationOf('3k5/9/9/9/9/9/9/9/9/3AK4 w - - 0 1', 'd0e1'),
    ).toBe('仕六进五');
    expect(
      notationOf('3k5/9/9/9/9/4B4/9/9/9/4K4 w - - 0 1', 'e4c2'),
    ).toBe('相五退七');
    expect(
      notationOf('3k5/9/9/9/9/9/9/4N4/9/4K4 w - - 0 1', 'e2c3'),
    ).toBe('马五进七');
    expect(
      notationOf('3k5/9/9/9/9/9/9/9/9/R3K4 w - - 0 1', 'a0a5'),
    ).toBe('车九进五');
  });

  it('两个同类型棋子同线：前/后 且省略纵线号', () => {
    const fen = '4k4/9/9/9/9/9/R8/9/9/R2K5 w - - 0 1';
    expect(notationOf(fen, 'a3a5')).toBe('前车进二');
    expect(notationOf(fen, 'a0a1')).toBe('后车进一');
  });

  it('三个同类型棋子同线：前/中/后', () => {
    const fen = '4k4/P8/9/P8/9/9/P8/9/9/3K5 w - - 0 1';
    expect(notationOf(fen, 'a8a9')).toBe('前兵进一');
    expect(notationOf(fen, 'a6a7')).toBe('中兵进一');
    expect(notationOf(fen, 'a6b6')).toBe('中兵平八');
    expect(notationOf(fen, 'a3a4')).toBe('后兵进一');
  });

  it('黑方同样使用前/后，数字统一为汉字数字', () => {
    const fen = 'r3k4/9/9/r8/9/9/9/9/9/3K5 b - - 0 1';
    expect(notationOf(fen, 'a6a5')).toBe('前车进一');
    expect(notationOf(fen, 'a9a8')).toBe('后车进一');
  });

  it('超过三个同线棋子退化为坐标前缀，且不会产生歧义', () => {
    const fen = '4k4/9/9/9/9/P8/P8/P8/P8/3K5 w - - 0 1';
    // 四个红兵同在 a 线，使用坐标前缀 a4
    expect(notationOf(fen, 'a4a5')).toBe('a4兵九进一');
  });

  it('同线成组不会影响其他纵线棋子的正常记谱', () => {
    const fen = '4k4/9/9/9/9/9/1P7/P8/P8/3K5 w - - 0 1';
    expect(notationOf(fen, 'a2a3')).toBe('前兵进一');
    // b 线上只有一个兵，仍保留纵线号
    expect(notationOf(fen, 'b3b4')).toBe('兵八进一');
  });

  it('apply 返回的 EngineMove 带回中文记谱', () => {
    const game = XiangqiGame.initial();
    const applied = game.apply('h2e2');
    expect(applied.notation).toBe('炮二平五');
    const black = XiangqiGame.initial();
    black.apply('h2e2');
    expect(black.apply('b9c7').notation).toBe('马二进三');
  });
});
