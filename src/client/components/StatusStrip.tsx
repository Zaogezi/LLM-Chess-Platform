import type { ArenaState } from '../../shared/protocol';
import { useNow } from '../hooks/useNow';
import { SIDE_LABEL, SIDE_SEAL } from '../lib/chess';
import { formatLatency, formatStopwatch } from '../lib/format';

/** Slim operational strip: turn, thinking clock, ply, attempts, last move. */
export function StatusStrip({ state }: { state: ArenaState | null }) {
  const turn = state?.turn ?? null;
  const currentModel = state && turn ? state.models[turn] : null;
  const thinking = currentModel?.thinking ?? false;
  const now = useNow(300, thinking);

  const thinkingMs =
    thinking && typeof currentModel?.thinkingSince === 'number'
      ? Math.max(0, now - currentModel.thinkingSince)
      : null;

  const lastMove =
    state && state.moves.length > 0 ? state.moves[state.moves.length - 1] : null;

  const lastError =
    state?.error?.message ??
    currentModel?.lastError ??
    state?.models.red?.lastError ??
    state?.models.black?.lastError ??
    null;

  return (
    <section className="live-strip" aria-label="实时观战">
      <div className="live-strip__items">
        <div className="live-strip__item">
          <span>行棋</span>
          <strong>
            {turn ? (
              <>
                <span className={`mini-seal mini-seal--${turn}`} aria-hidden="true">
                  {SIDE_SEAL[turn]}
                </span>
                {SIDE_LABEL[turn]}
              </>
            ) : (
              '—'
            )}
          </strong>
        </div>
        <div className="live-strip__item">
          <span>沉思</span>
          <strong>{thinkingMs !== null ? formatStopwatch(thinkingMs) : '—'}</strong>
        </div>
        <div className="live-strip__item">
          <span>手数</span>
          <strong>{state?.ply ?? 0}</strong>
        </div>
        <div className="live-strip__item">
          <span>尝试</span>
          <strong>{currentModel?.attempts ?? 0}</strong>
        </div>
      </div>

      <p
        className="live-strip__last"
        title={lastMove ? `${lastMove.notation}（${lastMove.ucci}）` : undefined}
      >
        {lastMove
          ? `上一手 ${SIDE_LABEL[lastMove.side]} ${lastMove.notation} · ${formatLatency(
              lastMove.latencyMs,
            )}`
          : '尚无落子'}
      </p>

      {lastError && (
        <p className="live-error" title={lastError}>
          <span className="live-error__mark" aria-hidden="true" />
          {lastError}
        </p>
      )}
    </section>
  );
}
