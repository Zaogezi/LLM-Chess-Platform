import type { GameResult } from '../../shared/protocol';
import { SIDE_LABEL } from '../lib/chess';
import { PlayIcon, Spinner } from './Icons';

interface ResultBannerProps {
  result: GameResult;
  pending: boolean;
  onRematch: () => void;
}

export function ResultBanner({ result, pending, onRematch }: ResultBannerProps) {
  const winnerSide = result.winner;

  return (
    <section
      className={`result-banner${
        winnerSide ? ` result-banner--${winnerSide}` : ' result-banner--draw'
      }`}
      aria-label="对局结果"
    >
      <div className="result-banner__main">
        <span className="result-banner__seal" aria-hidden="true">
          {winnerSide ? '胜' : '和'}
        </span>
        <div className="result-banner__copy">
          <h2 className="result-banner__title">
            {winnerSide ? `${SIDE_LABEL[winnerSide]}胜` : '和局'}
          </h2>
          <p className="result-banner__text">{result.text}</p>
        </div>
      </div>

      <button
        type="button"
        className="btn btn--primary btn--compact"
        onClick={onRematch}
        disabled={pending}
        aria-busy={pending}
      >
        {pending ? <Spinner /> : <PlayIcon />}
        <span>{pending ? '开局中…' : '再来一局'}</span>
      </button>
    </section>
  );
}
