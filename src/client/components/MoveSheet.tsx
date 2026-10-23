import { useEffect, useMemo, useRef } from 'react';
import type { ArenaState, MoveView, Side } from '../../shared/protocol';
import { formatLatency } from '../lib/format';

interface ScoreRow {
  no: number;
  red?: MoveView;
  black?: MoveView;
}

function buildRows(moves: readonly MoveView[]): ScoreRow[] {
  const rows: ScoreRow[] = [];

  for (const move of moves) {
    const last = rows.length > 0 ? rows[rows.length - 1] : undefined;
    if (move.side === 'black' && last && !last.black) {
      last.black = move;
      continue;
    }

    const row: ScoreRow = { no: rows.length + 1 };
    if (move.side === 'red') {
      row.red = move;
    } else {
      row.black = move;
    }
    rows.push(row);
  }

  return rows;
}

interface MoveCellProps {
  move?: MoveView;
  side: Side;
  lastPly: number | null;
}

function MoveCell({ move, side, lastPly }: MoveCellProps) {
  if (!move) {
    return (
      <td className={`score-cell score-cell--${side} score-cell--empty`}>
        <span className="score-placeholder" aria-hidden="true">
          —
        </span>
      </td>
    );
  }

  const tooltip = [
    `落子理由：${move.reason.trim().length > 0 ? move.reason : '未提供'}`,
    `用时：${formatLatency(move.latencyMs)}`,
    `Token：↑${move.tokensIn} ↓${move.tokensOut}`,
    `UCCI：${move.ucci}`,
  ].join('\n');

  return (
    <td
      className={`score-cell score-cell--${side}${move.ply === lastPly ? ' is-last' : ''}`}
      title={tooltip}
    >
      <span className="score-notation">{move.notation}</span>
      <span className="score-ucci">{move.ucci}</span>
    </td>
  );
}

export function MoveSheet({ state }: { state: ArenaState | null }) {
  const moves = state?.moves ?? [];
  const result = state?.result ?? null;
  const rows = useMemo(() => buildRows(moves), [moves]);
  const lastPly = moves.length > 0 ? moves[moves.length - 1].ply : null;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({
      top: element.scrollHeight,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [moves.length, result?.text]);

  return (
    <section className="panel move-sheet" aria-label="棋谱">
      <div className="panel__head">
        <h2 className="panel__title">棋谱</h2>
        <span className="move-sheet__meta">
          {moves.length > 0 ? `${moves.length} 手` : '—'}
        </span>
      </div>

      {moves.length === 0 ? (
        <div className="score-empty">
          <span className="score-empty__seal" aria-hidden="true">
            弈
          </span>
          <p>尚无棋谱</p>
        </div>
      ) : (
        <div
          className="score-scroll"
          ref={scrollRef}
          tabIndex={0}
          role="region"
          aria-label="棋谱列表，可滚动查看"
        >
          <table className="score-table">
            <caption className="sr-only">中国象棋棋谱</caption>
            <thead>
              <tr>
                <th scope="col">回合</th>
                <th scope="col">红方</th>
                <th scope="col">黑方</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.no}>
                  <td className="score-num">{row.no}</td>
                  <MoveCell move={row.red} side="red" lastPly={lastPly} />
                  <MoveCell move={row.black} side="black" lastPly={lastPly} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
