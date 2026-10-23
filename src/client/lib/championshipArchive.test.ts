import { describe, expect, it } from 'vitest';
import type {
  ChampionshipArchive,
  ChampionshipArchiveSummary,
  ChampionshipSeriesView,
} from '../../shared/protocol';
import {
  CHAMPIONSHIP_ARCHIVE_PHASE_HINTS,
  CHAMPIONSHIP_ARCHIVE_PHASE_LABELS,
  championshipArchiveAriaSummary,
  championshipArchiveChampionLabel,
  championshipArchiveEntrantText,
  championshipArchiveLastStage,
  championshipArchivePhaseTone,
  formatArchiveDuration,
  formatArchiveGames,
  formatArchiveRange,
  formatArchiveSeries,
  formatArchiveTimestamp,
  toChampionshipPhase,
} from './championshipArchive';

const summary: ChampionshipArchiveSummary = {
  championshipId: 'champ-1',
  phase: 'stopped',
  startedAt: 1_700_000_000_000,
  finishedAt: 1_700_000_540_000,
  archivedAt: 1_700_000_600_000,
  championModelId: null,
  championName: null,
  error: null,
  entrantNames: ['甲', '乙', '丙', '丁', '戊'],
  completedGames: 18,
  processedGames: 20,
  scheduledGames: 27,
  seriesProcessed: 1,
  seriesTotal: 7,
};

function series(
  id: string,
  stage: ChampionshipSeriesView['stage'],
  overrides: Partial<ChampionshipSeriesView> = {},
): ChampionshipSeriesView {
  return {
    id,
    stage,
    label: id,
    slot: 1,
    status: 'pending',
    left: null,
    right: null,
    leftWins: 0,
    rightWins: 0,
    leftPoints: 0,
    rightPoints: 0,
    draws: 0,
    failed: 0,
    playedGames: 0,
    maxGames: 6,
    overtime: false,
    extra: false,
    winnerModelId: null,
    decision: null,
    ...overrides,
  };
}

describe('championship archive presentation', () => {
  it('labels every archive phase and maps to the live phase union', () => {
    expect(CHAMPIONSHIP_ARCHIVE_PHASE_LABELS.finished).toContain('完赛');
    expect(CHAMPIONSHIP_ARCHIVE_PHASE_LABELS.stopped).toContain('中止');
    expect(CHAMPIONSHIP_ARCHIVE_PHASE_LABELS.error).toContain('异常');
    expect(CHAMPIONSHIP_ARCHIVE_PHASE_LABELS.interrupted).toContain('中断');
    expect(Object.keys(CHAMPIONSHIP_ARCHIVE_PHASE_HINTS)).toHaveLength(4);

    expect(toChampionshipPhase('finished')).toBe('finished');
    expect(toChampionshipPhase('stopped')).toBe('stopped');
    expect(toChampionshipPhase('error')).toBe('error');
    expect(toChampionshipPhase('interrupted')).toBe('interrupted');
    expect(championshipArchivePhaseTone('finished')).toBe('finished');
    expect(championshipArchivePhaseTone('interrupted')).toBe('paused');
    expect(championshipArchivePhaseTone('error')).toBe('error');
  });

  it('formats counters, ranges and entrant previews', () => {
    expect(championshipArchiveChampionLabel(summary)).toBe('未产生冠军');
    expect(championshipArchiveChampionLabel({ ...summary, championName: '冠军甲' })).toBe(
      '冠军甲',
    );
    expect(formatArchiveGames(summary)).toBe('18 / 27 局');
    expect(formatArchiveSeries(summary)).toBe('1 / 7 场');
    expect(formatArchiveDuration(summary)).toBe('9 分 00 秒');
    expect(formatArchiveTimestamp(null)).toBe('—');
    expect(formatArchiveRange(summary)).toContain('—');

    expect(championshipArchiveEntrantText(summary, 2)).toBe('甲、乙 等 5 位');
    expect(championshipArchiveEntrantText(summary, 9)).toBe('甲、乙、丙、丁、戊');
    expect(championshipArchiveEntrantText({ ...summary, entrantNames: [] })).toBe(
      '未记录参赛阵容',
    );
    expect(championshipArchiveAriaSummary(summary)).toContain('未产生冠军');
  });

  it('finds the deepest reached stage for the detail meta line', () => {
    const archive = {
      series: [
        series('qf1', 'quarterfinal', { status: 'finished', playedGames: 4 }),
        series('sf1', 'semifinal', { status: 'stopped', playedGames: 3 }),
        series('final', 'final'),
      ],
      championName: null,
    } as Pick<ChampionshipArchive, 'series' | 'championName'>;
    expect(championshipArchiveLastStage(archive)).toBe('semifinal');
    expect(championshipArchiveLastStage({ series: [], championName: null })).toBe('group');
    expect(
      championshipArchiveLastStage({ series: archive.series, championName: '冠军甲' }),
    ).toBe('final');
  });
});
