import { describe, expect, it } from 'vitest';
import {
  IllegalMoveError,
  MAX_PLIES,
  NO_PROGRESS_PLIES,
  XiangqiGame,
  isDeadPosition,
} from './index';

const START_PLACEMENT = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR';
const MATE_BLACK_TO_MOVE = '3Rka3/3R5/9/9/9/9/9/9/9/3K5 b - - 0 1';
const MATE_RED_TO_MOVE = '3k5/9/9/9/9/9/9/9/3r5/3rKa3 w - - 0 1';
const STALEMATE_BLACK_TO_MOVE = '4k4/3R1R3/9/9/9/9/9/9/9/3K5 b - - 0 1';
const KINGS_ONLY = '4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1';
const KINGS_AND_GUARDS = '2baka3/9/9/9/9/9/9/9/4A4/3K5 w - - 0 1';
const KINGS_AND_RED_PAWN = '4k4/9/9/9/9/9/4P4/9/9/3K5 w - - 0 1';

describe('终局判定', () => {
  it('初始局面无终局', () => {
    expect(XiangqiGame.initial().outcome()).toBeNull();
  });

  it('将死：黑方被将死，红方胜', () => {
    const game = XiangqiGame.fromFen(MATE_BLACK_TO_MOVE);
    expect(game.checked).toBe(true);
    expect(game.legalMoves()).toHaveLength(0);
    expect(game.outcome()).toEqual({
      winner: 'red',
      reason: 'checkmate',
      text: '红方将死黑方',
    });
  });

  it('将死：红方被将死，黑方胜', () => {
    const game = XiangqiGame.fromFen(MATE_RED_TO_MOVE);
    expect(game.checked).toBe(true);
    expect(game.legalMoves()).toHaveLength(0);
    expect(game.outcome()).toEqual({
      winner: 'black',
      reason: 'checkmate',
      text: '黑方将死红方',
    });
  });

  it('困毙判负：无子可动且未被将军，走子方判负', () => {
    const game = XiangqiGame.fromFen(STALEMATE_BLACK_TO_MOVE);
    expect(game.checked).toBe(false);
    expect(game.legalMoves()).toHaveLength(0);
    const outcome = game.outcome();
    expect(outcome).not.toBeNull();
    expect(outcome!.winner).toBe('red');
    expect(outcome!.reason).toBe('stalemate');
    expect(outcome!.text).toContain('困毙');
    expect(outcome!.text).toContain('红方');
    expect(outcome!.text).toContain('黑方');
  });

  it('死局：双方均无车马炮兵时立即判和', () => {
    const bareKings = XiangqiGame.fromFen(KINGS_ONLY);
    expect(isDeadPosition(bareKings.board)).toBe(true);
    expect(bareKings.outcome()).toEqual({
      winner: null,
      reason: 'dead-position',
      text: '死局：双方均无进攻子力，无法将死对方，判和',
    });

    // Advisors and elephants cannot attack the opposing palace, so they do
    // not create mating chances for either side.
    const guards = XiangqiGame.fromFen(KINGS_AND_GUARDS);
    expect(isDeadPosition(guards.board)).toBe(true);
    expect(guards.outcome()?.reason).toBe('dead-position');
  });

  it('存在任意进攻子力时不会误判死局', () => {
    const withPawn = XiangqiGame.fromFen(KINGS_AND_RED_PAWN);
    expect(isDeadPosition(withPawn.board)).toBe(false);
    expect(withPawn.outcome()).toBeNull();
    expect(XiangqiGame.initial().outcome()).toBeNull();
  });

  it('死局优先于无进展和手数上限', () => {
    const deadWithHighCounters = XiangqiGame.fromFen(
      KINGS_ONLY.replace('w - - 0 1', 'w - - 120 61'),
    );
    expect(deadWithHighCounters.outcome()?.reason).toBe('dead-position');
  });

  it('连续 60 回合无吃子、无兵卒推进判死局（无进展）', () => {
    const before = XiangqiGame.fromFen(`${START_PLACEMENT} w - - ${NO_PROGRESS_PLIES - 1} 60`);
    expect(before.outcome()).toBeNull();

    const atLimit = XiangqiGame.fromFen(`${START_PLACEMENT} w - - ${NO_PROGRESS_PLIES} 61`);
    expect(atLimit.outcome()).toEqual({
      winner: null,
      reason: 'no-progress',
      text: '死局：连续 60 回合无吃子且无兵卒推进，判和',
    });
  });

  it('兵卒推进后无进展计数重置，不误判死局', () => {
    const game = XiangqiGame.fromFen(
      `${START_PLACEMENT} w - - ${NO_PROGRESS_PLIES - 1} 60`,
    );
    game.apply('a3a4');
    expect(game.outcome()).toBeNull();
  });

  it('三次重复局面判和：第三次出现（棋盘 + 走子方）时触发', () => {
    const game = XiangqiGame.initial();
    const cycle = ['b0c2', 'b9c7', 'c2b0', 'c7b9'];
    for (let round = 0; round < 2; round += 1) {
      for (const ucci of cycle) {
        game.apply(ucci);
        if (game.ply < 8) {
          expect(game.outcome(), `ply ${game.ply} 时不应判和`).toBeNull();
        }
      }
    }
    expect(game.ply).toBe(8);
    const outcome = game.outcome();
    expect(outcome).toEqual({
      winner: null,
      reason: 'repetition',
      text: '三次重复局面，判和',
    });
    // 判和后不能继续走子
    let caught: unknown;
    try {
      game.apply('b0c2');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IllegalMoveError);
    expect((caught as IllegalMoveError).code).toBe('game-over');
  });

  it('重复历史包含初始局面，且可被 clone 继承', () => {
    const game = XiangqiGame.initial();
    const cycle = ['b0c2', 'b9c7', 'c2b0', 'c7b9'];
    for (const ucci of cycle) game.apply(ucci); // 初始局面第二次出现

    const clone = game.clone();
    expect(clone.outcome()).toBeNull();
    for (const ucci of cycle) clone.apply(ucci);
    expect(clone.outcome()?.reason).toBe('repetition');

    // 原对象不受 clone 影响，但自己走完同样循环后也会判和
    expect(game.outcome()).toBeNull();
    for (const ucci of cycle) game.apply(ucci);
    expect(game.outcome()?.reason).toBe('repetition');
  });

  it('达到 300 手上限判和（边界 298/299/300/301）', () => {
    const at = (side: 'w' | 'b', fullmove: number): XiangqiGame =>
      XiangqiGame.fromFen(`${START_PLACEMENT} ${side} - - 0 ${fullmove}`);

    const p298 = at('w', 150);
    expect(p298.ply).toBe(298);
    expect(p298.outcome()).toBeNull();

    const p299 = at('b', 150);
    expect(p299.ply).toBe(299);
    expect(p299.outcome()).toBeNull();

    const p300 = at('w', 151);
    expect(p300.ply).toBe(300);
    expect(p300.outcome()).toEqual({
      winner: null,
      reason: 'max-plies',
      text: `达到 ${MAX_PLIES} 手上限，判和`,
    });

    const p301 = at('b', 151);
    expect(p301.ply).toBe(301);
    expect(p301.outcome()?.reason).toBe('max-plies');

    let caught: unknown;
    try {
      p300.apply('h2e2');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IllegalMoveError);
    expect((caught as IllegalMoveError).code).toBe('game-over');
  });

  it('终局优先级：无子可动优先于手数上限', () => {
    const highCounterMate = XiangqiGame.fromFen(
      MATE_BLACK_TO_MOVE.replace('0 1', '0 151'),
    );
    expect(highCounterMate.ply).toBeGreaterThanOrEqual(MAX_PLIES);
    expect(highCounterMate.outcome()?.reason).toBe('checkmate');

    const highCounterStalemate = XiangqiGame.fromFen(
      STALEMATE_BLACK_TO_MOVE.replace('0 1', '0 151'),
    );
    expect(highCounterStalemate.ply).toBeGreaterThanOrEqual(MAX_PLIES);
    expect(highCounterStalemate.outcome()?.reason).toBe('stalemate');
  });

  it('对局进行中 outcome 为 null，且已分胜负时 legalMoves 为空', () => {
    const game = XiangqiGame.initial();
    game.apply('h2e2');
    expect(game.outcome()).toBeNull();
    const mate = XiangqiGame.fromFen(MATE_BLACK_TO_MOVE);
    expect(mate.outcome()).not.toBeNull();
    expect(mate.legalMoves()).toHaveLength(0);
  });

  it('通过真实走子完成将死：apply 后立即判定', () => {
    // 红方走 d1d9 之前黑方并未被将军；该着形成将死。
    const game = XiangqiGame.fromFen('R1P1kb3/4b4/9/9/9/9/9/9/3R5/3K5 w - - 0 1');
    expect(game.checked).toBe(false);
    expect(game.outcome()).toBeNull();
    const applied = game.apply('d1d9');
    expect(applied.notation).toBe('车六进八');
    expect(game.outcome()).toEqual({
      winner: 'red',
      reason: 'checkmate',
      text: '红方将死黑方',
    });
    expect(game.checked).toBe(true);
    expect(game.moveNumber).toBe(1);
    expect(game.ply).toBe(1);
  });

  it('通过真实走子达到 300 手上限', () => {
    const game = XiangqiGame.fromFen(`${START_PLACEMENT} w - - 0 150`);
    expect(game.ply).toBe(298);
    game.apply('h2e2');
    expect(game.ply).toBe(299);
    expect(game.outcome()).toBeNull();
    game.apply('b9c7');
    expect(game.ply).toBe(300);
    expect(game.outcome()?.reason).toBe('max-plies');
  });
});
