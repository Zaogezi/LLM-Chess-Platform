import type { PieceType, ProviderKind, Side } from '../../shared/protocol';

export const SIDE_NAMES: Record<Side, string> = {
  red: '红方',
  black: '黑方',
};

export const PIECE_NAMES: Record<Side, Record<PieceType, string>> = {
  red: {
    king: '帅',
    advisor: '仕',
    elephant: '相',
    horse: '马',
    rook: '车',
    cannon: '炮',
    pawn: '兵',
  },
  black: {
    king: '将',
    advisor: '士',
    elephant: '象',
    horse: '马',
    rook: '车',
    cannon: '炮',
    pawn: '卒',
  },
};

export const PIECE_FEN_CHARS: Record<Side, Record<PieceType, string>> = {
  red: {
    king: 'K',
    advisor: 'A',
    elephant: 'B',
    horse: 'N',
    rook: 'R',
    cannon: 'C',
    pawn: 'P',
  },
  black: {
    king: 'k',
    advisor: 'a',
    elephant: 'b',
    horse: 'n',
    rook: 'r',
    cannon: 'c',
    pawn: 'p',
  },
};

export const PROVIDER_NAMES: Record<ProviderKind, string> = {
  openai: 'OpenAI 兼容',
  anthropic: 'Anthropic',
};

export function sideName(side: Side): string {
  return SIDE_NAMES[side];
}

export function otherSide(side: Side): Side {
  return side === 'red' ? 'black' : 'red';
}

export function pieceName(side: Side, type: PieceType): string {
  return PIECE_NAMES[side][type];
}

export function fenChar(piece: { side: Side; type: PieceType }): string {
  return PIECE_FEN_CHARS[piece.side][piece.type];
}
