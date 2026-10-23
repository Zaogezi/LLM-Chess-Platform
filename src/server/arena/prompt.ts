import type {
  PieceType,
  PieceView,
  Side,
  ThinkingLevel,
  ThinkingTier,
} from '../../shared/protocol';
import { DEFAULT_THINKING_LEVEL, thinkingTierOf } from '../../shared/protocol';
import { fenChar, otherSide, pieceName, sideName } from './labels';

export interface PromptMove {
  ucci: string;
  notation: string;
  piece: PieceType;
  side: Side;
  captured: PieceType | null;
}

export interface PromptContext {
  side: Side;
  fen: string;
  board: (PieceView | null)[];
  moveNumber: number;
  ply: number;
  checked: boolean;
  legalMoves: PromptMove[];
  recentMoves: Array<{ side: Side; ucci: string; notation: string }>;
}

interface ThinkingSpec {
  label: string;
  directive: string;
  reasonLimit: number;
  recentMoveLimit: number;
}

const THINKING_SPECS: Record<ThinkingTier, ThinkingSpec> = {
  quick: {
    label: '快速',
    directive:
      '追求效率：在心中快速筛选，优先选择稳健、直接、能立即改善局面的合法着法，不做长链推演，在有限等待时间内尽快落子。',
    reasonLimit: 30,
    recentMoveLimit: 6,
  },
  balanced: {
    label: '标准',
    directive:
      '稳健评估：比较数个候选着法，检查将军、吃子、子力安全与关键线路，再给出最终着法。',
    reasonLimit: 60,
    recentMoveLimit: 10,
  },
  deep: {
    label: '深思',
    directive:
      '深入计算：至少比较三个候选着法，逐一审视对方最强回应、己方子力是否受攻、将帅安全与后续手段，选择最有利的一步，并充分利用等待时限。',
    reasonLimit: 120,
    recentMoveLimit: 16,
  },
};

const START_CORRECTION_HINT =
  '若返回 Markdown、中文记谱或自然语言解释，均视为无效输出。';

function specFor(level: ThinkingLevel): ThinkingSpec {
  return THINKING_SPECS[thinkingTierOf(level)];
}

export function buildSystemPrompt(
  side: Side,
  thinkingLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL,
): string {
  const spec = specFor(thinkingLevel);
  return [
    '你是一位中国象棋顶尖棋手，正在参加一场双模型对弈。',
    `本局你执${sideName(side)}。每一步都必须从系统提供的当前局面与合法着法中选择。`,
    '',
    `【思考强度：${spec.label}】`,
    spec.directive,
    '不论思考多深，最终都只输出规定格式的 JSON，不展示内部推演过程。',
    '',
    '【坐标约定】',
    '使用 UCCI 坐标，由起点与终点拼接成四个字符，例如 h2e2。',
    '文件 a-i 从左到右；横排 0-9 从红方底线向黑方底线递增。',
    '「合法着法」列表由裁判程序生成，是唯一权威，绝不能输出列表之外的坐标。',
    '',
    '【输出格式】',
    '只输出一个 JSON 对象，不要 Markdown 代码块，不要任何额外文字：',
    `{"move":"<合法着法列表中的 UCCI>","reason":"<不超过${spec.reasonLimit}字的战略理由>"}`,
    'move 必须是 UCCI 坐标；reason 使用简洁中文，不要换行。',
    START_CORRECTION_HINT,
  ].join('\n');
}

function formatBoard(board: (PieceView | null)[]): string {
  const lines: string[] = ['     a b c d e f g h i'];
  for (let row = 9; row >= 0; row -= 1) {
    const cells: string[] = [];
    for (let col = 0; col < 9; col += 1) {
      const piece = board[row * 9 + col];
      cells.push(piece ? fenChar(piece) : '.');
    }
    lines.push(`  ${row}  ${cells.join(' ')}`);
  }
  lines.push('     （上方为黑方底线，下方为红方底线）');
  return lines.join('\n');
}

function formatLegalMoves(context: PromptContext): string {
  if (context.legalMoves.length === 0) return '（无合法着法）';
  return context.legalMoves
    .map((move) => {
      const capture = move.captured
        ? `（吃${pieceName(otherSide(context.side), move.captured)}）`
        : '';
      return `  - ${move.ucci}  ${move.notation}${capture}`;
    })
    .join('\n');
}

function formatRecentMoves(context: PromptContext, limit: number): string {
  const recent = context.recentMoves.slice(-limit);
  if (recent.length === 0) return '（尚未落子）';
  const firstPly = context.ply - recent.length + 1;
  return recent
    .map((move, index) => {
      const ply = firstPly + index;
      const turn = Math.floor((ply - 1) / 2) + 1;
      return `${turn}${move.side === 'red' ? '.' : '…'} ${sideName(move.side)} ${move.ucci}（${move.notation}）`;
    })
    .join('\n');
}

export function buildUserPrompt(
  context: PromptContext,
  thinkingLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL,
): string {
  const spec = specFor(thinkingLevel);
  return [
    `现在轮到${sideName(context.side)}走棋，第 ${context.moveNumber} 回合。`,
    `本回合思考强度：${spec.label}。`,
    `FEN：${context.fen}`,
    '',
    '当前棋盘（. 表示空位）',
    formatBoard(context.board),
    '',
    `将军状态：${context.checked ? `${sideName(context.side)}正被将军，必须先解除将军` : '当前未被将军'}`,
    '',
    '最近着法：',
    formatRecentMoves(context, spec.recentMoveLimit),
    '',
    `合法着法（共 ${context.legalMoves.length} 个，只能选其中一个）：`,
    formatLegalMoves(context),
    '',
    `请为${sideName(context.side)}落子。只输出 JSON：{"move":"<UCCI>","reason":"<不超过${spec.reasonLimit}字的战略理由>"}。`,
  ].join('\n');
}

export function buildCorrection(
  problem: string,
  legalMoves: PromptMove[],
  thinkingLevel: ThinkingLevel = DEFAULT_THINKING_LEVEL,
): string {
  const spec = specFor(thinkingLevel);
  const list = legalMoves.length
    ? legalMoves.map((move) => move.ucci).join('、')
    : '（无）';
  return [
    `你上一次的输出无效：${problem}`,
    '棋盘没有变化，仍然必须从合法着法中选择。',
    `合法着法：${list}`,
    '请重新只输出一个严格 JSON 对象，格式：',
    `{"move":"<合法着法列表中的 UCCI>","reason":"<不超过${spec.reasonLimit}字的理由>"}`,
    '不要包含 Markdown、代码围栏或任何解释文字。',
  ].join('\n');
}
