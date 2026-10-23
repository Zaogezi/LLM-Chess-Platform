import { describe, expect, it } from 'vitest';
import type { EngineMove } from './index';
import { IllegalMoveError, XiangqiGame } from './index';

function expectIllegal(fn: () => unknown, code: IllegalMoveError['code']): IllegalMoveError {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught, '应当抛出 IllegalMoveError').toBeInstanceOf(IllegalMoveError);
  const error = caught as IllegalMoveError;
  expect(error.code).toBe(code);
  expect(error.message.length).toBeGreaterThan(0);
  // 错误信息应为中文
  expect(error.message).toMatch(/[\u4e00-\u9fa5]/);
  return error;
}

describe('XiangqiGame 基础状态与走子', () => {
  it('初始状态字段', () => {
    const game = XiangqiGame.initial();
    expect(game.sideToMove).toBe('red');
    expect(game.moveNumber).toBe(1);
    expect(game.ply).toBe(0);
    expect(game.checked).toBe(false);
    expect(game.outcome()).toBeNull();
  });

  it('legalMoves 完整、有序、字段自洽', () => {
    const game = XiangqiGame.initial();
    const snapshot = game.board;
    const moves = game.legalMoves();
    expect(moves).toHaveLength(44);
    expect(moves.map((move) => move.ucci)).toEqual(
      moves.map((move) => move.ucci).slice().sort(),
    );
    for (const move of moves) {
      expect(move.ucci).toMatch(/^[a-i][0-9][a-i][0-9]$/);
      expect(move.notation.length).toBeGreaterThan(0);
      expect(move.side).toBe('red');
      expect(snapshot[move.from]).not.toBeNull();
      expect(snapshot[move.from]!.side).toBe(move.side);
      expect(snapshot[move.from]!.type).toBe(move.piece);
      expect(move.captured).toBe(snapshot[move.to]?.type ?? null);
      if (snapshot[move.to]) expect(snapshot[move.to]!.side).toBe('black');
      expect(move.from).not.toBe(move.to);
    }
    expect(moves.find((move) => move.ucci === 'h2e2')?.notation).toBe('炮二平五');
    expect(moves.find((move) => move.ucci === 'h2h9')?.captured).toBe('horse');
  });

  it('apply 字符串：返回着法、翻转走子方、推进计数', () => {
    const game = XiangqiGame.initial();
    const applied = game.apply('h2e2');
    expect(applied.ucci).toBe('h2e2');
    expect(applied.piece).toBe('cannon');
    expect(applied.side).toBe('red');
    expect(applied.captured).toBeNull();
    expect(applied.notation).toBe('炮二平五');
    expect(game.sideToMove).toBe('black');
    expect(game.ply).toBe(1);
    expect(game.moveNumber).toBe(1);

    const reply = game.apply('b9c7');
    expect(reply.notation).toBe('马2进3');
    expect(game.sideToMove).toBe('red');
    expect(game.ply).toBe(2);
    expect(game.moveNumber).toBe(2);
  });

  it('apply EngineMove：接受 legalMoves 返回的对象', () => {
    const game = XiangqiGame.initial();
    const move = game.findLegalMove('b0c2');
    expect(move).not.toBeNull();
    const applied = game.apply(move as EngineMove);
    expect(applied.ucci).toBe('b0c2');
    expect(game.board[20]).toEqual({ id: 'red-horse-1', type: 'horse', side: 'red' });
    expect(game.board[1]).toBeNull();
  });

  it('接受大小写与空白（findLegalMove / apply 规范化）', () => {
    const game = XiangqiGame.initial();
    const spaced = game.findLegalMove(' H2E2 ');
    expect(spaced).not.toBeNull();
    expect(spaced?.ucci).toBe('h2e2');
    expect(game.findLegalMove('H2E2')?.notation).toBe('炮二平五');
    expect(game.findLegalMove('h2e2')).not.toBeNull();
    expect(game.findLegalMove('zzzz')).toBeNull();
    expect(game.findLegalMove('a0a10')).toBeNull();
    expect(game.findLegalMove('h2e')).toBeNull();
    expect(game.findLegalMove('j2e2')).toBeNull();
    expect(game.findLegalMove('a0-a1')).toBeNull();
    expect(game.findLegalMove('')).toBeNull();

    const upper = XiangqiGame.initial();
    expect(upper.apply('H2E2').ucci).toBe('h2e2');
  });

  it('board 返回副本，apply 不暴露内部数组', () => {
    const game = XiangqiGame.initial();
    const view = game.board;
    view[0] = null;
    expect(game.board[0]?.id).toBe('red-rook-1');
  });

  it('clone 完全独立且保留历史/IDs', () => {
    const game = XiangqiGame.initial();
    game.apply('h2e2');
    const clone = game.clone();
    expect(clone.fen).toBe(game.fen);
    expect(clone.board).toEqual(game.board);
    expect(clone.legalMoves()).toEqual(game.legalMoves());

    clone.apply('b9c7');
    expect(clone.fen).not.toBe(game.fen);
    expect(game.board[85]?.id).toBe('black-king-1');
    expect(game.ply).toBe(1);
    expect(game.sideToMove).toBe('black');
    expect(clone.ply).toBe(2);

    // 被吃子消失，棋子 ID 跨走子保持稳定
    const captureGame = XiangqiGame.fromFen(
      '4k4/9/9/9/9/r8/9/p8/9/R2K5 w - - 7 12',
    );
    const rookId = captureGame.board[0]!.id;
    const capture = captureGame.apply('a0a2');
    expect(capture.captured).toBe('pawn');
    expect(captureGame.board[0]).toBeNull();
    expect(captureGame.board[18]).toEqual({ id: rookId, type: 'rook', side: 'red' });
    expect(captureGame.board.filter((piece) => piece !== null)).toHaveLength(
      XiangqiGame.fromFen('4k4/9/9/9/9/r8/9/p8/9/R2K5 w - - 7 12').board.filter(
        (piece) => piece !== null,
      ).length - 1,
    );
  });

  it('半回合计数：普通着法 +1，兵/吃子清零，回合数在黑方走完后 +1', () => {
    const pawnGame = XiangqiGame.fromFen(
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 5 7',
    );
    pawnGame.apply('a3a4');
    expect(pawnGame.fen).toBe(
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/P8/2P1P1P1P/1C5C1/9/RNBAKABNR b - - 0 7',
    );

    const captureGame = XiangqiGame.fromFen(
      '4k4/9/9/9/9/r8/9/p8/9/R2K5 w - - 7 12',
    );
    captureGame.apply('a0a2');
    expect(captureGame.fen).toBe('4k4/9/9/9/9/r8/9/R8/9/3K5 b - - 0 12');

    const normal = XiangqiGame.initial();
    normal.apply('h2e2');
    expect(normal.fen).toContain(' b - - 1 1');
    normal.apply('b9c7');
    expect(normal.fen).toContain(' w - - 2 2');
  });

  it('非法走子错误码：bad-format / no-piece / not-your-piece / illegal', () => {
    const game = XiangqiGame.initial();
    expectIllegal(() => game.apply('z9e2'), 'bad-format');
    expectIllegal(() => game.apply('a10a1'), 'bad-format');
    expectIllegal(() => game.apply('h2e'), 'bad-format');
    expectIllegal(() => game.apply(''), 'bad-format');
    expectIllegal(() => game.apply('e4e5'), 'no-piece');
    expectIllegal(() => game.apply('b9c7'), 'not-your-piece');
    expectIllegal(() => game.apply('b0b1'), 'illegal');
    expectIllegal(() => game.apply('h2h8'), 'illegal');

    // 已经走过的着法（起点已空）视为非法
    game.apply('h2e2');
    expectIllegal(() => game.apply('h2e2'), 'no-piece');
  });

  it('EngineMove 对象校验：走子方/棋子/坐标', () => {
    const game = XiangqiGame.initial();
    const move = game.findLegalMove('h2e2') as EngineMove;

    expectIllegal(
      () => game.apply({ ...move, side: 'black' }),
      'not-your-piece',
    );
    expectIllegal(
      () => game.apply({ ...move, piece: 'rook' }),
      'illegal',
    );
    expectIllegal(
      () => game.apply({ ...move, from: -1 }),
      'bad-format',
    );
    expectIllegal(
      () => game.apply({ ...move, to: 90 }),
      'bad-format',
    );
    // 合法对象仍然可以通过
    expect(game.apply(move).ucci).toBe('h2e2');
  });

  it('对局结束后 apply 抛出 game-over', () => {
    const mate = XiangqiGame.fromFen('3Rka3/3R5/9/9/9/9/9/9/9/3K5 b - - 0 1');
    expect(mate.outcome()?.reason).toBe('checkmate');
    const error = expectIllegal(() => mate.apply('e9e8'), 'game-over');
    expect(error.message).toContain('红方将死黑方');
  });

  it('perft 参数校验且 depth 0 = 1；perft(1) 等于合法着法数', () => {
    const game = XiangqiGame.initial();
    expect(game.perft(0)).toBe(1);
    expect(game.perft(1)).toBe(game.legalMoves().length);
    expectIllegal(() => game.perft(-1), 'bad-format');
    expectIllegal(() => game.perft(1.5), 'bad-format');
  });

  it('确定性连续走子 40 步：状态自洽、FEN 可往返、棋子 ID 稳定', () => {
    const game = XiangqiGame.initial();
    for (let step = 0; step < 40; step += 1) {
      if (game.outcome()) break;
      const moves = game.legalMoves();
      expect(moves.length).toBeGreaterThan(0);
      const idsBefore = new Set(
        game.board.flatMap((piece) => (piece ? [piece.id] : [])),
      );
      const move = moves[(step * 7 + 3) % moves.length];
      game.apply(move);

      const board = game.board;
      const idsAfter = new Set(board.flatMap((piece) => (piece ? [piece.id] : [])));
      expect(idsAfter.size).toBeLessThanOrEqual(idsBefore.size);
      for (const id of idsAfter) expect(idsBefore.has(id)).toBe(true);
      expect(XiangqiGame.fromFen(game.fen).fen).toBe(game.fen);
      expect(game.sideToMove).toBe(
        moves[0].side === 'red' ? 'black' : 'red',
      );
      expect(game.ply).toBe(step + 1);
    }
  });
});
