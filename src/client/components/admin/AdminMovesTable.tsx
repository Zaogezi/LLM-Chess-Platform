import type { MoveView } from '../../../shared/protocol';
import { formatLatency } from '../../lib/format';
import { formatHistoryTokens } from '../../lib/history';

interface AdminMovesTableProps {
  moves: MoveView[];
  /** Ply currently shown on the replay board, if any. */
  selectedPly?: number | null;
  onSelectPly?: (ply: number) => void;
}

export function AdminMovesTable({
  moves,
  selectedPly = null,
  onSelectPly,
}: AdminMovesTableProps) {
  if (moves.length === 0) {
    return (
      <div className="admin-moves">
        <div className="admin-moves__head">
          <h3>棋谱</h3>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-moves">
      <div className="admin-moves__head">
        <h3>棋谱</h3>
        <span>{moves.length} 手</span>
      </div>

      <div
        className="admin-moves__scroll"
        tabIndex={0}
        role="region"
        aria-label="完整棋谱，可滚动查看"
      >
        <table className="admin-moves-table">
          <caption className="sr-only">完整棋谱</caption>
          <thead>
            <tr>
              <th scope="col">手</th>
              <th scope="col">方</th>
              <th scope="col">UCCI</th>
              <th scope="col">中文记谱</th>
              <th scope="col">用时</th>
              <th scope="col">Token</th>
              <th scope="col">理由</th>
            </tr>
          </thead>
          <tbody>
            {moves.map((move) => (
              <tr
                key={`${move.ply}-${move.ucci}`}
                className={`${selectedPly === move.ply ? 'is-replay-current' : ''}${
                  onSelectPly ? ' is-clickable' : ''
                }`}
                tabIndex={onSelectPly ? 0 : undefined}
                title={onSelectPly ? '点击回放到这一手' : undefined}
                onClick={onSelectPly ? () => onSelectPly(move.ply) : undefined}
                onKeyDown={
                  onSelectPly
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onSelectPly(move.ply);
                        }
                      }
                    : undefined
                }
              >
                <td className="admin-moves__ply">{move.ply}</td>
                <td>
                  <span className={`admin-side admin-side--${move.side}`}>
                    <span className={`mini-seal mini-seal--${move.side}`} aria-hidden="true">
                      {move.side === 'red' ? '红' : '黑'}
                    </span>
                    {move.side === 'red' ? '红方' : '黑方'}
                  </span>
                </td>
                <td className="admin-moves__ucci">{move.ucci}</td>
                <td className="admin-moves__notation">{move.notation}</td>
                <td className="admin-moves__latency">{formatLatency(move.latencyMs)}</td>
                <td
                  className="admin-moves__tokens"
                  title={`输入 ${move.tokensIn} / 输出 ${move.tokensOut}`}
                >
                  {formatHistoryTokens(move.tokensIn, move.tokensOut)}
                </td>
                <td className="admin-moves__reason" title={move.reason || '未提供理由'}>
                  {move.reason.trim() || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
