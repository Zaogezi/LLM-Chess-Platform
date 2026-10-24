import { useEffect, useState } from 'react';
import type { HistoryGameRecord, MoveView } from '../../../shared/protocol';
import type { BoardViewState } from '../../lib/chess';
import { SIDE_LABEL } from '../../lib/chess';
import { formatNotation } from '../../lib/notation';
import { Board } from '../Board';

interface HistoryReplayProps {
  record: HistoryGameRecord;
  frames: readonly BoardViewState[];
  step: number;
  onStepChange: (step: number) => void;
}

const PLAY_INTERVAL_MS = 620;

function currentMove(frames: readonly BoardViewState[], step: number): MoveView | null {
  const frame = frames[step];
  if (!frame || step <= 0) return null;
  return frame.moves[step - 1] ?? null;
}

/**
 * Read-only board replay for the history detail panel. The parent owns `step`
 * so clicking a row in the move table can jump straight to that position.
 */
export function HistoryReplay({
  record,
  frames,
  step,
  onStepChange,
}: HistoryReplayProps) {
  const [playing, setPlaying] = useState(false);
  const lastStep = Math.max(0, frames.length - 1);
  const frame = frames[Math.min(Math.max(0, step), lastStep)];

  useEffect(() => {
    if (!playing) return;
    if (step >= lastStep) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => {
      onStepChange(Math.min(lastStep, step + 1));
    }, PLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [lastStep, onStepChange, playing, step]);

  useEffect(() => {
    if (step >= lastStep) {
      setPlaying(false);
    }
  }, [lastStep, step]);

  const move = currentMove(frames, step);
  const resultText = record.result?.text ?? (record.status === 'failed' ? '对局未完成' : '终局');
  const winner = record.winnerSide;

  const jump = (next: number) => {
    setPlaying(false);
    onStepChange(Math.min(Math.max(0, next), lastStep));
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (step >= lastStep) {
      onStepChange(0);
    }
    setPlaying(true);
  };

  return (
    <section className="admin-replay" aria-label="棋局回放">
      <div className="admin-replay__head">
        <h3>回放</h3>
        <span>
          {step} / {lastStep} 手
        </span>
      </div>

      <div className="admin-replay__players">
        <span className={`admin-replay__name admin-replay__name--red${winner === 'red' ? ' is-winner' : ''}`}>
          {record.red.name}
        </span>
        <span className="admin-replay__vs">对</span>
        <span className={`admin-replay__name admin-replay__name--black${winner === 'black' ? ' is-winner' : ''}`}>
          {record.black.name}
        </span>
      </div>

      {frame && <Board state={frame} />}

      <div className="admin-replay__controls">
        <button
          type="button"
          className="admin-replay__btn"
          onClick={() => jump(0)}
          disabled={step <= 0}
          aria-label="回到开局"
          title="回到开局"
        >
          首
        </button>
        <button
          type="button"
          className="admin-replay__btn"
          onClick={() => jump(step - 1)}
          disabled={step <= 0}
          aria-label="上一手"
          title="上一手"
        >
          上
        </button>
        <button
          type="button"
          className="admin-replay__btn admin-replay__btn--play"
          onClick={togglePlay}
          aria-label={playing ? '暂停回放' : '播放回放'}
          aria-pressed={playing}
        >
          {playing ? '暂停' : '播放'}
        </button>
        <button
          type="button"
          className="admin-replay__btn"
          onClick={() => jump(step + 1)}
          disabled={step >= lastStep}
          aria-label="下一手"
          title="下一手"
        >
          下
        </button>
        <button
          type="button"
          className="admin-replay__btn"
          onClick={() => jump(lastStep)}
          disabled={step >= lastStep}
          aria-label="跳到终局"
          title="跳到终局"
        >
          末
        </button>
      </div>

      <input
        className="admin-replay__range"
        type="range"
        min={0}
        max={lastStep}
        step={1}
        value={Math.min(Math.max(0, step), lastStep)}
        onChange={(event) => {
          setPlaying(false);
          onStepChange(Number(event.target.value));
        }}
        aria-label="回放进度"
      />

      <p className="admin-replay__move">
        {step === 0 ? (
          '开局'
        ) : move ? (
          <>
            <span className={`admin-replay__seal admin-replay__seal--${move.side}`} aria-hidden="true">
              {move.side === 'red' ? '红' : '黑'}
            </span>
            第 {move.ply} 手 · {SIDE_LABEL[move.side]} {formatNotation(move.notation, move.side)}
            <span className="admin-replay__ucci">{move.ucci}</span>
          </>
        ) : (
          '终局'
        )}
      </p>

      {step >= lastStep && (
        <p className={`admin-replay__result${winner ? ' is-decisive' : ''}`}>{resultText}</p>
      )}
    </section>
  );
}
