import type {
  ChampionshipArchive,
  ChampionshipArchivePhase,
  ChampionshipArchiveSummary,
  ChampionshipPhase,
  ChampionshipStage,
} from '../../shared/protocol';
import { formatDuration } from './format';
import { formatHistoryDateTime } from './history';
import type { TournamentTone } from './tournament';

/**
 * Presentation helpers for the 对局管理 → 锦标赛档案 tab. Archived editions are
 * terminal snapshots: finished runs plus stopped / error / interrupted runs
 * that are kept for review.
 */

export const CHAMPIONSHIP_ARCHIVE_PHASE_LABELS: Record<ChampionshipArchivePhase, string> = {
  finished: '已完赛',
  stopped: '已中止',
  error: '异常中止',
  interrupted: '中断未续',
};

export const CHAMPIONSHIP_ARCHIVE_PHASE_HINTS: Record<ChampionshipArchivePhase, string> = {
  finished: '完整赛程已结束，冠军与全部成绩已归档。',
  stopped: '手动中止，保留已完成的全部对局与系列赛成绩。',
  error: '运行异常中止，保留异常前已完成的成绩。',
  interrupted: '服务重启或断电后未继续的断点赛事，保留中断瞬间的成绩。',
};

const ARCHIVE_PHASE_TONES: Record<ChampionshipArchivePhase, TournamentTone> = {
  finished: 'finished',
  stopped: 'paused',
  error: 'error',
  interrupted: 'paused',
};

export function championshipArchivePhaseTone(
  phase: ChampionshipArchivePhase,
): TournamentTone {
  return ARCHIVE_PHASE_TONES[phase];
}

/** Map an archive phase onto the live-state phase union the panels accept. */
export function toChampionshipPhase(phase: ChampionshipArchivePhase): ChampionshipPhase {
  switch (phase) {
    case 'finished':
      return 'finished';
    case 'stopped':
      return 'stopped';
    case 'error':
      return 'error';
    default:
      return 'interrupted';
  }
}

export function formatArchiveTimestamp(timestamp: number | null | undefined): string {
  return formatHistoryDateTime(timestamp ?? null);
}

export function formatArchiveRange(summary: ChampionshipArchiveSummary): string {
  const start = formatArchiveTimestamp(summary.startedAt);
  const end = formatArchiveTimestamp(summary.finishedAt ?? summary.archivedAt);
  return start === end ? start : `${start} — ${end}`;
}

export function formatArchiveDuration(summary: ChampionshipArchiveSummary): string {
  const endedAt = summary.finishedAt ?? summary.archivedAt;
  if (!Number.isFinite(summary.startedAt) || !Number.isFinite(endedAt)) {
    return '—';
  }
  return formatDuration(Math.max(0, endedAt - summary.startedAt));
}

export function championshipArchiveChampionLabel(
  summary: ChampionshipArchiveSummary,
): string {
  return summary.championName ?? '未产生冠军';
}

export function formatArchiveGames(summary: ChampionshipArchiveSummary): string {
  return `${summary.completedGames} / ${summary.scheduledGames} 局`;
}

export function formatArchiveSeries(summary: ChampionshipArchiveSummary): string {
  return `${summary.seriesProcessed} / ${summary.seriesTotal} 场`;
}

/** First few entrant names plus a "等 N 位" tail for compact list rows. */
export function championshipArchiveEntrants(
  summary: ChampionshipArchiveSummary,
  limit = 4,
): { names: string[]; extra: number } {
  const names = summary.entrantNames;
  return {
    names: names.slice(0, Math.max(0, limit)),
    extra: Math.max(0, names.length - Math.max(0, limit)),
  };
}

export function championshipArchiveEntrantText(
  summary: ChampionshipArchiveSummary,
  limit = 4,
): string {
  const { names, extra } = championshipArchiveEntrants(summary, limit);
  if (names.length === 0) {
    return '未记录参赛阵容';
  }
  return extra > 0 ? `${names.join('、')} 等 ${names.length + extra} 位` : names.join('、');
}

/** Deepest stage reached by an archived edition, for the detail meta line. */
export function championshipArchiveLastStage(
  archive: Pick<ChampionshipArchive, 'series' | 'championName'>,
): ChampionshipStage {
  if (archive.championName) {
    return 'final';
  }
  const order: readonly ChampionshipStage[] = [
    'final',
    'semifinal',
    'quarterfinal',
    'group',
  ];
  for (const stage of order) {
    const touched = archive.series.some(
      (series) => series.stage === stage && (series.status !== 'pending' || series.playedGames > 0),
    );
    if (touched) {
      return stage;
    }
  }
  return 'group';
}

export function championshipArchiveAriaSummary(summary: ChampionshipArchiveSummary): string {
  const champion = summary.championName ? `冠军 ${summary.championName}` : '未产生冠军';
  return `锦标赛档案，${CHAMPIONSHIP_ARCHIVE_PHASE_LABELS[summary.phase]}，${formatArchiveTimestamp(
    summary.startedAt,
  )} 开赛，${champion}，已完成 ${summary.completedGames}/${summary.scheduledGames} 局，系列赛 ${summary.seriesProcessed}/${summary.seriesTotal} 场。`;
}
