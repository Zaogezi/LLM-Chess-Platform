import { describe, expect, it } from 'vitest';
import type { PieceView } from '../../shared/protocol';
import { IllegalMoveError, START_FEN, XiangqiGame } from './index';

function pieces(board: (PieceView | null)[]): PieceView[] {
  return board.filter((piece): piece is PieceView => piece !== null);
}

describe('FEN 解析与初始局面', () => {
  it('初始局面 FEN 精确往返', () => {
    const game = XiangqiGame.initial();
    expect(game.fen).toBe(START_FEN);
    expect(XiangqiGame.fromFen(START_FEN).fen).toBe(START_FEN);
  });

  it('初始棋盘为 90 格、32 子，方位与协议一致', () => {
    const board = XiangqiGame.initial().board;
    expect(board).toHaveLength(90);
    expect(pieces(board)).toHaveLength(32);
    expect(pieces(board).filter((p) => p.side === 'red')).toHaveLength(16);
    expect(pieces(board).filter((p) => p.side === 'black')).toHaveLength(16);

    // row 0 = Red home rank, row 9 = Black home rank (index = row * 9 + col)
    expect(board[0]).toEqual({ id: 'red-rook-1', type: 'rook', side: 'red' });
    expect(board[1]).toEqual({ id: 'red-horse-1', type: 'horse', side: 'red' });
    expect(board[2]).toEqual({ id: 'red-elephant-1', type: 'elephant', side: 'red' });
    expect(board[3]).toEqual({ id: 'red-advisor-1', type: 'advisor', side: 'red' });
    expect(board[4]).toEqual({ id: 'red-king-1', type: 'king', side: 'red' });
    expect(board[8]).toEqual({ id: 'red-rook-2', type: 'rook', side: 'red' });
    expect(board[19]).toEqual({ id: 'red-cannon-1', type: 'cannon', side: 'red' });
    expect(board[25]).toEqual({ id: 'red-cannon-2', type: 'cannon', side: 'red' });
    expect(board[27]).toEqual({ id: 'red-pawn-1', type: 'pawn', side: 'red' });
    expect(board[35]).toEqual({ id: 'red-pawn-5', type: 'pawn', side: 'red' });

    expect(board[81]).toEqual({ id: 'black-rook-1', type: 'rook', side: 'black' });
    expect(board[85]).toEqual({ id: 'black-king-1', type: 'king', side: 'black' });
    expect(board[89]).toEqual({ id: 'black-rook-2', type: 'rook', side: 'black' });
    expect(board[64]).toEqual({ id: 'black-cannon-1', type: 'cannon', side: 'black' });
    expect(board[70]).toEqual({ id: 'black-cannon-2', type: 'cannon', side: 'black' });
    expect(board[54]).toEqual({ id: 'black-pawn-1', type: 'pawn', side: 'black' });
  });

  it('棋子 ID 唯一且确定', () => {
    const first = pieces(XiangqiGame.initial().board).map((piece) => piece.id);
    const second = pieces(XiangqiGame.initial().board).map((piece) => piece.id);
    expect(new Set(first).size).toBe(first.length);
    expect(second).toEqual(first);
    expect(first).toContain('red-king-1');
    expect(first).toContain('black-king-1');
  });

  it('board 每次返回全新副本，外部修改不影响引擎', () => {
    const game = XiangqiGame.initial();
    const first = game.board;
    const second = game.board;
    expect(first).not.toBe(second);
    first[0] = null;
    first[4] = null;
    expect(game.board[0]).toEqual({ id: 'red-rook-1', type: 'rook', side: 'red' });
    expect(game.board[4]?.type).toBe('king');
  });

  it('接受 h/e 别名，并总是序列化为规范的 n/b', () => {
    const aliasFen =
      'rheakaehr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RHEAKAEHR w - - 0 1';
    const alias = XiangqiGame.fromFen(aliasFen);
    expect(alias.fen).toBe(START_FEN);
    expect(alias.board).toEqual(XiangqiGame.initial().board);
  });

  it('保留半回合数与回合数', () => {
    const fen =
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR b - - 17 42';
    const game = XiangqiGame.fromFen(fen);
    expect(game.fen).toBe(fen);
    expect(game.sideToMove).toBe('black');
    expect(game.moveNumber).toBe(42);
    // ply derived from the preserved counters: (42 - 1) * 2 + 1
    expect(game.ply).toBe(83);
  });

  it('允许 2 字段与 4 字段 FEN，缺省计数器为 0 0 1', () => {
    const placement = '4k4/9/9/9/9/9/9/9/9/4K4';
    for (const fen of [`${placement} w`, `${placement} w - -`]) {
      const game = XiangqiGame.fromFen(fen);
      expect(game.fen).toBe(`${placement} w - - 0 1`);
      expect(game.moveNumber).toBe(1);
      expect(game.ply).toBe(0);
    }
  });

  it('走子后 FEN 往返并保留计数', () => {
    const game = XiangqiGame.initial();
    game.apply('h2e2');
    expect(game.fen).toBe(
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 1 1',
    );
    game.apply('b9c7');
    expect(game.fen).toBe(
      'r1bakabnr/9/1cn4c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR w - - 2 2',
    );
    expect(game.moveNumber).toBe(2);
    expect(game.ply).toBe(2);
    expect(game.sideToMove).toBe('red');

    const reloaded = XiangqiGame.fromFen(game.fen);
    expect(reloaded.fen).toBe(game.fen);
    expect(reloaded.board).toEqual(game.board);
    expect(reloaded.ply).toBe(2);
  });

  it('非法 FEN 抛出 bad-format 中文错误', () => {
    const badFens = [
      '',
      '   ',
      'not a fen',
      // 1 / 3 / 5 / 7 字段
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR',
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w -',
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0',
      'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1 x',
      // 行数错误
      '9/9/9/9/9/9/9/9/9 w - - 0 1',
      '4k4/9/9/9/9/9/9/9/9/4K4/9 w - - 0 1',
      // 行宽错误
      '4k4/9/9/9/9/9/9/9/9/4K3 w - - 0 1',
      '4k4/9/9/9/9/9/9/9/9/4K41 w - - 0 1',
      // 非法字符
      '4k4/9/9/9/9/9/9/9/9/4x4 w - - 0 1',
      // 缺将 / 多将
      '9/9/9/9/9/9/9/9/9/4K4 w - - 0 1',
      '4k4/9/9/9/9/9/9/9/9/9 w - - 0 1',
      '4k4/9/9/9/9/9/9/9/9/3KK4 w - - 0 1',
      // 走子方 / 计数 / 非空易位字段
      '4k4/9/9/9/9/9/9/9/9/4K4 x - - 0 1',
      '4k4/9/9/9/9/9/9/9/9/4K4 w - - 1.5 1',
      '4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 0',
      '4k4/9/9/9/9/9/9/9/9/4K4 w k - 0 1',
      '4k4/9/9/9/9/9/9/9/9/4K4 w - e3 0 1',
    ];
    for (const fen of badFens) {
      let caught: unknown;
      try {
        XiangqiGame.fromFen(fen);
      } catch (error) {
        caught = error;
      }
      expect(caught, `应拒绝 FEN: ${JSON.stringify(fen)}`).toBeInstanceOf(IllegalMoveError);
      expect((caught as IllegalMoveError).code).toBe('bad-format');
      expect((caught as Error).message).toMatch(/FEN/);
    }
  });
});
