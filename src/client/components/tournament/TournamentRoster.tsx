import type {
  TournamentModelView,
  TournamentPhase,
} from '../../../shared/protocol';
import { PROVIDER_LABELS } from '../../presets';
import {
  TOURNAMENT_MODEL_SEALS,
  TOURNAMENT_PHASE_LABELS,
  type TournamentPlan,
} from '../../lib/tournament';
import { thinkingLevelLabel } from '../../lib/format';

interface TournamentRosterProps {
  models: TournamentModelView[];
  gamesPerPair: number;
  plan: TournamentPlan;
  phase: TournamentPhase;
}

export function TournamentRoster({
  models,
  gamesPerPair,
  plan,
  phase,
}: TournamentRosterProps) {
  const running = phase === 'running';
  const title = running ? '本届阵容' : '上届阵容';

  return (
    <section
      className={`panel tournament-setup tournament-roster-panel${
        running ? ' is-running' : ' is-past'
      }`}
      aria-label={running ? '本届参赛阵容' : '上届参赛阵容'}
    >
      <div className="panel__head">
        <h2 className="panel__title">{title}</h2>
        <span className="panel__meta">{TOURNAMENT_PHASE_LABELS[phase]}</span>
      </div>

      <ol className="tourney-roster">
        {models.map((model, index) => (
          <li key={model.id} className="tourney-roster__item">
            <span
              className={`tourney-seal tourney-seal--${index % 2 === 0 ? 'red' : 'ink'}`}
              aria-hidden="true"
            >
              {TOURNAMENT_MODEL_SEALS[index] ?? String(index + 1)}
            </span>
            <div className="tourney-roster__names">
              <strong>{model.name}</strong>
              <span>
                {PROVIDER_LABELS[model.provider]} · {model.model}
              </span>
            </div>
            <div className="tourney-roster__tags">
              <span className="thinking-badge">
                {thinkingLevelLabel(model.thinkingLevel)}
                {model.apiReasoning ? ' · API' : ''}
              </span>
              {running && (
                <span className={`tourney-key-chip${model.keyConfigured ? ' is-set' : ''}`}>
                  {model.keyConfigured ? '密钥就绪' : '无密钥'}
                </span>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="tourney-plan-summary tourney-plan-summary--compact">
        <div>
          <span>配对</span>
          <strong>{plan.pairings}</strong>
          <em>组</em>
        </div>
        <div>
          <span>每对</span>
          <strong>{gamesPerPair}</strong>
          <em>局</em>
        </div>
        <div>
          <span>总对局</span>
          <strong>{plan.totalGames}</strong>
          <em>局</em>
        </div>
      </div>
    </section>
  );
}
