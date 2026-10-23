import type { ArenaState } from '../../shared/protocol';
import type { ConnectionStatus } from '../hooks/useArena';
import { PHASE_LABELS } from '../lib/format';

interface TopBarProps {
  state: ArenaState | null;
  connection: ConnectionStatus;
}

const CONNECTION_META: Record<ConnectionStatus, { label: string; title: string }> = {
  connecting: { label: '连接中', title: '正在建立实时状态推送' },
  open: { label: '已连接', title: '实时状态推送已连接' },
  reconnecting: { label: '重连中', title: '实时推送中断，正在自动重连' },
};

export function BrandMark() {
  return (
    <div className="brand">
      <div className="brand__seal" aria-hidden="true">
        <span>弈</span>
      </div>
      <div className="brand__text">
        <h1 className="brand__title">楚河论弈</h1>
      </div>
    </div>
  );
}

export function ConnectionBadge({ connection }: { connection: ConnectionStatus }) {
  const meta = CONNECTION_META[connection];

  return (
    <span
      className={`conn-badge conn-badge--${connection}`}
      title={meta.title}
      aria-label={meta.title}
    >
      <span className="conn-badge__dot" aria-hidden="true" />
      {meta.label}
    </span>
  );
}

export function TopBar({ state, connection }: TopBarProps) {
  const phase = state?.phase ?? 'idle';

  return (
    <header className="topbar">
      <div className="topbar__main">
        <BrandMark />
      </div>

      <div className="topbar__status">
        <span className={`status-chip status-chip--${phase}`}>
          <span className="status-chip__dot" aria-hidden="true" />
          {PHASE_LABELS[phase]}
        </span>
        <ConnectionBadge connection={connection} />
      </div>
    </header>
  );
}
