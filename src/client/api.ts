import type {
  ArenaState,
  ChampionshipArchive,
  ChampionshipArchiveListResponse,
  ChampionshipArchivePhase,
  ChampionshipArchiveSummary,
  ChampionshipGameSnapshot,
  ChampionshipSetupResponse,
  ChampionshipSetupSaveRequest,
  ChampionshipStartRequest,
  ChampionshipState,
  HistoryDeleteResponse,
  HistoryGameRecord,
  HistoryListResponse,
  ModelProfileCreateRequest,
  ModelProfileDeleteResponse,
  ModelProfileListResponse,
  ModelProfileUpdateRequest,
  ModelProfileView,
  ModelTestRequest,
  ModelTestResponse,
  QualifierGameSnapshot,
  QualifierStartRequest,
  QualifierState,
  ThinkingOptionsRequest,
  ThinkingOptionsResponse,
  TournamentGameSnapshot,
  TournamentStartRequest,
  TournamentState,
} from '../shared/protocol';
import type { HistoryListQuery } from './lib/history';
import { isValidSetupSnapshot } from './lib/championshipSetup';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Older servers/clients omit these fields; only present values are checked. */
function isOptionalPromptLevel(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim().length > 0)
  );
}

function isOptionalTokenCap(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'number' && Number.isInteger(value) && value > 0)
  );
}

function isArenaState(value: unknown): value is ArenaState {
  return (
    isRecord(value) &&
    typeof value.revision === 'number' &&
    typeof value.phase === 'string' &&
    Array.isArray(value.board) &&
    typeof value.turn === 'string'
  );
}

function isTournamentState(value: unknown): value is TournamentState {
  return (
    isRecord(value) &&
    typeof value.revision === 'number' &&
    typeof value.phase === 'string' &&
    Array.isArray(value.models) &&
    Array.isArray(value.games) &&
    Array.isArray(value.standings) &&
    typeof value.totalGames === 'number'
  );
}

function isGameView(value: unknown): value is { id: string; status: string } {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.status === 'string' &&
    typeof value.pairIndex === 'number' &&
    typeof value.gameIndex === 'number' &&
    typeof value.redName === 'string' &&
    typeof value.blackName === 'string' &&
    typeof value.plies === 'number' &&
    typeof value.durationMs === 'number' &&
    (value.result === null || isRecord(value.result)) &&
    (value.error === null || typeof value.error === 'string') &&
    (value.failedSide === null ||
      value.failedSide === 'red' ||
      value.failedSide === 'black')
  );
}

function isTournamentGameSnapshot(value: unknown): value is TournamentGameSnapshot {
  return (
    isRecord(value) &&
    isGameView(value.game) &&
    typeof value.live === 'boolean' &&
    (value.arena === null || isArenaState(value.arena))
  );
}

function isChampionshipGameSnapshot(value: unknown): value is ChampionshipGameSnapshot {
  return (
    isRecord(value) &&
    isGameView(value.game) &&
    typeof (value.game as { stage?: unknown }).stage === 'string' &&
    typeof value.live === 'boolean' &&
    (value.arena === null || isArenaState(value.arena))
  );
}

function isQualifierGameSnapshot(value: unknown): value is QualifierGameSnapshot {
  return isChampionshipGameSnapshot(value);
}

function isQualifierState(value: unknown): value is QualifierState {
  return (
    isRecord(value) &&
    typeof value.revision === 'number' &&
    typeof value.phase === 'string' &&
    Array.isArray(value.entrants) &&
    Array.isArray(value.groups) &&
    Array.isArray(value.games) &&
    Array.isArray(value.currentGameIds) &&
    value.currentGameIds.every((id) => typeof id === 'string') &&
    Array.isArray(value.qualifiedModelIds) &&
    value.qualifiedModelIds.every((id) => typeof id === 'string') &&
    typeof value.concurrency === 'number' &&
    typeof value.processedGames === 'number' &&
    typeof value.groupGamesTotal === 'number' &&
    typeof value.resumable === 'boolean' &&
    (value.checkpointSavedAt === null || typeof value.checkpointSavedAt === 'number')
  );
}

function isChampionshipState(value: unknown): value is ChampionshipState {
  return (
    isRecord(value) &&
    typeof value.revision === 'number' &&
    typeof value.phase === 'string' &&
    Array.isArray(value.entrants) &&
    Array.isArray(value.groups) &&
    Array.isArray(value.series) &&
    Array.isArray(value.games) &&
    Array.isArray(value.currentGameIds) &&
    value.currentGameIds.every((id) => typeof id === 'string') &&
    Array.isArray(value.currentSeriesIds) &&
    value.currentSeriesIds.every((id) => typeof id === 'string') &&
    typeof value.concurrency === 'number' &&
    typeof value.processedGames === 'number' &&
    typeof value.seriesTotal === 'number' &&
    typeof value.resumable === 'boolean' &&
    (value.checkpointSavedAt === null || typeof value.checkpointSavedAt === 'number')
  );
}

function isChampionshipSetupResponse(value: unknown): value is ChampionshipSetupResponse {
  return isRecord(value) && (value.setup === null || isValidSetupSnapshot(value.setup));
}

const CHAMPIONSHIP_ARCHIVE_PHASES: readonly ChampionshipArchivePhase[] = [
  'finished',
  'stopped',
  'error',
  'interrupted',
];

function isChampionshipArchivePhase(value: unknown): value is ChampionshipArchivePhase {
  return (
    typeof value === 'string' &&
    CHAMPIONSHIP_ARCHIVE_PHASES.includes(value as ChampionshipArchivePhase)
  );
}

function isChampionshipArchiveSummary(
  value: unknown,
): value is ChampionshipArchiveSummary {
  return (
    isRecord(value) &&
    typeof value.championshipId === 'string' &&
    isChampionshipArchivePhase(value.phase) &&
    typeof value.startedAt === 'number' &&
    (value.finishedAt === null || typeof value.finishedAt === 'number') &&
    typeof value.archivedAt === 'number' &&
    (value.championModelId === null || typeof value.championModelId === 'string') &&
    (value.championName === null || typeof value.championName === 'string') &&
    (value.error === null || typeof value.error === 'string') &&
    Array.isArray(value.entrantNames) &&
    value.entrantNames.every((name) => typeof name === 'string') &&
    typeof value.completedGames === 'number' &&
    typeof value.processedGames === 'number' &&
    typeof value.scheduledGames === 'number' &&
    typeof value.seriesProcessed === 'number' &&
    typeof value.seriesTotal === 'number'
  );
}

function isChampionshipArchiveListResponse(
  value: unknown,
): value is ChampionshipArchiveListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.archives) &&
    value.archives.every(isChampionshipArchiveSummary) &&
    typeof value.total === 'number'
  );
}

function isChampionshipSeriesArchiveEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.stage === 'string' &&
    typeof value.status === 'string' &&
    typeof value.leftWins === 'number' &&
    typeof value.rightWins === 'number' &&
    typeof value.leftPoints === 'number' &&
    typeof value.rightPoints === 'number' &&
    typeof value.draws === 'number' &&
    typeof value.failed === 'number' &&
    typeof value.playedGames === 'number' &&
    typeof value.overtime === 'boolean' &&
    typeof value.extra === 'boolean'
  );
}

function isChampionshipArchive(value: unknown): value is ChampionshipArchive {
  return (
    isChampionshipArchiveSummary(value) &&
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.entrants) &&
    Array.isArray(value.groups) &&
    Array.isArray(value.series) &&
    value.series.every(isChampionshipSeriesArchiveEntry) &&
    Array.isArray(value.games) &&
    typeof value.groupGamesTotal === 'number' &&
    typeof value.groupGamesProcessed === 'number'
  );
}

function isHistoryStats(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.total === 'number' &&
    typeof value.arena === 'number' &&
    typeof value.tournament === 'number' &&
    (value.championship === undefined || typeof value.championship === 'number') &&
    typeof value.finished === 'number' &&
    typeof value.failed === 'number' &&
    typeof value.totalPlies === 'number'
  );
}

function isHistoryListResponse(value: unknown): value is HistoryListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.records) &&
    typeof value.total === 'number' &&
    typeof value.limit === 'number' &&
    typeof value.offset === 'number' &&
    isHistoryStats(value.stats)
  );
}

function isHistoryGameRecord(value: unknown): value is HistoryGameRecord {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.mode === 'arena' ||
      value.mode === 'tournament' ||
      value.mode === 'championship') &&
    (value.status === 'finished' || value.status === 'failed') &&
    typeof value.startedAt === 'number' &&
    typeof value.endedAt === 'number' &&
    isRecord(value.red) &&
    isRecord(value.black) &&
    Array.isArray(value.moves)
  );
}

function isHistoryDeleteResponse(value: unknown): value is HistoryDeleteResponse {
  return isRecord(value) && typeof value.removed === 'number' && typeof value.total === 'number';
}

function isModelProfileView(value: unknown): value is ModelProfileView {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    (value.provider === 'openai' || value.provider === 'anthropic') &&
    typeof value.baseUrl === 'string' &&
    typeof value.model === 'string' &&
    typeof value.thinkingLevel === 'string' &&
    value.thinkingLevel.trim().length > 0 &&
    Array.isArray(value.thinkingLevels) &&
    value.thinkingLevels.every((level) => typeof level === 'string' && level.trim().length > 0) &&
    typeof value.apiReasoning === 'boolean' &&
    isOptionalPromptLevel(value.promptLevel) &&
    isOptionalTokenCap(value.maxThinkingTokens) &&
    isOptionalTokenCap(value.maxCompletionTokens) &&
    (value.requestTimeoutSeconds === undefined ||
      value.requestTimeoutSeconds === null ||
      typeof value.requestTimeoutSeconds === 'number') &&
    typeof value.keyConfigured === 'boolean' &&
    (value.keyHint === null || typeof value.keyHint === 'string') &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  );
}

function isModelProfileListResponse(value: unknown): value is ModelProfileListResponse {
  return isRecord(value) && Array.isArray(value.profiles) && value.profiles.every(isModelProfileView);
}

function isModelProfileDeleteResponse(value: unknown): value is ModelProfileDeleteResponse {
  return isRecord(value) && typeof value.removed === 'number' && typeof value.total === 'number';
}

function isModelTestResponse(value: unknown): value is ModelTestResponse {
  return (
    isRecord(value) &&
    typeof value.ok === 'boolean' &&
    (value.provider === 'openai' || value.provider === 'anthropic') &&
    typeof value.model === 'string' &&
    typeof value.latencyMs === 'number' &&
    typeof value.tokensIn === 'number' &&
    typeof value.tokensOut === 'number' &&
    typeof value.message === 'string' &&
    typeof value.replyPreview === 'string' &&
    typeof value.testedAt === 'number'
  );
}

function isThinkingOptionsResponse(value: unknown): value is ThinkingOptionsResponse {
  return (
    isRecord(value) &&
    (value.source === 'ollama' ||
      value.source === 'openrouter' ||
      value.source === 'api' ||
      value.source === 'fallback') &&
    Array.isArray(value.options) &&
    value.options.length > 0 &&
    value.options.every((level) => typeof level === 'string' && level.trim().length > 0) &&
    (value.defaultLevel === null || typeof value.defaultLevel === 'string') &&
    typeof value.note === 'string'
  );
}

async function readErrorMessage(response: Response, service: string): Promise<string> {
  try {
    const payload: unknown = await response.json();
    if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // The response body was not JSON; fall through to the generic message.
  }
  return `${service}服务返回异常（HTTP ${response.status}）。`;
}

async function requestJson<T>(
  path: string,
  init: RequestInit,
  validate: (value: unknown) => value is T,
  invalidMessage: string,
  service: '棋局' | '评测' | '锦标赛' | '入围赛' | '历史' | '模型库',
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error(`无法连接${service}服务，请确认服务正在运行。`);
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, service));
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`${service}服务返回了无法解析的数据。`);
  }

  if (!validate(payload)) {
    throw new Error(invalidMessage);
  }

  return payload;
}

export function fetchArenaState(): Promise<ArenaState> {
  return requestJson(
    '/api/state',
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isArenaState,
    '棋局服务返回的棋局状态不完整。',
    '棋局',
  );
}

export function postArenaAction(path: string, body?: unknown): Promise<ArenaState> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const init: RequestInit = { method: 'POST', headers };

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  return requestJson(path, init, isArenaState, '棋局服务返回的棋局状态不完整。', '棋局');
}

export function fetchTournamentState(): Promise<TournamentState> {
  return requestJson(
    '/api/tournament/state',
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isTournamentState,
    '评测服务返回的赛事状态不完整。',
    '评测',
  );
}

export function postTournamentStart(request: TournamentStartRequest): Promise<TournamentState> {
  return requestJson(
    '/api/tournament/start',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    isTournamentState,
    '评测服务返回的赛事状态不完整。',
    '评测',
  );
}

export function fetchTournamentGame(gameId: string): Promise<TournamentGameSnapshot> {
  return requestJson(
    `/api/tournament/games/${encodeURIComponent(gameId)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isTournamentGameSnapshot,
    '评测服务返回的对局画面不完整。',
    '评测',
  );
}

export function postTournamentStop(): Promise<TournamentState> {
  return requestJson(
    '/api/tournament/stop',
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
    },
    isTournamentState,
    '评测服务返回的赛事状态不完整。',
    '评测',
  );
}

export function fetchChampionshipState(): Promise<ChampionshipState> {
  return requestJson(
    '/api/championship/state',
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isChampionshipState,
    '锦标赛服务返回的赛事状态不完整。',
    '锦标赛',
  );
}

export function fetchChampionshipSetup(): Promise<ChampionshipSetupResponse> {
  return requestJson(
    '/api/championship/setup',
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isChampionshipSetupResponse,
    '锦标赛服务返回的配置快照不完整。',
    '锦标赛',
  );
}

export function putChampionshipSetup(
  request: ChampionshipSetupSaveRequest,
): Promise<ChampionshipSetupResponse> {
  return requestJson(
    '/api/championship/setup',
    {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    isChampionshipSetupResponse,
    '锦标赛服务返回的配置快照不完整。',
    '锦标赛',
  );
}

export function postChampionshipStart(
  request: ChampionshipStartRequest,
): Promise<ChampionshipState> {
  return requestJson(
    '/api/championship/start',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    isChampionshipState,
    '锦标赛服务返回的赛事状态不完整。',
    '锦标赛',
  );
}

export function fetchChampionshipGame(gameId: string): Promise<ChampionshipGameSnapshot> {
  return requestJson(
    `/api/championship/games/${encodeURIComponent(gameId)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isChampionshipGameSnapshot,
    '锦标赛服务返回的对局画面不完整。',
    '锦标赛',
  );
}

export function postChampionshipStop(): Promise<ChampionshipState> {
  return requestJson(
    '/api/championship/stop',
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
    },
    isChampionshipState,
    '锦标赛服务返回的赛事状态不完整。',
    '锦标赛',
  );
}

export function postChampionshipResume(): Promise<ChampionshipState> {
  return requestJson(
    '/api/championship/resume',
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
    },
    isChampionshipState,
    '锦标赛服务返回的赛事状态不完整。',
    '锦标赛',
  );
}

export function fetchQualifierState(): Promise<QualifierState> {
  return requestJson(
    '/api/championship/qualifier/state',
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isQualifierState,
    '入围赛服务返回的状态不完整。',
    '入围赛',
  );
}

export function postQualifierStart(request: QualifierStartRequest): Promise<QualifierState> {
  return requestJson(
    '/api/championship/qualifier/start',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    isQualifierState,
    '入围赛服务返回的状态不完整。',
    '入围赛',
  );
}

export function postQualifierStop(): Promise<QualifierState> {
  return requestJson(
    '/api/championship/qualifier/stop',
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
    },
    isQualifierState,
    '入围赛服务返回的状态不完整。',
    '入围赛',
  );
}

export function postQualifierResume(): Promise<QualifierState> {
  return requestJson(
    '/api/championship/qualifier/resume',
    {
      method: 'POST',
      headers: { Accept: 'application/json' },
    },
    isQualifierState,
    '入围赛服务返回的状态不完整。',
    '入围赛',
  );
}

export function fetchQualifierGame(gameId: string): Promise<QualifierGameSnapshot> {
  return requestJson(
    `/api/championship/qualifier/games/${encodeURIComponent(gameId)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isQualifierGameSnapshot,
    '入围赛服务返回的对局画面不完整。',
    '入围赛',
  );
}

export function fetchChampionshipArchives(): Promise<ChampionshipArchiveListResponse> {
  return requestJson(
    '/api/championship/archives',
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isChampionshipArchiveListResponse,
    '锦标赛服务返回的历史档案列表不完整。',
    '锦标赛',
  );
}

export function fetchChampionshipArchive(id: string): Promise<ChampionshipArchive> {
  return requestJson(
    `/api/championship/archives/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isChampionshipArchive,
    '锦标赛服务返回的历史档案不完整。',
    '锦标赛',
  );
}

function historyQueryString(query: HistoryListQuery): string {
  const params = new URLSearchParams();
  params.set('limit', String(query.limit));
  params.set('offset', String(query.offset));
  params.set('mode', query.mode);
  params.set('status', query.status);
  const q = query.q.trim();
  if (q.length > 0) {
    params.set('q', q);
  }
  return params.toString();
}

export function fetchHistoryList(query: HistoryListQuery): Promise<HistoryListResponse> {
  return requestJson(
    `/api/history?${historyQueryString(query)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isHistoryListResponse,
    '历史服务返回的档案列表不完整。',
    '历史',
  );
}

export function fetchHistoryRecord(id: string): Promise<HistoryGameRecord> {
  return requestJson(
    `/api/history/${encodeURIComponent(id)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isHistoryGameRecord,
    '历史服务返回的对局档案不完整。',
    '历史',
  );
}

export function deleteHistoryRecord(id: string): Promise<HistoryDeleteResponse> {
  return requestJson(
    `/api/history/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    },
    isHistoryDeleteResponse,
    '历史服务返回的删除结果不完整。',
    '历史',
  );
}

export function clearHistory(): Promise<HistoryDeleteResponse> {
  return requestJson(
    '/api/history',
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    },
    isHistoryDeleteResponse,
    '历史服务返回的删除结果不完整。',
    '历史',
  );
}

export function fetchModelProfiles(): Promise<ModelProfileListResponse> {
  return requestJson(
    '/api/models',
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    },
    isModelProfileListResponse,
    '模型库服务返回的模型列表不完整。',
    '模型库',
  );
}

export function createModelProfile(
  request: ModelProfileCreateRequest,
): Promise<ModelProfileView> {
  return requestJson(
    '/api/models',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    isModelProfileView,
    '模型库服务返回的模型配置不完整。',
    '模型库',
  );
}

export function updateModelProfile(
  id: string,
  request: ModelProfileUpdateRequest,
): Promise<ModelProfileView> {
  return requestJson(
    `/api/models/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    isModelProfileView,
    '模型库服务返回的模型配置不完整。',
    '模型库',
  );
}

export function fetchThinkingOptions(
  request: ThinkingOptionsRequest,
): Promise<ThinkingOptionsResponse> {
  return requestJson(
    '/api/models/thinking-options',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    isThinkingOptionsResponse,
    '模型库服务返回的思考档位数据不完整。',
    '模型库',
  );
}

export function testModelProfile(request: ModelTestRequest): Promise<ModelTestResponse> {
  return requestJson(
    '/api/models/test',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    isModelTestResponse,
    '模型库服务返回的可用性测试结果不完整。',
    '模型库',
  );
}

export function deleteModelProfile(id: string): Promise<ModelProfileDeleteResponse> {
  return requestJson(
    `/api/models/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    },
    isModelProfileDeleteResponse,
    '模型库服务返回的删除结果不完整。',
    '模型库',
  );
}
