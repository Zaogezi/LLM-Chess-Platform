import { useMemo } from 'react';
import type { ModelView, Phase, PieceView, Side } from '../../shared/protocol';
import { useNow } from '../hooks/useNow';
import {
  SIDE_DUTY,
  SIDE_LABEL,
  SIDE_SEAL,
  capturedPieces,
  otherSide,
} from '../lib/chess';
import {
  formatDuration,
  formatLatency,
  formatTokenCount,
} from '../lib/format';
import { CapturedTray } from './CapturedTray';

interface PlayerPlaqueProps {
  side: Side;
  phase: Phase;
  model: ModelView | null;
  fallbackName: string;
  /** Overrides the board's internal display name, e.g. a tournament entrant. */
  nameOverride?: string;
  isTurn: boolean;
  isWinner: boolean;
  board: readonly (PieceView | null)[] | null;
}

export function PlayerPlaque({
  side,
  phase,
  model,
  fallbackName,
  nameOverride,
  isTurn,
  isWinner,
  board,
}: PlayerPlaqueProps) {
  const thinking = model?.thinking ?? false;
  const now = useNow(250, thinking);
  const thinkingMs =
    thinking && typeof model?.thinkingSince === 'number'
      ? Math.max(0, now - model.thinkingSince)
      : null;

  const displayName = nameOverride ?? model?.displayName ?? fallbackName;
  const lastError = model?.lastError ?? null;
  const latency = model?.lastLatencyMs ?? null;
  const attempts = model?.attempts ?? 0;
  const tokensIn = model?.totalTokensIn ?? 0;
  const tokensOut = model?.totalTokensOut ?? 0;
  const hasTokens = tokensIn + tokensOut > 0;

  const captured = useMemo(
    () => (board ? capturedPieces(board, otherSide(side)) : []),
    [board, side],
  );

  let statusLabel = '待开局';
  if (phase === 'idle') {
    statusLabel = '待开局';
  } else if (phase === 'finished') {
    statusLabel = isWinner ? '胜' : '终局';
  } else if (thinking) {
    statusLabel = '思考中';
  } else if (phase === 'paused') {
    statusLabel = '暂停';
  } else if (phase === 'error') {
    statusLabel = '异常';
  } else if (isTurn) {
    statusLabel = '行棋中';
  } else {
    statusLabel = '观战';
  }

  return (
    <section
      className={`player-plaque player-plaque--${side}${isTurn ? ' is-turn' : ''}${
        isWinner ? ' is-winner' : ''
      }${lastError ? ' has-error' : ''}`}
      aria-label={`${SIDE_LABEL[side]}，${displayName}，${statusLabel}`}
    >
      {isWinner && (
        <span className="plaque__win-seal" aria-hidden="true">
          胜
        </span>
      )}

      <div className="plaque__identity">
        <span className={`side-seal side-seal--${side}`} aria-hidden="true">
          {SIDE_SEAL[side]}
        </span>
        <div className="plaque__names">
          <span className="plaque__side">
            {SIDE_LABEL[side]}
            <span className="plaque__duty">· {SIDE_DUTY[side]}</span>
          </span>
          <span className="plaque__model" title={displayName}>
            {displayName}
          </span>
        </div>
      </div>

      <div className="plaque__status">
        <div className="plaque__state">
          <span
            className={`thinking-dot${thinking ? ' is-active' : ''}${
              lastError ? ' has-error' : ''
            }`}
            aria-hidden="true"
          />
          <span>{statusLabel}</span>
          {thinkingMs !== null && (
            <span className="plaque__timer">{formatDuration(thinkingMs)}</span>
          )}
        </div>

        {thinkingMs !== null && (
          <span className="plaque__timer">{formatDuration(thinkingMs)}</span>
        )}

        <div className="plaque__meta">
          {latency !== null && <span>{formatLatency(latency)}</span>}
          {hasTokens && (
            <span>
              ↑{formatTokenCount(tokensIn)} ↓{formatTokenCount(tokensOut)}
            </span>
          )}
          {attempts > 0 && <span>尝试 {attempts}</span>}
          {lastError && phase !== 'error' && (
            <span className="plaque__error" title={lastError}>
              异常
            </span>
          )}
        </div>
      </div>

      {captured.length > 0 && (
        <div className="plaque__captured">
          <CapturedTray owner={side} groups={captured} />
        </div>
      )}
    </section>
  );
}
