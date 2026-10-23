import { describe, expect, it } from 'vitest';
import { START_FEN, XiangqiGame } from './index';

describe('perft 着法生成验证', () => {
  it('初始局面 perft(0..3) = 1 / 44 / 1920 / 79666', () => {
    const game = XiangqiGame.initial();
    expect(game.perft(0)).toBe(1);
    expect(game.perft(1)).toBe(44);
    expect(game.perft(2)).toBe(1920);
    expect(game.perft(3)).toBe(79666);
  }, 20000);

  it('黑方行棋的对称初始局面 perft 一致', () => {
    const blackToMove = XiangqiGame.fromFen(START_FEN.replace(' w ', ' b '));
    expect(blackToMove.sideToMove).toBe('black');
    expect(blackToMove.perft(1)).toBe(44);
    expect(blackToMove.perft(2)).toBe(1920);
  }, 20000);

  it('perft(2) 与逐子展开一致（初始局面与走子后局面）', () => {
    const initial = XiangqiGame.initial();
    let sum = 0;
    for (const move of initial.legalMoves()) {
      const child = initial.clone();
      child.apply(move);
      sum += child.perft(1);
    }
    expect(sum).toBe(initial.perft(2));

    const afterMove = XiangqiGame.initial();
    afterMove.apply('h2e2');
    let movedSum = 0;
    for (const move of afterMove.legalMoves()) {
      const child = afterMove.clone();
      child.apply(move);
      movedSum += child.perft(1);
    }
    expect(movedSum).toBe(afterMove.perft(2));
  }, 20000);
});
