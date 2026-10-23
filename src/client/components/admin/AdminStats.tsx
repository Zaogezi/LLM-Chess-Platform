import type { HistoryStats } from '../../../shared/protocol';
import { formatHistoryCount } from '../../lib/history';

interface AdminStatsProps {
  stats: HistoryStats | null;
  loading: boolean;
}

interface StatCard {
  key: keyof Pick<
    HistoryStats,
    'total' | 'arena' | 'tournament' | 'championship' | 'finished' | 'failed' | 'totalPlies'
  >;
  label: string;
  suffix: string;
  tone: 'gold' | 'red' | 'ink' | 'jade' | 'danger';
}

const STAT_CARDS: readonly StatCard[] = [
  { key: 'total', label: '全部', suffix: '局', tone: 'gold' },
  { key: 'arena', label: '手动', suffix: '局', tone: 'red' },
  { key: 'tournament', label: '评测', suffix: '局', tone: 'ink' },
  { key: 'championship', label: '锦标赛', suffix: '局', tone: 'gold' },
  { key: 'finished', label: '完赛', suffix: '局', tone: 'jade' },
  { key: 'failed', label: '异常', suffix: '局', tone: 'danger' },
  { key: 'totalPlies', label: '手数', suffix: '手', tone: 'gold' },
];

export function AdminStats({ stats, loading }: AdminStatsProps) {
  return (
    <section className="admin-stats" aria-label="档案统计" aria-busy={loading && !stats}>
      <div className="admin-stats__grid">
        {STAT_CARDS.map((card) => (
          <article key={card.key} className={`admin-stat admin-stat--${card.tone}`}>
            <span className="admin-stat__label">{card.label}</span>
            <span className="admin-stat__value">
              {loading && !stats ? '—' : formatHistoryCount(stats ? (stats[card.key] ?? 0) : 0)}
              <em>{card.suffix}</em>
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}
