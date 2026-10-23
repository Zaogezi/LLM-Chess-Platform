import type { TournamentPhase } from '../../../shared/protocol';
import type { TournamentConnectionStatus } from '../../hooks/useTournament';
import { TOURNAMENT_PHASE_LABELS, tournamentPhaseTone } from '../../lib/tournament';
import { BrandMark, ConnectionBadge } from '../TopBar';

interface TournamentHeaderProps {
  phase: TournamentPhase;
  connection: TournamentConnectionStatus;
}

export function TournamentHeader({ phase, connection }: TournamentHeaderProps) {
  return (
    <header className="topbar tournament-topbar">
      <div className="topbar__main">
        <BrandMark />
        <h2 className="tournament-brand__title">自动评测</h2>
      </div>

      <div className="topbar__status">
        <span className={`status-chip status-chip--${tournamentPhaseTone(phase)}`}>
          <span className="status-chip__dot" aria-hidden="true" />
          {TOURNAMENT_PHASE_LABELS[phase]}
        </span>
        <ConnectionBadge connection={connection} />
      </div>
    </header>
  );
}
