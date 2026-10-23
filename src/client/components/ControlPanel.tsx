import type { CSSProperties, ReactNode } from 'react';
import type { GameSettings, Phase } from '../../shared/protocol';
import type { ActionName } from '../hooks/useArena';
import { LockIcon, PauseIcon, PlayIcon, ResetIcon, RetryIcon, Spinner } from './Icons';

interface ControlPanelProps {
  phase: Phase;
  pending: ActionName | null;
  settings: GameSettings;
  settingsLocked: boolean;
  startBlocked: boolean;
  actionError: string | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onReset: () => void;
  onSettingsChange: (patch: Partial<GameSettings>) => void;
  onDismissError: () => void;
}

interface PrimaryAction {
  name: ActionName;
  label: string;
  pendingLabel: string;
  tone: 'btn--primary' | 'btn--amber';
  icon: ReactNode;
  run: () => void;
}

interface SecondaryAction {
  name: ActionName;
  label: string;
  pendingLabel: string;
  icon: ReactNode;
  run: () => void;
}

export function ControlPanel({
  phase,
  pending,
  settings,
  settingsLocked,
  startBlocked,
  actionError,
  onStart,
  onPause,
  onResume,
  onRetry,
  onReset,
  onSettingsChange,
  onDismissError,
}: ControlPanelProps) {
  let primary: PrimaryAction;

  if (phase === 'running') {
    primary = {
      name: 'pause',
      label: '暂停',
      pendingLabel: '暂停中…',
      tone: 'btn--amber',
      icon: <PauseIcon />,
      run: onPause,
    };
  } else if (phase === 'paused') {
    primary = {
      name: 'resume',
      label: '继续',
      pendingLabel: '继续中…',
      tone: 'btn--primary',
      icon: <PlayIcon />,
      run: onResume,
    };
  } else if (phase === 'error') {
    primary = {
      name: 'retry',
      label: '重试本回合',
      pendingLabel: '重试中…',
      tone: 'btn--primary',
      icon: <RetryIcon />,
      run: onRetry,
    };
  } else if (phase === 'finished') {
    primary = {
      name: 'start',
      label: '再来一局',
      pendingLabel: '开局中…',
      tone: 'btn--primary',
      icon: <PlayIcon />,
      run: onStart,
    };
  } else {
    primary = {
      name: 'start',
      label: '开局',
      pendingLabel: '开局中…',
      tone: 'btn--primary',
      icon: <PlayIcon />,
      run: onStart,
    };
  }

  let secondary: SecondaryAction | null = null;

  if (phase === 'running' || phase === 'paused' || phase === 'error') {
    secondary = {
      name: 'reset',
      label: '重新布阵',
      pendingLabel: '重置中…',
      icon: <ResetIcon />,
      run: onReset,
    };
  } else if (phase === 'finished') {
    secondary = {
      name: 'reset',
      label: '重开一局',
      pendingLabel: '重置中…',
      icon: <ResetIcon />,
      run: onReset,
    };
  }

  const busy = pending !== null;
  const startDisabled = busy || (primary.name === 'start' && startBlocked);

  const sliderStyle: CSSProperties & Record<'--range-fill', string> = {
    '--range-fill': `${(settings.moveDelayMs / 5000) * 100}%`,
  };

  return (
    <section className="panel control-panel" aria-label="对局调度">
      <div className="control-actions">
        <button
          type="button"
          className={`btn ${primary.tone} btn--lg`}
          onClick={primary.run}
          disabled={startDisabled}
          aria-busy={pending === primary.name}
        >
          {pending === primary.name ? <Spinner /> : primary.icon}
          <span>{pending === primary.name ? primary.pendingLabel : primary.label}</span>
        </button>

        {secondary && (
          <button
            type="button"
            className="btn btn--secondary btn--lg"
            onClick={secondary.run}
            disabled={busy}
            aria-busy={pending === secondary.name}
          >
            {pending === secondary.name ? <Spinner /> : secondary.icon}
            <span>{pending === secondary.name ? secondary.pendingLabel : secondary.label}</span>
          </button>
        )}
      </div>

      {startBlocked && <p className="control-hint">服务未就绪</p>}

      {actionError && (
        <div className="control-error" role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className="icon-close"
            onClick={onDismissError}
            aria-label="关闭错误提示"
          >
            ×
          </button>
        </div>
      )}

      {settingsLocked ? (
        <div className="settings settings--readonly">
          <div className="settings__readout">
            <span>
              落子间隔 <strong>{settings.moveDelayMs} ms</strong>
            </span>
            <span>
              最大尝试 <strong>{settings.maxAttempts} 次</strong>
            </span>
          </div>
          <p className="settings__locked">
            <LockIcon width={11} height={11} />
            已锁定
          </p>
        </div>
      ) : (
        <div className="settings">
          <div className="settings__field">
            <div className="settings__label-row">
              <label htmlFor="move-delay">落子间隔</label>
              <output className="settings__value" htmlFor="move-delay">
                {settings.moveDelayMs} ms
              </output>
            </div>
            <input
              id="move-delay"
              className="range"
              type="range"
              min={0}
              max={5000}
              step={100}
              value={settings.moveDelayMs}
              disabled={busy}
              style={sliderStyle}
              aria-label={`落子间隔 ${settings.moveDelayMs} 毫秒`}
              onChange={(event) => onSettingsChange({ moveDelayMs: Number(event.target.value) })}
            />
          </div>

          <div className="settings__field settings__field--attempts">
            <label htmlFor="max-attempts">最大尝试</label>
            <span className="select-wrap">
              <select
                id="max-attempts"
                value={settings.maxAttempts}
                disabled={busy}
                onChange={(event) => onSettingsChange({ maxAttempts: Number(event.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((count) => (
                  <option key={count} value={count}>
                    {count} 次
                  </option>
                ))}
              </select>
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
