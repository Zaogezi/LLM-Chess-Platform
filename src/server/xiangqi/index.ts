/**
 * Xiangqi rules engine — public entry point.
 *
 * Import from `src/server/xiangqi` (or `./xiangqi/index.js` at runtime):
 *
 *   import { XiangqiGame, IllegalMoveError } from './xiangqi/index.js';
 *   import type { EngineMove, GameOutcome } from './xiangqi/index.js';
 */

export { XiangqiGame } from './game';
export { IllegalMoveError } from './types';
export type { EngineMove, GameOutcome, IllegalMoveCode } from './types';
export {
  START_FEN,
  MAX_PLIES,
  NO_PROGRESS_PLIES,
  REPETITION_LIMIT,
  SIDE_LABELS,
  PIECE_CHARS,
} from './constants';
export { chinesePieceGlyph, chineseNotation } from './notation';
export { parseFen, serializeFen } from './fen';
export { isDeadPosition, hasAttackingMaterial } from './rules';
export { parseUcciMove, canonicalUcci, squareName } from './square';
