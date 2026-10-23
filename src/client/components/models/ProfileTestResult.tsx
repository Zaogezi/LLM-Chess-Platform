import type { ProfileTestState } from '../../lib/profiles';
import { profileTestLatencyLabel } from '../../lib/profiles';
import { Spinner } from '../Icons';

interface ProfileTestResultProps {
  state: ProfileTestState;
  compact?: boolean;
}

function tokenLabel(tokensIn: number | undefined, tokensOut: number | undefined): string | null {
  if (!tokensIn && !tokensOut) {
    return null;
  }
  return `↑${tokensIn ?? 0} ↓${tokensOut ?? 0} token`;
}

export function ProfileTestResult({ state, compact = false }: ProfileTestResultProps) {
  const tone = state.status === 'ok' ? 'ok' : state.status === 'error' ? 'error' : 'testing';
  const latency = profileTestLatencyLabel(state.latencyMs);
  const tokens = tokenLabel(state.tokensIn, state.tokensOut);

  return (
    <div
      className={`profile-test profile-test--${tone}${compact ? ' profile-test--compact' : ''}`}
      role="status"
      aria-live="polite"
    >
      {state.status === 'testing' ? (
        <Spinner />
      ) : (
        <span className="profile-test__dot" aria-hidden="true" />
      )}
      <span className="profile-test__message">{state.message}</span>
      {state.status === 'ok' && (latency || tokens) && (
        <span className="profile-test__meta">
          {latency}
          {latency && tokens ? ' · ' : ''}
          {tokens}
        </span>
      )}
    </div>
  );
}
