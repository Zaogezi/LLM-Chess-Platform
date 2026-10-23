import { describe, expect, it } from 'vitest';
import type { MoveView, Side } from '../../shared/protocol';
import { START_FEN } from '../../shared/protocol';
import { applyUcciMove, boardFromFen, buildReplayFrames } from './replay';

function move(ply: number, side: Side, ucci: string): MoveView {
  return {
    ply,
    side,
    ucci,
    notation: `${side}-${ucci}`,
    pieceLabel: '炮',
    capturedLabel: null,
    reason: 'test',
    latencyMs: 10,
    tokensIn: 1,
    tokensOut: 1,
    at: 0,
  };
}

describe('boardFromFen', () => {
  it('parses the standard start position into 90 squares with unique ids', () => {
    const board = boardFromFen(START_FEN);
    expect(board).toHaveLength(90);
    expect(board.filter(Boolean)).toHaveLength(32);

    const ids = board.filter((piece): piece is NonNullable<typeof piece> => piece !== null)
      .map((piece) => piece.id);
    expect(new Set(ids).size).toBe(32);

    expect(board[0]).toMatchObject({ side: 'red', type: 'rook' });
    expect(board[4]).toMatchObject({ side: 'red', type: 'king' });
    expect(board[81]).toMatchObject({ side: 'black', type: 'rook' });
    expect(board[85]).toMatchObject({ side: 'black', type: 'king' });
    expect(board[19]).toMatchObject({ side: 'red', type: 'cannon' });
  });
});

describe('applyUcciMove', () => {
  it('moves a piece and removes any captured piece without mutating the input', () => {
    const board = boardFromFen(START_FEN);
    const moved = applyUcciMove(board, 'h2e2');

    expect(moved[25]).toBeNull();
    expect(moved[22]).toMatchObject({ side: 'red', type: 'cannon' });
    expect(board[25]).toMatchObject({ side: 'red', type: 'cannon' });
  });

  it('ignores malformed or empty moves', () => {
    const board = boardFromFen(START_FEN);
    expect(applyUcciMove(board, 'zzzz')).toEqual(board);
    expect(applyUcciMove(board, 'e5e4')).toEqual(board);
  });
});

describe('buildReplayFrames', () => {
  it('builds one frame per ply plus the opening position', () => {
    const moves = [move(1, 'red', 'h2e2'), move(2, 'black', 'h9g7')];
    const frames = buildReplayFrames(moves);

    expect(frames).toHaveLength(3);
    expect(frames[0]?.ply).toBe(0);
    expect(frames[0]?.lastMove).toBeNull();
    expect(frames[0]?.turn).toBe('red');

    expect(frames[1]?.ply).toBe(1);
    expect(frames[1]?.lastMove).toEqual({ fromUcci: 'h2', toUcci: 'e2', side: 'red' });
    expect(frames[1]?.turn).toBe('black');
    expect(frames[1]?.moves).toHaveLength(1);

    expect(frames[2]?.ply).toBe(2);
    expect(frames[2]?.lastMove).toEqual({ fromUcci: 'h9', toUcci: 'g7', side: 'black' });
    expect(frames[2]?.turn).toBe('red');
    expect(frames[2]?.board[25]).toBeNull();
    expect(frames[2]?.board[22]).toMatchObject({ side: 'red', type: 'cannon' });
  });

  it('keeps stepping safely through a malformed move', () => {
    const frames = buildReplayFrames([move(1, 'red', 'bad')]);
    expect(frames).toHaveLength(2);
    expect(frames[1]?.board).toEqual(frames[0]?.board);
  });
});
