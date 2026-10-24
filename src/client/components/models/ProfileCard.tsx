import type { ModelProfileView } from '../../../shared/protocol';
import type { ProfileTestState } from '../../lib/profiles';
import { profileProviderLabel } from '../../lib/profiles';
import { Spinner } from '../Icons';
import { ProfileTestResult } from './ProfileTestResult';

interface ProfileCardProps {
  profile: ModelProfileView;
  selected: boolean;
  deleting: boolean;
  disabled: boolean;
  testing: boolean;
  testDisabled: boolean;
  testState: ProfileTestState | null;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProfileCard({
  profile,
  selected,
  deleting,
  disabled,
  testing,
  testDisabled,
  testState,
  onTest,
  onEdit,
  onDelete,
}: ProfileCardProps) {
  return (
    <article
      className={`profile-card${selected ? ' is-selected' : ''}`}
      aria-label={`模型 ${profile.name}`}
    >
      <div className="profile-card__head">
        <div className="profile-card__identity">
          <span className="profile-card__seal" aria-hidden="true">
            型
          </span>
          <div>
            <h3>{profile.name}</h3>
            <p>
              <span>{profileProviderLabel(profile.provider)}</span>
              <i aria-hidden="true">·</i>
              <code>{profile.model}</code>
              {profile.requestTimeoutSeconds ? (
                <>
                  <i aria-hidden="true">·</i>
                  <span>上限 {profile.requestTimeoutSeconds} 秒</span>
                </>
              ) : null}
            </p>
          </div>
        </div>
        <span className={`profile-key${profile.keyConfigured ? ' is-set' : ''}`}>
          {profile.keyConfigured ? '密钥已存' : '无密钥'}
        </span>
      </div>

      {testState && <ProfileTestResult state={testState} compact />}

      <div className="profile-card__foot">
        <div className="profile-card__actions">
          <button
            type="button"
            className="tourney-mini-btn profile-card__test-btn"
            onClick={onTest}
            disabled={disabled || testDisabled}
            aria-busy={testing}
            aria-label={`测试模型 ${profile.name} 是否可用`}
          >
            {testing ? (
              <>
                <Spinner />
                测试中
              </>
            ) : (
              '测试'
            )}
          </button>
          <button
            type="button"
            className="tourney-mini-btn"
            onClick={onEdit}
            disabled={disabled}
            aria-label={`编辑模型 ${profile.name}`}
          >
            编辑
          </button>
          <button
            type="button"
            className="tourney-mini-btn tourney-mini-btn--danger"
            onClick={onDelete}
            disabled={disabled}
            aria-busy={deleting}
            aria-label={`删除模型 ${profile.name}`}
          >
            {deleting ? <Spinner /> : '删除'}
          </button>
        </div>
      </div>
    </article>
  );
}
