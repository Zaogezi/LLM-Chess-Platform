import { describe, expect, it } from 'vitest';
import type { PieceView } from '../../shared/protocol';
import {
  buildCorrection,
  buildSystemPrompt,
  buildUserPrompt,
  type PromptContext,
  type PromptMove,
} from './prompt';

function emptyBoard(): (PieceView | null)[] {
  return Array.from({ length: 90 }, () => null);
}

const redKing: PieceView = { id: 'red-king', side: 'red', type: 'king' };
const blackKing: PieceView = { id: 'black-king', side: 'black', type: 'king' };
const redRook: PieceView = { id: 'red-rook', side: 'red', type: 'rook' };
const blackHorse: PieceView = { id: 'black-horse', side: 'black', type: 'horse' };

const legalMoves: PromptMove[] = [
  { ucci: 'h2e2', notation: '炮二平五', piece: 'cannon', side: 'red', captured: null },
  { ucci: 'h2h9', notation: '炮二进七', piece: 'cannon', side: 'red', captured: 'horse' },
];

function context(): PromptContext {
  const board = emptyBoard();
  board[4] = redKing; // e0
  board[85] = blackKing; // e9
  board[0] = redRook; // a0
  board[89] = blackHorse; // i9
  return {
    side: 'red',
    fen: '4k4/9/9/9/9/9/9/9/9/R3K4 w - - 0 1',
    board,
    moveNumber: 1,
    ply: 0,
    checked: false,
    legalMoves,
    recentMoves: [],
  };
}

describe('prompt building', () => {
  it('describes the side, UCCI contract and JSON output', () => {
    const system = buildSystemPrompt('black');
    expect(system).toContain('你执黑方');
    expect(system).toContain('h2e2');
    expect(system).toContain('{"move"');
    expect(system).toContain('合法着法');
  });

  it('prints a top-to-bottom board with FEN chars and file header', () => {
    const prompt = buildUserPrompt(context());
    expect(prompt).toContain('FEN：4k4/9/9/9/9/9/9/9/9/R3K4 w - - 0 1');
    expect(prompt).toContain('a b c d e f g h i');
    expect(prompt).toContain('9  . . . . k . . . n');
    expect(prompt).toContain('0  R . . . K . . . .');
    expect(prompt).toContain('当前未被将军');
    expect(prompt).toContain('h2e2  炮二平五');
    expect(prompt).toContain('h2h9  炮二进七（吃马）');
    expect(prompt).toContain('共 2 个');
    expect(prompt).toContain('尚未落子');
  });

  it('marks check and recent moves', () => {
    const ctx = context();
    ctx.checked = true;
    ctx.ply = 2;
    ctx.moveNumber = 2;
    ctx.recentMoves = [
      { side: 'red', ucci: 'h2e2', notation: '炮二平五' },
      { side: 'black', ucci: 'h9g7', notation: '马8进7' },
    ];
    const prompt = buildUserPrompt(ctx);
    expect(prompt).toContain('红方正被将军，必须先解除将军');
    expect(prompt).toContain('红方 h2e2（炮二平五）');
    expect(prompt).toContain('黑方 h9g7（马8进7）');
  });

  it('builds a correction with the authoritative move list', () => {
    const correction = buildCorrection('着法无效', legalMoves);
    expect(correction).toContain('着法无效');
    expect(correction).toContain('h2e2');
    expect(correction).toContain('h2h9');
    expect(correction).toContain('只输出一个严格 JSON 对象');
  });

  it('varies guidance, recent-move context and reason limits by thinking level', () => {
    const quick = buildSystemPrompt('red', 'quick');
    const balanced = buildSystemPrompt('red', 'balanced');
    const deep = buildSystemPrompt('red', 'deep');

    expect(quick).toContain('【思考强度：快速】');
    expect(quick).toContain('不超过30字');
    expect(quick).toContain('不做长链推演');
    expect(balanced).toContain('【思考强度：标准】');
    expect(balanced).toContain('不超过60字');
    expect(deep).toContain('【思考强度：深思】');
    expect(deep).toContain('不超过120字');
    expect(deep).toContain('至少比较三个候选着法');

    const quickPrompt = buildUserPrompt(context(), 'quick');
    expect(quickPrompt).toContain('本回合思考强度：快速');
    expect(quickPrompt).toContain('不超过30字');

    const deepCorrection = buildCorrection('着法无效', legalMoves, 'deep');
    expect(deepCorrection).toContain('不超过120字');
  });

  it('keeps more history for deep thinking than quick thinking', () => {
    const ctx = context();
    ctx.ply = 20;
    ctx.recentMoves = Array.from({ length: 20 }, (_, index) => ({
      side: index % 2 === 0 ? ('red' as const) : ('black' as const),
      ucci: 'h2e2',
      notation: `第${index + 1}步`,
    }));

    const quick = buildUserPrompt(ctx, 'quick');
    const deep = buildUserPrompt(ctx, 'deep');
    expect(quick).not.toContain('第14步');
    expect(quick).toContain('第15步');
    expect(deep).toContain('第5步');
    expect(deep).not.toContain('第4步');
  });
});
