import { describe, expect, it } from 'vitest';
import { XiangqiGame } from './index';

function game(fen: string): XiangqiGame {
  return XiangqiGame.fromFen(fen);
}

function has(target: XiangqiGame, ucci: string): boolean {
  return target.findLegalMove(ucci) !== null;
}

describe('棋子走法规则', () => {
  it('马腿阻挡：被蹩马腿的方向不可走，其余方向正常', () => {
    // 红马 e4，黑卒 e5 蹩住向上两条马腿；向下的马腿未被阻挡。
    const g = game('3k5/9/9/9/4p4/4N4/9/9/9/4K4 w - - 0 1');
    expect(has(g, 'e4d6')).toBe(false);
    expect(has(g, 'e4f6')).toBe(false);
    expect(has(g, 'e4d2')).toBe(true);
    expect(has(g, 'e4f2')).toBe(true);
    expect(has(g, 'e4c3')).toBe(true);
    expect(has(g, 'e4g3')).toBe(true);
    expect(has(g, 'e4c5')).toBe(true);
    expect(has(g, 'e4g5')).toBe(true);
  });

  it('象眼阻挡与不过河', () => {
    // 红相 c0，黑卒占 d1 塞住 c0-e2 的象眼。
    const blocked = game('3k5/9/9/9/9/9/9/9/3p5/2B1K4 w - - 0 1');
    expect(has(blocked, 'c0e2')).toBe(false);
    expect(has(blocked, 'c0a2')).toBe(true);

    // 红相 e4 靠近河界：向前的 c6/g6 过河非法，向后正常。
    const river = game('3k5/9/9/9/9/4B4/9/9/9/4K4 w - - 0 1');
    expect(has(river, 'e4c6')).toBe(false);
    expect(has(river, 'e4g6')).toBe(false);
    expect(has(river, 'e4c2')).toBe(true);
    expect(has(river, 'e4g2')).toBe(true);
  });

  it('仕/帅只能在九宫内活动', () => {
    const advisor = game('3k5/9/9/9/9/9/9/9/9/3AK4 w - - 0 1');
    expect(has(advisor, 'd0e1')).toBe(true);
    expect(has(advisor, 'd0c1')).toBe(false); // c1 在九宫外
    expect(has(advisor, 'd0d1')).toBe(false); // 仕不能直走

    const king = game('5k3/9/9/9/9/9/9/3K5/9/9 w - - 0 1');
    expect(has(king, 'd2d1')).toBe(true);
    expect(has(king, 'd2d3')).toBe(false); // 红帅不可越过第 3 行
    expect(has(king, 'd2c2')).toBe(false); // 红帅不可离开 3-5 列
    expect(has(king, 'd2e2')).toBe(true);
  });

  it('炮：无炮架不可吃，有且仅有一个炮架可吃', () => {
    // 无炮架：a0 炮与 a5 黑车之间无子，不能吃。
    const noScreen = game('3k5/9/9/9/r8/9/9/9/9/C3K4 w - - 0 1');
    expect(has(noScreen, 'a0a5')).toBe(false);
    expect(has(noScreen, 'a0a4')).toBe(true);

    // 恰好一个炮架（红兵 a3）：可以吃 a5 黑车。
    const oneScreen = game('3k5/9/9/9/r8/9/P8/9/9/C3K4 w - - 0 1');
    const capture = oneScreen.findLegalMove('a0a5');
    expect(capture).not.toBeNull();
    expect(capture!.captured).toBe('rook');
    expect(capture!.notation).toBe('炮九进五');
    // 炮不能越过炮架做非吃子移动
    expect(has(oneScreen, 'a0a4')).toBe(false);

    // 两个炮架：不能吃。
    const twoScreens = game('3k5/9/9/9/r8/9/P8/P8/9/C3K4 w - - 0 1');
    expect(has(twoScreens, 'a0a5')).toBe(false);
    expect(has(twoScreens, 'a0a1')).toBe(true);
  });

  it('车：被己方或敌方棋子阻挡，可吃第一个敌子', () => {
    const g = game('4k4/9/9/9/9/r8/9/p8/9/R2K5 w - - 0 1');
    const capture = g.findLegalMove('a0a2');
    expect(capture).not.toBeNull();
    expect(capture!.captured).toBe('pawn');
    expect(has(g, 'a0a3')).toBe(false); // a2 阻挡，不能越过
    expect(has(g, 'a0a4')).toBe(false); // 不能越过 a2 吃 a4
    // 初始局面：己方马挡住车的横走
    expect(has(XiangqiGame.initial(), 'a0b0')).toBe(false);
    expect(has(XiangqiGame.initial(), 'a0a1')).toBe(true);
  });

  it('兵/卒：只能前进；过河后可横走；永不后退', () => {
    const initial = XiangqiGame.initial();
    expect(has(initial, 'a3a4')).toBe(true);
    expect(has(initial, 'a3a2')).toBe(false); // 红兵不能后退
    expect(has(initial, 'a3b3')).toBe(false); // 未过河不能横走

    // 红兵 e6 已过河，可横走/前进，不能后退。
    const redCrossed = game('4k4/9/9/4P4/9/9/9/9/9/3K5 w - - 0 1');
    expect(has(redCrossed, 'e6e7')).toBe(true);
    expect(has(redCrossed, 'e6d6')).toBe(true);
    expect(has(redCrossed, 'e6e5')).toBe(false);
    expect(redCrossed.findLegalMove('e6d6')!.notation).toBe('兵五平六');

    // 黑卒 e4 已过河（黑方行棋）。
    const blackCrossed = game('4k4/9/9/9/9/4p4/9/9/9/3K5 b - - 0 1');
    expect(has(blackCrossed, 'e4e3')).toBe(true);
    expect(has(blackCrossed, 'e4e5')).toBe(false);
    expect(has(blackCrossed, 'e4d4')).toBe(true);
    expect(blackCrossed.findLegalMove('e4d4')!.notation).toBe('卒5平4');

    // 黑卒 e6 未过河，不能横走。
    const blackHome = game('4k4/9/9/4p4/9/9/9/9/9/3K5 b - - 0 1');
    expect(has(blackHome, 'e6e5')).toBe(true);
    expect(has(blackHome, 'e6d6')).toBe(false);
  });

  it('白脸将（将帅照面）：不能走出照面，也不能走成照面', () => {
    // 红车 e1 挡住双方将帅，离开 e 线即暴露照面，非法。
    const screen = game('4k4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1');
    expect(has(screen, 'e1a1')).toBe(false);
    expect(has(screen, 'e1d1')).toBe(false);
    expect(has(screen, 'e1e2')).toBe(true); // 仍在 e 线上，继续遮挡

    // 将帅不同线时安全；红帅走到 e 线形成照面则非法。
    const safe = game('4k4/9/9/9/9/9/9/9/9/3K5 w - - 0 1');
    expect(has(safe, 'd0e0')).toBe(false);
    expect(has(safe, 'd0d1')).toBe(true);
  });

  it('走子后不得使己方被将军（过滤自将）', () => {
    // 红帅 e0 正被 a0 黑车将军：只能 e0e1，不能仍在第 0 行。
    const inCheck = game('3k5/9/9/9/9/9/9/9/9/r3K4 w - - 0 1');
    expect(inCheck.checked).toBe(true);
    expect(inCheck.legalMoves()).toHaveLength(1);
    expect(inCheck.legalMoves()[0].ucci).toBe('e0e1');
    expect(has(inCheck, 'e0d0')).toBe(false);
    expect(has(inCheck, 'e0f0')).toBe(false);
  });

  it('牵制：离开牵制线会送将，因此被过滤', () => {
    // 红车 e1 被 e9 黑车牵制在红帅 e0 前，不能离开 e 线。
    const pinned = game('3kr4/9/9/9/9/9/9/9/4R4/4K4 w - - 0 1');
    expect(has(pinned, 'e1a1')).toBe(false);
    expect(has(pinned, 'e1e2')).toBe(true);
    expect(pinned.findLegalMove('e1e9')?.captured).toBe('rook'); // 沿牵制线吃子合法
  });

  it('checked 反映走子后的新走子方，且被将军方必须应将', () => {
    const g = game('4k4/9/9/9/9/9/9/9/4R4/3K5 w - - 0 1');
    expect(g.checked).toBe(false);
    g.apply('e1e2');
    expect(g.sideToMove).toBe('black');
    expect(g.checked).toBe(true);
    const replies = g.legalMoves();
    expect(replies).toHaveLength(1);
    expect(replies[0].ucci).toBe('e9f9'); // d9 会与红帅照面，e8 仍被车攻击
    g.apply('e9f9');
    expect(g.sideToMove).toBe('red');
    expect(g.checked).toBe(false);
  });
});

describe('将军检测', () => {
  it('马的将军检测包含马腿阻挡', () => {
    // 黑马 d2 将军红帅 e0（马腿 d1 空）。
    const checked = game('3k5/9/9/9/9/9/9/3n5/9/4K4 w - - 0 1');
    expect(checked.checked).toBe(true);
    // 红兵占 d1 塞住马腿后解除将军。
    const blocked = game('3k5/9/9/9/9/9/9/3n5/3P5/4K4 w - - 0 1');
    expect(blocked.checked).toBe(false);
  });

  it('炮的将军检测：需要恰好一个炮架', () => {
    // 黑炮 e7 隔着 e4 黑卒将军红帅 e0。
    const cannonCheck = game('3k5/9/4c4/9/9/4p4/9/9/9/4K4 w - - 0 1');
    expect(cannonCheck.checked).toBe(true);
    // 拿掉炮架后不再被将军。
    const noScreen = game('3k5/9/4c4/9/9/9/9/9/9/4K4 w - - 0 1');
    expect(noScreen.checked).toBe(false);
    // 两个炮架同样不构成将军。
    const twoScreens = game('3k5/9/4c4/9/9/4p4/4P4/9/9/4K4 w - - 0 1');
    expect(twoScreens.checked).toBe(false);
  });

  it('兵的将军检测：只能向前攻击；过河后才能侧向攻击', () => {
    // 黑卒 e1 向下攻击 e0 的红帅。
    const forward = game('3k5/9/9/9/9/9/9/9/4p4/4K4 w - - 0 1');
    expect(forward.checked).toBe(true);
    // 黑卒 d1 只攻击 c1/e1，不攻击 e0。
    const sidewaysNotForward = game('3k5/9/9/9/9/9/9/9/3p5/4K4 w - - 0 1');
    expect(sidewaysNotForward.checked).toBe(false);
    // 过河黑卒 e4 可以侧向攻击 e3/d4/f4，但不攻击 e0（不在其攻击范围内）。
    const farAway = game('3k5/9/9/9/9/4p4/9/9/9/4K4 w - - 0 1');
    expect(farAway.checked).toBe(false);
  });

  it('将帅照面本身视为被将军，必须离开该纵线', () => {
    const facing = game('4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1');
    expect(facing.checked).toBe(true);
    const moves = facing.legalMoves().map((move) => move.ucci);
    expect(moves).toContain('e0d0');
    expect(moves).toContain('e0f0');
    expect(moves).not.toContain('e0e1'); // 仍在 e 线，照面未解除
  });

  it('任何合法着法都不会吃掉对方将帅', () => {
    // 人为构造一个黑将可直接被吃的非法局面：引擎仍不得生成吃将着法。
    const illegalPosition = game('4k4/4R4/9/9/9/9/9/9/9/4K4 w - - 0 1');
    expect(illegalPosition.findLegalMove('e8e9')).toBeNull();
    for (const move of illegalPosition.legalMoves()) {
      expect(move.captured).not.toBe('king');
    }
  });
});
