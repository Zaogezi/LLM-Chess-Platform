import type { ChampionshipPhase } from '../../../shared/protocol';
import type { ChampionshipConnectionStatus } from '../../hooks/useChampionship';
import {
  CHAMPIONSHIP_PHASE_LABELS,
  championshipPhaseTone,
} from '../../lib/championship';
import { BrandMark, ConnectionBadge } from '../TopBar';

interface ChampionshipHeaderProps {
  phase: ChampionshipPhase;
  connection: ChampionshipConnectionStatus;
}

export function ChampionshipHeader({ phase, connection }: ChampionshipHeaderProps) {
  return (
    <header className="topbar tournament-topbar championship-topbar">
      <div className="topbar__main">
        <BrandMark />
        <h2 className="tournament-brand__title">锦标赛</h2>
      </div>

      <div className="topbar__status">
        <span className={`status-chip status-chip--${championshipPhaseTone(phase)}`}>
          <span className="status-chip__dot" aria-hidden="true" />
          {CHAMPIONSHIP_PHASE_LABELS[phase]}
        </span>
        <ConnectionBadge connection={connection} />
      </div>
    </header>
  );
}
