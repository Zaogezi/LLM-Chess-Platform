import { useMemo, useState } from 'react';
import type { HistoryGameRecord } from '../../../shared/protocol';
import { SIDE_LABEL } from '../../lib/chess';
import { buildReplayFrames } from '../../lib/replay';
import {
  HISTORY_MODE_LABELS,
  describeHistoryOutcome,
  formatHistoryChampionship,
  formatHistoryDateTime,
  formatHistoryDuration,
  formatHistoryTokens,
  formatHistoryTournament,
  historyPlayerMeta,
  historyPlayerThinking,
  historyResultReasonLabel,
  shortHistoryId,
} from '../../lib/history';
import { Spinner } from '../Icons';
import { AdminMovesTable } from './AdminMovesTable';
import { HistoryReplay } from './HistoryReplay';

interface AdminDetailPanelProps {
  detailId: string | null;
  detail: HistoryGameRecord | null;
  loading: boolean;
  error: string | null;
  pendingDelete: boolean;
  onClose: () => void;
  onRetry: () => void;
  onDelete: () => void;
}

interface AdminDetailContentProps {
  detail: HistoryGameRecord;
  pendingDelete: boolean;
  onDelete: () => void;
}

function AdminDetailContent({ detail, pendingDelete, onDelete }: AdminDetailContentProps) {
  const outcome = describeHistoryOutcome(detail);
  const frames = useMemo(() => {
    const next = buildReplayFrames(detail.moves);
    const last = next[next.length - 1];
    if (last) {
      last.result = detail.result ? { ...detail.result } : null;
    }
    return next;
  }, [detail.moves, detail.result]);
  const [replayStep, setReplayStep] = useState(() => Math.max(0, detail.moves.length));

  return (
    <div className="admin-detail__content">
      <section className={`admin-detail__outcome admin-outcome--${outcome.tone}`} aria-label="对局结果">
        <div className="admin-detail__outcome-head">
          <strong>{outcome.label}</strong>
          <span className={`admin-source admin-source--${detail.mode}`}>
            {HISTORY_MODE_LABELS[detail.mode]}
          </span>
          <span className="admin-detail__record-id" title={detail.id}>
            {shortHistoryId(detail.id, 10)}
          </span>
        </div>
        <p>{detail.result?.text ?? (detail.status === 'failed' ? '对局未能正常结束' : outcome.detail)}</p>
        <span className="admin-detail__when">{formatHistoryDateTime(detail.endedAt)}</span>
      </section>

      {detail.error && (
        <div className="admin-alert admin-alert--error" role="status">
          <span>{detail.error}</span>
        </div>
      )}

      {detail.tournament && (
        <div className="admin-tournament-ref">
          <span className="admin-source admin-source--tournament">自动评测</span>
          <span>{formatHistoryTournament(detail.tournament)}</span>
          <span
            className="admin-tournament-ref__id"
            title={detail.tournament.tournamentId}
          >
            赛事 {shortHistoryId(detail.tournament.tournamentId, 8)}
          </span>
        </div>
      )}

      {detail.championship && (
        <div className="admin-tournament-ref admin-championship-ref">
          <span className="admin-source admin-source--championship">
            {detail.championship.stage === 'qualifier' ? '入围赛' : '锦标赛'}
          </span>
          <span>{formatHistoryChampionship(detail.championship)}</span>
          <span
            className="admin-tournament-ref__id"
            title={detail.championship.championshipId}
          >
            {detail.championship.stage === 'qualifier' ? '入围赛' : '届次'}{' '}
            {shortHistoryId(detail.championship.championshipId, 8)}
          </span>
        </div>
      )}

      <HistoryReplay
        record={detail}
        frames={frames}
        step={replayStep}
        onStepChange={setReplayStep}
      />

      <div className="admin-players">
        {(['red', 'black'] as const).map((side) => {
          const player = detail[side];
          const isWinner = detail.winnerSide === side;
          const isFailed = detail.failedSide === side;
          const sideTokens =
            side === 'red'
              ? formatHistoryTokens(detail.redTokensIn, detail.redTokensOut)
              : formatHistoryTokens(detail.blackTokensIn, detail.blackTokensOut);

          return (
            <article
              key={side}
              className={`admin-player admin-player--${side}${
                isWinner ? ' is-winner' : ''
              }${isFailed ? ' is-failed' : ''}`}
            >
              <div className="admin-player__head">
                <span className={`side-seal side-seal--${side}`} aria-hidden="true">
                  {side === 'red' ? '红' : '黑'}
                </span>
                <div className="admin-player__names">
                  <h3>
                    {side === 'red' ? '红方' : '黑方'} · {player.name}
                  </h3>
                  <p>{historyPlayerMeta(player)}</p>
                </div>
                {isWinner && (
                  <span className="admin-player__badge admin-player__badge--winner">胜</span>
                )}
                {isFailed && (
                  <span className="admin-player__badge admin-player__badge--failed">异常</span>
                )}
              </div>
              <div className="admin-player__meta">
                <span className="thinking-badge">{historyPlayerThinking(player)}</span>
                <span className="admin-player__tokens">Token {sideTokens}</span>
              </div>
            </article>
          );
        })}
      </div>

      <dl className="admin-facts">
        <div>
          <dt>开始时间</dt>
          <dd>{formatHistoryDateTime(detail.startedAt)}</dd>
        </div>
        <div>
          <dt>结束时间</dt>
          <dd>{formatHistoryDateTime(detail.endedAt)}</dd>
        </div>
        <div>
          <dt>对局用时</dt>
          <dd>{formatHistoryDuration(detail.durationMs)}</dd>
        </div>
        <div>
          <dt>总手数</dt>
          <dd>{detail.plies} 手</dd>
        </div>
        <div>
          <dt>结果原因</dt>
          <dd>{historyResultReasonLabel(detail.result?.reason)}</dd>
        </div>
        <div>
          <dt>总 Token</dt>
          <dd>{formatHistoryTokens(detail.tokensIn, detail.tokensOut)}</dd>
        </div>
        {detail.failedSide && (
          <div>
            <dt>异常一方</dt>
            <dd>
              {SIDE_LABEL[detail.failedSide]} · {detail[detail.failedSide].name}
            </dd>
          </div>
        )}
        <div className="admin-facts__wide">
          <dt>档案编号</dt>
          <dd title={detail.id}>{detail.id}</dd>
        </div>
      </dl>

      <AdminMovesTable
        moves={detail.moves}
        selectedPly={replayStep}
        onSelectPly={setReplayStep}
      />

      <div className="admin-detail__actions">
        <button
          type="button"
          className="btn btn--danger btn--compact"
          onClick={onDelete}
          disabled={pendingDelete}
          aria-busy={pendingDelete}
        >
          {pendingDelete ? (
            <>
              <Spinner />
              删除中…
            </>
          ) : (
            '删除此档案'
          )}
        </button>
      </div>
    </div>
  );
}

export function AdminDetailPanel({
  detailId,
  detail,
  loading,
  error,
  pendingDelete,
  onClose,
  onRetry,
  onDelete,
}: AdminDetailPanelProps) {
  return (
    <aside
      className={`panel admin-detail${detailId ? ' is-open' : ''}`}
      aria-label="历史对局详情"
      aria-busy={loading}
    >
      <div className="admin-detail__head">
        <h2 className="admin-detail__title">对局详情</h2>
        <button
          type="button"
          className="admin-detail__close"
          onClick={onClose}
          disabled={!detailId}
          aria-label="关闭对局详情"
        >
          ×
        </button>
      </div>

      {!detailId && (
        <div className="admin-detail__placeholder">
          <span className="admin-detail__seal" aria-hidden="true">
            档
          </span>
          <p>选择对局</p>
        </div>
      )}

      {detailId && loading && (
        <div className="admin-detail__loading" role="status">
          <Spinner />
        </div>
      )}

      {detailId && !loading && error && (
        <div className="admin-detail__error">
          <div className="admin-alert admin-alert--error" role="alert">
            <span>{error}</span>
          </div>
          <button type="button" className="btn btn--secondary btn--compact" onClick={onRetry}>
            重新加载
          </button>
        </div>
      )}

      {detailId && !loading && !error && detail && (
        <AdminDetailContent
          key={detail.id}
          detail={detail}
          pendingDelete={pendingDelete}
          onDelete={onDelete}
        />
      )}
    </aside>
  );
}
