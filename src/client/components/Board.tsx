import { useEffect, useMemo, useRef, useState } from 'react';
import type { PieceView } from '../../shared/protocol';
import type { BoardViewState } from '../lib/chess';
import {
  BOARD_LAYOUT,
  PIECE_GLYPH,
  describeArena,
  findKingIndex,
  indexToRowCol,
  parseUcciSquare,
  squareToPercent,
} from '../lib/chess';

const { cell, cols, height, marginX, marginY, rows, width } = BOARD_LAYOUT;

const gridX = (col: number) => marginX + col * cell;
const gridY = (row: number) => marginY + (rows - 1 - row) * cell;

const FILE_LABELS: readonly string[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
const RANK_LABELS: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Classic cannon + pawn position brackets (internal row coordinates). */
const POSITION_MARKS: ReadonlyArray<{ row: number; col: number }> = [
  { row: 7, col: 1 },
  { row: 7, col: 7 },
  { row: 2, col: 1 },
  { row: 2, col: 7 },
  { row: 6, col: 0 },
  { row: 6, col: 2 },
  { row: 6, col: 4 },
  { row: 6, col: 6 },
  { row: 6, col: 8 },
  { row: 3, col: 0 },
  { row: 3, col: 2 },
  { row: 3, col: 4 },
  { row: 3, col: 6 },
  { row: 3, col: 8 },
];

function markPathsFor(row: number, col: number): string[] {
  const x = gridX(col);
  const y = gridY(row);
  const gap = 5;
  const length = 8;
  const horizontalDirections = col <= 0 ? [1] : col >= cols - 1 ? [-1] : [-1, 1];
  const paths: string[] = [];

  for (const dx of horizontalDirections) {
    for (const dy of [-1, 1]) {
      const sx = x + dx * gap;
      const sy = y + dy * gap;
      paths.push(
        `M ${sx} ${sy + dy * length} L ${sx} ${sy} L ${sx + dx * length} ${sy}`,
      );
    }
  }

  return paths;
}

function MoveMarkers({ lastMove }: { lastMove: BoardViewState['lastMove'] }) {
  if (!lastMove) {
    return null;
  }

  const from = parseUcciSquare(lastMove.fromUcci);
  const to = parseUcciSquare(lastMove.toUcci);
  if (!from || !to) {
    return null;
  }

  return (
    <g
      className={`board-marker board-marker--${lastMove.side}`}
      aria-hidden="true"
    >
      <circle
        className="board-marker__from"
        cx={gridX(from.col)}
        cy={gridY(from.row)}
        r={6.5}
      />
      <circle
        className="board-marker__to"
        cx={gridX(to.col)}
        cy={gridY(to.row)}
        r={31}
      />
    </g>
  );
}

export function BoardLines({ lastMove = null }: { lastMove?: BoardViewState['lastMove'] }) {
  const riverTop = gridY(5);

  return (
    <svg
      className="board-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="board-river-wash" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff6dc" stopOpacity="0.34" />
          <stop offset="48%" stopColor="#fff3d4" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#c79a5c" stopOpacity="0.18" />
        </linearGradient>
      </defs>

      <rect
        x={marginX}
        y={riverTop}
        width={width - marginX * 2}
        height={cell}
        fill="url(#board-river-wash)"
      />

      <rect
        className="board-inset"
        x={16}
        y={16}
        width={width - 32}
        height={height - 32}
        rx={3}
      />

      {RANK_LABELS.map((row) => (
        <line
          key={`h-${row}`}
          className="board-line"
          x1={gridX(0)}
          y1={gridY(row)}
          x2={gridX(8)}
          y2={gridY(row)}
        />
      ))}

      {Array.from({ length: cols }, (_, col) => {
        const x = gridX(col);
        if (col === 0 || col === cols - 1) {
          return (
            <line
              key={`v-${col}`}
              className="board-line"
              x1={x}
              y1={gridY(rows - 1)}
              x2={x}
              y2={gridY(0)}
            />
          );
        }
        return (
          <g key={`v-${col}`}>
            <line
              className="board-line"
              x1={x}
              y1={gridY(rows - 1)}
              x2={x}
              y2={gridY(5)}
            />
            <line className="board-line" x1={x} y1={gridY(4)} x2={x} y2={gridY(0)} />
          </g>
        );
      })}

      <rect
        className="board-border"
        x={gridX(0)}
        y={gridY(rows - 1)}
        width={gridX(8) - gridX(0)}
        height={gridY(0) - gridY(rows - 1)}
      />

      {/* 九宫 diagonals: black palace above, red palace below. */}
      <g className="board-line board-line--palace">
        <line x1={gridX(3)} y1={gridY(9)} x2={gridX(5)} y2={gridY(7)} />
        <line x1={gridX(3)} y1={gridY(7)} x2={gridX(5)} y2={gridY(9)} />
        <line x1={gridX(3)} y1={gridY(2)} x2={gridX(5)} y2={gridY(0)} />
        <line x1={gridX(3)} y1={gridY(0)} x2={gridX(5)} y2={gridY(2)} />
      </g>

      <g aria-hidden="true">
        {POSITION_MARKS.map(({ row, col }, index) =>
          markPathsFor(row, col).map((path, pathIndex) => (
            <path
              key={`mark-${index}-${pathIndex}`}
              className="board-mark"
              d={path}
            />
          )),
        )}
      </g>

      <text
        className="board-river-text"
        x={gridX(2)}
        y={gridY(5) + 42}
        textAnchor="middle"
        letterSpacing={10}
      >
        楚河
      </text>
      <text
        className="board-river-text"
        x={gridX(6)}
        y={gridY(5) + 42}
        textAnchor="middle"
        letterSpacing={10}
      >
        汉界
      </text>

      <path
        className="board-river-seal"
        d="M 300 322 L 310 332 L 300 342 L 290 332 Z"
        aria-hidden="true"
      />
      <circle className="board-river-dot" cx={300} cy={332} r={1.4} aria-hidden="true" />

      <MoveMarkers lastMove={lastMove} />

      {FILE_LABELS.map((file, col) => (
        <text
          key={file}
          className="board-coord"
          x={gridX(col)}
          y={642}
          textAnchor="middle"
        >
          {file}
        </text>
      ))}
      {RANK_LABELS.map((row) => (
        <text
          key={`rank-${row}`}
          className="board-coord"
          x={29}
          y={gridY(row) + 3}
          textAnchor="middle"
        >
          {row}
        </text>
      ))}
    </svg>
  );
}

interface BoardPieceProps {
  piece: PieceView;
  left: string;
  top: string;
  row: number;
  checked: boolean;
}

function BoardPiece({ piece, left, top, row, checked }: BoardPieceProps) {
  return (
    <div
      className={`piece piece--${piece.side}${checked ? ' is-checked' : ''}`}
      style={{ left, top, zIndex: 20 + row }}
    >
      <span className="piece__glyph">{PIECE_GLYPH[piece.side][piece.type]}</span>
    </div>
  );
}

export function Board({ state }: { state: BoardViewState }) {
  const { board, checked, lastMove, moves, phase, ply, turn } = state;

  const checkedKingIndex = useMemo(
    () => (checked ? findKingIndex(board, turn) : null),
    [board, checked, turn],
  );
  const checkedKingId =
    checkedKingIndex !== null ? (board[checkedKingIndex]?.id ?? null) : null;

  const [captureFlash, setCaptureFlash] = useState<{
    key: number;
    left: string;
    top: string;
  } | null>(null);
  const previousPly = useRef(ply);

  useEffect(() => {
    if (ply > previousPly.current) {
      const latest = moves.length > 0 ? moves[moves.length - 1] : null;
      if (latest && latest.capturedLabel && lastMove) {
        const target = parseUcciSquare(lastMove.toUcci);
        if (target) {
          const position = squareToPercent(target.row, target.col);
          setCaptureFlash({ key: ply, ...position });
        }
      }
    }
    previousPly.current = ply;
  }, [lastMove, moves, ply]);

  useEffect(() => {
    if (!captureFlash) {
      return;
    }
    const timer = window.setTimeout(() => setCaptureFlash(null), 720);
    return () => window.clearTimeout(timer);
  }, [captureFlash]);

  return (
    <div className="board-frame">
      <div
        className="board-stage"
        role="img"
        aria-label={describeArena(state)}
        data-phase={phase}
      >
        <BoardLines lastMove={lastMove} />

        <div className="board-layer">
          {captureFlash && (
            <span
              key={captureFlash.key}
              className="capture-flash"
              style={{ left: captureFlash.left, top: captureFlash.top }}
              aria-hidden="true"
            />
          )}

          {board.map((piece, index) => {
            if (!piece) {
              return null;
            }
            const { row, col } = indexToRowCol(index);
            const position = squareToPercent(row, col);
            return (
              <BoardPiece
                key={piece.id}
                piece={piece}
                row={row}
                left={position.left}
                top={position.top}
                checked={piece.id === checkedKingId}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface BoardPlaceholderProps {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export function BoardPlaceholder({ loading, error, onRetry }: BoardPlaceholderProps) {
  return (
    <div className="board-frame">
      <div
        className={`board-stage board-stage--placeholder${loading ? ' is-loading' : ''}`}
        role="status"
        aria-live="polite"
      >
        <BoardLines />
        <div className="board-placeholder">
          <span className="board-placeholder__seal" aria-hidden="true">
            弈
          </span>
          <p className="board-placeholder__title">
            {loading ? '正在连接…' : '服务未就绪'}
          </p>
          {!loading && (
            <>
              {error && <p className="board-placeholder__hint">{error}</p>}
              <button
                type="button"
                className="btn btn--secondary btn--compact"
                onClick={onRetry}
              >
                重连
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
