import type { Side } from '../../shared/protocol';
import type { CapturedGroup } from '../lib/chess';
import { SIDE_LABEL, otherSide } from '../lib/chess';

interface CapturedTrayProps {
  /** The player who owns this tray; it holds pieces captured from the opponent. */
  owner: Side;
  groups: CapturedGroup[];
}

export function CapturedTray({ owner, groups }: CapturedTrayProps) {
  if (groups.length === 0) {
    return null;
  }

  const capturedSide = otherSide(owner);

  return (
    <div className="captured-tray" aria-label={`${SIDE_LABEL[owner]}所擒棋子`}>
      <span className="captured-tray__label" aria-hidden="true">
        所擒
      </span>
      <ul className="captured-tray__list">
        {groups.map((group) => (
          <li
            key={group.type}
            className={`captured-piece captured-piece--${capturedSide}`}
            title={`${SIDE_LABEL[capturedSide]}${group.glyph}${
              group.count > 1 ? ` ×${group.count}` : ''
            }`}
          >
            <span aria-hidden="true">{group.glyph}</span>
            {group.count > 1 && (
              <span className="captured-piece__count" aria-hidden="true">
                {group.count}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
