/**
 * Shared wire protocol between the Express server and the browser client.
 * Nothing in this file may contain secrets: the server only ever exposes the
 * public model summary produced from a `ModelSetup`.
 */

export type Side = 'red' | 'black';

export type PieceType =
  | 'rook'
  | 'horse'
  | 'elephant'
  | 'advisor'
  | 'king'
  | 'cannon'
  | 'pawn';

export type ProviderKind = 'openai' | 'anthropic';

export type Phase = 'idle' | 'running' | 'paused' | 'error' | 'finished';

export type ResultReason =
  | 'checkmate'
  | 'stalemate'
  | 'repetition'
  | 'dead-position'
  | 'no-progress'
  | 'max-plies'
  /** The side to move exceeded the per-step request timeout without replying. */
  | 'timeout'
  /** The side to move exhausted its attempts without producing a legal move. */
  | 'forfeit';

/** Built-in fallback levels. Models may expose any other level names via their API. */
export const THINKING_LEVELS = ['quick', 'balanced', 'deep'] as const;
/** Prompt/timeout semantics always resolve to one of these three tiers. */
export type ThinkingTier = (typeof THINKING_LEVELS)[number];
/** A selected level name, either built-in or discovered from a model API. */
export type ThinkingLevel = string;
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'balanced';
export const DEFAULT_THINKING_LEVELS: readonly ThinkingLevel[] = THINKING_LEVELS;
/**
 * Every model speaking the OpenAI Chat Completions protocol can be configured
 * with the standard `reasoning_effort` values, even when its `/models` catalog
 * does not publish reasoning metadata.
 */
export const OPENAI_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;
export const DEFAULT_OPENAI_REASONING_EFFORT: ThinkingLevel = 'medium';
/** Maximum single-step wait per semantic tier, shared by server and UI copy. */
export const THINKING_LEVEL_TIMEOUT_SECONDS: Record<ThinkingTier, number> = {
  quick: 60,
  balanced: 120,
  deep: 240,
};

const THINKING_OFF_WORDS = new Set([
  'off',
  'false',
  'none',
  'no',
  'disabled',
  'disable',
  '关闭',
  '关',
  '无',
]);
const THINKING_QUICK_HINTS = /(quick|minimal|low|fast|light|off|none|false|低|快|轻|关)/i;
const THINKING_DEEP_HINTS = /(deep|high|xhigh|max|heavy|strong|on|true|高|深|重|开)/i;
const NATIVE_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);

/** Map any API-provided level name to the three prompt/timeout tiers. */
export function thinkingTierOf(level: ThinkingLevel): ThinkingTier {
  const value = level.trim().toLocaleLowerCase();
  if (!value || value === 'balanced' || value === 'medium' || value === 'standard') {
    return 'balanced';
  }
  if (value === 'quick' || value === 'fast' || THINKING_OFF_WORDS.has(value)) {
    return 'quick';
  }
  if (value === 'deep' || value === 'high' || value === 'xhigh' || value === 'max') {
    return 'deep';
  }
  if (THINKING_QUICK_HINTS.test(value)) return 'quick';
  if (THINKING_DEEP_HINTS.test(value)) return 'deep';
  return 'balanced';
}

export function isThinkingOff(level: ThinkingLevel): boolean {
  return THINKING_OFF_WORDS.has(level.trim().toLocaleLowerCase());
}

export function thinkingTimeoutSecondsFor(level: ThinkingLevel): number {
  return THINKING_LEVEL_TIMEOUT_SECONDS[thinkingTierOf(level)];
}

/** Exact `reasoning_effort` value to send, or null when thinking is disabled. */
export function nativeReasoningEffort(level: ThinkingLevel): string | null {
  const value = level.trim().toLocaleLowerCase();
  if (isThinkingOff(level)) return null;
  if (NATIVE_EFFORTS.has(value)) return value;
  return API_REASONING_EFFORT[thinkingTierOf(level)];
}

/** Anthropic extended-thinking budget tokens, or null when thinking is disabled. */
export function nativeThinkingBudget(level: ThinkingLevel): number | null {
  if (isThinkingOff(level)) return null;
  return API_THINKING_BUDGET_TOKENS[thinkingTierOf(level)];
}

/**
 * Native API reasoning settings used when a model opts into "API 推理参数".
 * OpenAI-compatible Chat Completions uses `reasoning_effort`; Anthropic uses
 * extended thinking with a token budget. The UI shows these values verbatim.
 */
export const API_REASONING_EFFORT: Record<ThinkingTier, 'low' | 'medium' | 'high'> = {
  quick: 'low',
  balanced: 'medium',
  deep: 'high',
};
export const API_THINKING_BUDGET_TOKENS: Record<ThinkingTier, number> = {
  quick: 1024,
  balanced: 2048,
  deep: 4096,
};
/** Reserve enough max_tokens for the final JSON answer outside the thinking budget. */
export const API_THINKING_OUTPUT_TOKENS = 1024;

export interface ModelSetup {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  /** Kept in server memory only. Never serialized into ArenaState. */
  apiKey: string;
  /** Optional public label shown in plaques and archived history. */
  displayName?: string;
  /** Omitted by older clients/callers; the server falls back to balanced. */
  thinkingLevel?: ThinkingLevel;
  /**
   * When true, send provider-native reasoning parameters derived from the
   * thinking level. Defaults to false for maximum OpenAI-compatible support.
   */
  apiReasoning?: boolean;
}

export interface GameSettings {
  moveDelayMs: number;
  maxAttempts: number;
}

/**
 * A reference to a model saved in the server-side model library. The API key
 * is resolved on the server and is never sent back to the browser.
 */
export interface ModelProfileSelection {
  profileId: string;
  /** Per-game overrides; omitted values use the saved profile defaults. */
  thinkingLevel?: ThinkingLevel;
  apiReasoning?: boolean;
}

export type GameSideRequest = ModelSetup | ModelProfileSelection;

export interface StartGameRequest {
  red: GameSideRequest;
  black: GameSideRequest;
  settings?: Partial<GameSettings>;
}

export interface PieceView {
  id: string;
  type: PieceType;
  side: Side;
}

export interface MoveView {
  ply: number;
  side: Side;
  ucci: string;
  notation: string;
  pieceLabel: string;
  capturedLabel: string | null;
  reason: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  at: number;
}

export interface ModelView {
  provider: ProviderKind;
  model: string;
  displayName: string;
  thinkingLevel: ThinkingLevel;
  /** Whether this match sends provider-native reasoning parameters. */
  apiReasoning: boolean;
  keyConfigured: boolean;
  thinking: boolean;
  thinkingSince: number | null;
  lastLatencyMs: number | null;
  reason: string | null;
  totalTokensIn: number;
  totalTokensOut: number;
  attempts: number;
  lastError: string | null;
}

export interface GameResult {
  winner: Side | null;
  reason: ResultReason;
  text: string;
}

export interface ArenaError {
  side: Side;
  message: string;
  /** True when the failure is a provider quota/credit error (pause, do not skip). */
  quota?: boolean;
}

export interface ArenaState {
  revision: number;
  phase: Phase;
  matchId: string | null;
  fen: string;
  /** 90 squares, row-major. Index 0 is a0 (red's bottom-left). */
  board: (PieceView | null)[];
  turn: Side;
  moveNumber: number;
  ply: number;
  checked: boolean;
  lastMove: { fromUcci: string; toUcci: string; side: Side } | null;
  moves: MoveView[];
  models: Record<Side, ModelView | null>;
  result: GameResult | null;
  error: ArenaError | null;
  settings: GameSettings;
}

export interface ApiError {
  error: string;
}

export const DEFAULT_SETTINGS: GameSettings = {
  moveDelayMs: 1000,
  maxAttempts: 3,
};

/* ------------------------------------------------------------------ */
/* Saved model library                                                 */
/* ------------------------------------------------------------------ */

export const MODEL_PROFILE_NAME_MAX = 80;
export const MODEL_PROFILES_MAX = 64;

/**
 * Public representation of a saved model. The API key exists only in the
 * server-side store; clients see whether one is configured plus a short hint.
 */
export interface ModelProfileView {
  id: string;
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  /** Levels discovered from the model API, or built-in fallbacks. */
  thinkingLevels: ThinkingLevel[];
  apiReasoning: boolean;
  keyConfigured: boolean;
  /** Last few characters only, e.g. "••••1a2b"; never the full key. */
  keyHint: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ModelProfileListResponse {
  profiles: ModelProfileView[];
}

export interface ModelProfileCreateRequest {
  name: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  thinkingLevel?: ThinkingLevel;
  /** Omit to use the built-in levels; pass values discovered from the API. */
  thinkingLevels?: ThinkingLevel[];
  apiReasoning?: boolean;
  apiKey?: string;
}

/**
 * Update payload. Omit `apiKey` to keep the stored secret, send a string to
 * replace it, or set `clearApiKey` to remove it (for keyless local services).
 */
export interface ModelProfileUpdateRequest extends ModelProfileCreateRequest {
  clearApiKey?: boolean;
}

export interface ModelProfileDeleteResponse {
  removed: number;
  total: number;
}

/* ------------------------------------------------------------------ */
/* Thinking-level metadata read from a model service                  */
/* ------------------------------------------------------------------ */

export type ThinkingOptionsSource = 'ollama' | 'openrouter' | 'api' | 'fallback';

export interface ThinkingOptionsRequest {
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  /** Used only for this metadata request; never persisted by this endpoint. */
  apiKey?: string;
  /** When present, the stored profile key supplies a blank API key. */
  profileId?: string;
}

export interface ThinkingOptionsResponse {
  source: ThinkingOptionsSource;
  /** Exact level names the API says this model supports, or built-ins. */
  options: ThinkingLevel[];
  defaultLevel: ThinkingLevel | null;
  note: string;
}

/* ------------------------------------------------------------------ */
/* Model availability probe                                            */
/* ------------------------------------------------------------------ */

/** Maximum time the library's "测试" action waits for a model reply. */
export const MODEL_TEST_TIMEOUT_SECONDS = 30;

export interface ModelTestRequest {
  /** Reuse a saved model-library profile, including its stored key. */
  profileId?: string;
  provider?: ProviderKind;
  baseUrl?: string;
  model?: string;
  /** Omit to reuse the saved profile key when profileId is present. */
  apiKey?: string;
  thinkingLevel?: ThinkingLevel;
  apiReasoning?: boolean;
}

export interface ModelTestResponse {
  ok: boolean;
  provider: ProviderKind;
  model: string;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
  /** Success sentence or a key-redacted failure reason. */
  message: string;
  /** First part of the model reply for a successful probe; empty on failure. */
  replyPreview: string;
  testedAt: number;
}

/* ------------------------------------------------------------------ */
/* Automated round-robin tournament                                    */
/* ------------------------------------------------------------------ */

export type TournamentPhase = 'idle' | 'running' | 'finished' | 'stopped' | 'error';

export type TournamentGameStatus =
  | 'scheduled'
  | 'running'
  | 'finished'
  | 'failed'
  | 'canceled';

export const TOURNAMENT_MIN_MODELS = 2;
export const TOURNAMENT_MAX_MODELS = 8;
export const TOURNAMENT_MAX_GAMES_PER_PAIR = 20;

/** Standings points used by both the server ranking and the UI legend. */
export const TOURNAMENT_POINTS = {
  win: 3,
  draw: 1,
  loss: 0,
} as const;

/** One entrant in the automated round-robin. `name` labels it in the table. */
export interface TournamentModelInput extends ModelSetup {
  name: string;
}

/** A saved model-library profile used as a tournament entrant. */
export interface TournamentProfileInput extends ModelProfileSelection {
  name: string;
}

export type TournamentModelRequest = TournamentModelInput | TournamentProfileInput;

export interface TournamentStartRequest {
  models: TournamentModelRequest[];
  /** Number of games for every pair; colours alternate each game. */
  gamesPerPair: number;
}

/** Public model summary: never contains the API key. */
export interface TournamentModelView {
  id: string;
  name: string;
  provider: ProviderKind;
  model: string;
  thinkingLevel: ThinkingLevel;
  apiReasoning: boolean;
  keyConfigured: boolean;
}

export interface TournamentGameView {
  id: string;
  /** 1-based pairing number. */
  pairIndex: number;
  /** 1-based game number inside this pairing. */
  gameIndex: number;
  redModelId: string;
  blackModelId: string;
  redName: string;
  blackName: string;
  status: TournamentGameStatus;
  plies: number;
  /** Set only when a finished game has a winner. */
  winnerModelId: string | null;
  result: GameResult | null;
  error: string | null;
  /** Side whose model failed, when the server could attribute it. */
  failedSide: Side | null;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number;
  /** Both sides combined, for the match detail line. */
  tokensIn: number;
  tokensOut: number;
  redTokensIn: number;
  redTokensOut: number;
  blackTokensIn: number;
  blackTokensOut: number;
}

export interface TournamentStanding {
  rank: number;
  modelId: string;
  name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  failed: number;
  points: number;
  redGames: number;
  blackGames: number;
  tokensIn: number;
  tokensOut: number;
}

export interface TournamentState {
  revision: number;
  phase: TournamentPhase;
  tournamentId: string | null;
  models: TournamentModelView[];
  games: TournamentGameView[];
  standings: TournamentStanding[];
  totalGames: number;
  /** Finished + failed + canceled games. */
  processedGames: number;
  /** Fully adjudicated games counted in the win/draw/loss table. */
  completedGames: number;
  currentGameId: string | null;
  gamesPerPair: number;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
}

/**
 * A single tournament/championship game plus the board that produced it. The
 * board is available while the game is being played and for the most recently
 * finished game, which lets the spectator page show a final position too.
 */
export interface GameBoardSnapshotBase {
  arena: ArenaState | null;
  /** True while the scheduler is currently playing this game. */
  live: boolean;
}

export interface TournamentGameSnapshot extends GameBoardSnapshotBase {
  game: TournamentGameView;
}

export interface ChampionshipGameSnapshot extends GameBoardSnapshotBase {
  game: ChampionshipGameView;
}

/** A qualifying-round game plus its board, for the spectator page. */
export interface QualifierGameSnapshot extends GameBoardSnapshotBase {
  game: ChampionshipGameView;
}

/* ------------------------------------------------------------------ */
/* 16-entrant championship: seeded pots, single round-robin groups,     */
/* and a six-game knockout series with a 3-point target                */
/* ------------------------------------------------------------------ */

export type ChampionshipPhase =
  | 'idle'
  | 'running'
  | 'finished'
  | 'stopped'
  | 'error'
  /** Suspended automatically when a provider reports an exhausted quota. */
  | 'paused'
  /** A checkpoint restored after a restart/power loss, waiting to be resumed. */
  | 'interrupted';
export type ChampionshipStage =
  | 'qualifier'
  | 'group'
  | 'quarterfinal'
  | 'semifinal'
  | 'final';
export type ChampionshipKnockoutStage = Exclude<
  ChampionshipStage,
  'qualifier' | 'group'
>;
export type ChampionshipGroupId = 'A' | 'B' | 'C' | 'D';
export type ChampionshipSeriesStatus = 'pending' | 'running' | 'finished' | 'stopped';
export type ChampionshipSeriesDecision = 'points' | 'overtime' | 'ranking';

export const CHAMPIONSHIP_ENTRANTS = 16;
export const CHAMPIONSHIP_POOLS = 4;
export const CHAMPIONSHIP_ENTRANTS_PER_POOL = 4;
export const CHAMPIONSHIP_GROUP_SIZE = 4;
/** Single round-robin: 4 players → C(4,2) = 6 games per group. */
export const CHAMPIONSHIP_GROUP_GAMES_PER_GROUP = 6;
export const CHAMPIONSHIP_GROUP_GAMES = 24;
export const CHAMPIONSHIP_GROUP_GAMES_PER_ENTRANT = 3;
export const CHAMPIONSHIP_QUALIFIERS_PER_GROUP = 2;
export const CHAMPIONSHIP_SERIES_COUNT = 7;
/** Every knockout round uses the same base series length, including the final. */
export const CHAMPIONSHIP_SERIES_GAME_LIMIT = 6;
/** First side to reach this many series points advances. */
export const CHAMPIONSHIP_SERIES_POINTS_TARGET = 3;
/** A decisive game awards one series point to its winner. */
export const CHAMPIONSHIP_SERIES_WIN_POINTS = 1;
/** A draw awards one series point to both sides. */
export const CHAMPIONSHIP_SERIES_DRAW_POINTS = 1;
/**
 * Normal tournament ceiling: 24 group games plus 7 series × 6 games. If both
 * quarterfinalists have identical group-phase rankings the cap cannot decide,
 * and the series continues with extra games until a winner emerges.
 */
export const CHAMPIONSHIP_MAX_GAMES =
  CHAMPIONSHIP_GROUP_GAMES + CHAMPIONSHIP_SERIES_COUNT * CHAMPIONSHIP_SERIES_GAME_LIMIT;

/** Kept as a stage-aware helper so every bracket node reads the same rule. */
export function championshipSeriesGameLimit(
  _stage?: ChampionshipKnockoutStage,
): number {
  return CHAMPIONSHIP_SERIES_GAME_LIMIT;
}

export function championshipSeriesFormatLabel(
  _stage?: ChampionshipKnockoutStage,
): string {
  return `${CHAMPIONSHIP_SERIES_GAME_LIMIT} 局 · 先到 ${CHAMPIONSHIP_SERIES_POINTS_TARGET} 分`;
}

export const CHAMPIONSHIP_GROUPS: readonly ChampionshipGroupId[] = ['A', 'B', 'C', 'D'];
export const CHAMPIONSHIP_SEED_POOLS: readonly number[] = [1, 2, 3, 4];

/** How many games/series may run at the same time. */
export const CHAMPIONSHIP_MIN_CONCURRENCY = 1;
export const CHAMPIONSHIP_MAX_CONCURRENCY = 8;
/** Recommended starting value for the setup form; API callers default to serial. */
export const CHAMPIONSHIP_DEFAULT_CONCURRENCY = 4;

/* ------------------------------------------------------------------ */
/* Qualifying round: 10 models in two groups, top two enter seed pool 4 */
/* ------------------------------------------------------------------ */

export type QualifierGroupId = 'A' | 'B';
export type QualifierPhase =
  | 'idle'
  | 'running'
  | 'finished'
  | 'stopped'
  | 'error'
  /** Suspended automatically when a provider reports an exhausted quota. */
  | 'paused'
  /** A checkpoint restored after a restart/power loss, waiting to be resumed. */
  | 'interrupted';

/** Ten challengers, two groups of five, single round-robin in each group. */
export const CHAMPIONSHIP_QUALIFIER_ENTRANTS = 10;
export const CHAMPIONSHIP_QUALIFIER_GROUPS: readonly QualifierGroupId[] = ['A', 'B'];
export const CHAMPIONSHIP_QUALIFIER_GROUP_SIZE = 5;
/** C(5,2) = 10 games per group; 20 in total, four per entrant. */
export const CHAMPIONSHIP_QUALIFIER_GROUP_GAMES_PER_GROUP = 10;
export const CHAMPIONSHIP_QUALIFIER_GROUP_GAMES = 20;
export const CHAMPIONSHIP_QUALIFIER_GAMES_PER_ENTRANT = 4;
/** Top two of every group join the fourth seed pool of the main draw. */
export const CHAMPIONSHIP_QUALIFIER_ADVANCE_PER_GROUP = 2;

export interface QualifierModelInput extends ModelSetup {
  name: string;
}

export interface QualifierProfileInput extends ModelProfileSelection {
  name: string;
}

export type QualifierModelRequest = QualifierModelInput | QualifierProfileInput;

export interface QualifierGroupInput {
  id: QualifierGroupId;
  /** Five entrant display names. */
  entrantNames: string[];
}

export interface QualifierStartRequest {
  entrants: QualifierModelRequest[];
  groups: QualifierGroupInput[];
  /**
   * Max simultaneous games. Omitted means serial for API callers; the UI uses
   * the same 1–8 setting as the main championship.
   */
  concurrency?: number;
}

/** Public qualifier entrant summary: never contains the API key. */
export interface QualifierEntrantView {
  id: string;
  name: string;
  provider: ProviderKind;
  model: string;
  thinkingLevel: ThinkingLevel;
  apiReasoning: boolean;
  keyConfigured: boolean;
  groupId: QualifierGroupId;
}

/** One qualifying group's live table. */
export interface QualifierGroupView {
  id: QualifierGroupId;
  entrantIds: string[];
  standings: TournamentStanding[];
  /** True once all 10 group games have finished or failed (not canceled). */
  complete: boolean;
  /** The top two, only present once the group is complete. */
  qualifiedModelIds: string[];
}

export interface QualifierState {
  revision: number;
  phase: QualifierPhase;
  qualifierId: string | null;
  entrants: QualifierEntrantView[];
  groups: QualifierGroupView[];
  games: ChampionshipGameView[];
  groupGamesTotal: number;
  groupGamesProcessed: number;
  /** Finished + failed + canceled games. */
  processedGames: number;
  /** Fully adjudicated games counted in a win/draw table. */
  completedGames: number;
  /** Every game currently being played. */
  currentGameIds: string[];
  concurrency: number;
  /** Four qualifier model ids, in group order (A1, B1, A2, B2). */
  qualifiedModelIds: string[];
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** True when a stopped/error/interrupted run can continue from its checkpoint. */
  resumable: boolean;
  /** Epoch ms of the latest successful checkpoint write, or null. */
  checkpointSavedAt: number | null;
}


export interface ChampionshipModelInput extends TournamentModelInput {
  /** 1–4; the user-defined seed pot this entrant belongs to. */
  seedPool: number;
}

export interface ChampionshipProfileInput extends TournamentProfileInput {
  seedPool: number;
}

export type ChampionshipEntrantRequest = ChampionshipModelInput | ChampionshipProfileInput;

export interface ChampionshipGroupInput {
  id: ChampionshipGroupId;
  /** Four entrant display names, exactly one from each seed pot. */
  entrantNames: string[];
}

export interface ChampionshipStartRequest {
  entrants: ChampionshipEntrantRequest[];
  groups: ChampionshipGroupInput[];
  /**
   * Max simultaneous games (group stage) or series (knockout round).
   * Omitted means serial for API callers; the UI starts at 4.
   */
  concurrency?: number;
}

export interface ChampionshipEntrantView extends TournamentModelView {
  seedPool: number;
  groupId: ChampionshipGroupId;
}

export interface ChampionshipGameView extends TournamentGameView {
  stage: ChampionshipStage;
  /** Present for group-stage and qualifying-round games. */
  groupId: ChampionshipGroupId | null;
  /** Present for knockout games only. */
  seriesId: string | null;
}

export interface ChampionshipSeriesSide {
  modelId: string;
  name: string;
}

export interface ChampionshipSeriesView {
  id: string;
  stage: ChampionshipKnockoutStage;
  label: string;
  /** 1-based position inside its stage. */
  slot: number;
  status: ChampionshipSeriesStatus;
  left: ChampionshipSeriesSide | null;
  right: ChampionshipSeriesSide | null;
  /** Decisive-game wins; a draw does not count as a win. */
  leftWins: number;
  rightWins: number;
  /** Series points: a win is worth 1 to its winner, a draw 1 to each side. */
  leftPoints: number;
  rightPoints: number;
  draws: number;
  failed: number;
  playedGames: number;
  /** Base cap for every knockout series (6); extra games are possible after a tie. */
  maxGames: number;
  /**
   * Both sides reached the 3-point target on the same game (three draws).
   * From here the next decisive game wins the series.
   */
  overtime: boolean;
  /**
   * The 6-game cap was reached and both group-phase rankings are identical, so
   * the series keeps playing past the cap until a decisive game appears.
   */
  extra: boolean;
  winnerModelId: string | null;
  decision: ChampionshipSeriesDecision | null;
}

export interface ChampionshipGroupView {
  id: ChampionshipGroupId;
  entrantIds: string[];
  standings: TournamentStanding[];
  /** True once all 6 group games have finished or failed (not canceled). */
  complete: boolean;
  /** The top two, only present once the group is complete. */
  qualifiedModelIds: string[];
}

export interface ChampionshipState {
  revision: number;
  phase: ChampionshipPhase;
  championshipId: string | null;
  stage: ChampionshipStage | null;
  entrants: ChampionshipEntrantView[];
  groups: ChampionshipGroupView[];
  series: ChampionshipSeriesView[];
  games: ChampionshipGameView[];
  groupGamesTotal: number;
  groupGamesProcessed: number;
  seriesTotal: number;
  seriesProcessed: number;
  scheduledGames: number;
  /** Finished + failed + canceled games. */
  processedGames: number;
  /** Fully adjudicated games counted in a win/draw table. */
  completedGames: number;
  /** First active game, kept for older clients. */
  currentGameId: string | null;
  /** Every game currently being played (1–8 entries). */
  currentGameIds: string[];
  /** First active knockout series, kept for older clients. */
  currentSeriesId: string | null;
  /** Every knockout series currently being played (same-round concurrency). */
  currentSeriesIds: string[];
  /** Configured simultaneous game/series limit. */
  concurrency: number;
  championModelId: string | null;
  championName: string | null;
  error: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  /** True when a stopped/error/interrupted run can continue from its checkpoint. */
  resumable: boolean;
  /** Epoch ms of the latest successful checkpoint write, or null. */
  checkpointSavedAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Championship setup draft (survives app restarts before the start)   */
/* ------------------------------------------------------------------ */

/**
 * One editable championship seat as the setup page holds it. Seats either
 * reference a saved model-library profile or carry an inline model setup.
 */
export interface ChampionshipSetupDraft {
  id: string;
  profileId: string | null;
  name: string;
  /** Client preset key (e.g. `deepseek`, `openai`) or `custom`. */
  preset: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  thinkingLevel: ThinkingLevel;
  thinkingOptions: ThinkingLevel[];
  apiReasoning: boolean;
  apiKey: string;
  /** 1–4; qualifying seats use 4. */
  seedPool: number;
  /** `A`/`B` for a qualifying seat, null for a seeded seat. */
  qualifierGroup: QualifierGroupId | null;
}

export interface ChampionshipSetupDrawSlot {
  /** Seed pool the entrant came from (1–4). */
  pool: number;
  draftId: string;
  name: string;
}

export interface ChampionshipSetupDrawGroup {
  id: ChampionshipGroupId;
  /** Exactly one slot per seed pool, ordered 甲→丁. */
  slots: ChampionshipSetupDrawSlot[];
}

export interface ChampionshipSetupDraw {
  groups: ChampionshipSetupDrawGroup[];
  groupByDraftId: Record<string, ChampionshipGroupId>;
}

/** Last saved setup form: seats, optional draw and the concurrency choice. */
export interface ChampionshipSetupSnapshot {
  version: 1;
  savedAt: number;
  drafts: ChampionshipSetupDraft[];
  draw: ChampionshipSetupDraw | null;
  concurrency: number;
}

export interface ChampionshipSetupSaveRequest {
  drafts: ChampionshipSetupDraft[];
  draw: ChampionshipSetupDraw | null;
  concurrency: number;
}

export interface ChampionshipSetupResponse {
  setup: ChampionshipSetupSnapshot | null;
}

/* ------------------------------------------------------------------ */
/* Championship archive (past editions)                                */
/* ------------------------------------------------------------------ */

/** Terminal snapshot phases kept for the 对局管理 archive. */
export type ChampionshipArchivePhase = 'finished' | 'stopped' | 'error' | 'interrupted';

/** Compact row shown in the 对局管理 → 锦标赛档案 list. */
export interface ChampionshipArchiveSummary {
  championshipId: string;
  phase: ChampionshipArchivePhase;
  startedAt: number;
  finishedAt: number | null;
  archivedAt: number;
  championModelId: string | null;
  championName: string | null;
  error: string | null;
  entrantNames: string[];
  completedGames: number;
  processedGames: number;
  scheduledGames: number;
  seriesProcessed: number;
  seriesTotal: number;
}

/**
 * One archived edition: everything needed to redraw the group tables and the
 * knockout bracket without replaying it. It intentionally contains no API keys
 * and no move lists; full games remain in the history archive.
 */
export interface ChampionshipArchive extends ChampionshipArchiveSummary {
  version: 1;
  entrants: ChampionshipEntrantView[];
  groups: ChampionshipGroupView[];
  series: ChampionshipSeriesView[];
  games: ChampionshipGameView[];
  groupGamesTotal: number;
  groupGamesProcessed: number;
}

export interface ChampionshipArchiveListResponse {
  archives: ChampionshipArchiveSummary[];
  total: number;
}

/* ------------------------------------------------------------------ */
/* Completed-game archive (management page)                            */
/* ------------------------------------------------------------------ */

export type HistoryMode = 'arena' | 'tournament' | 'championship';
export type HistoryStatus = 'finished' | 'failed';

export interface HistoryPlayer {
  name: string;
  provider: ProviderKind;
  model: string;
  thinkingLevel: ThinkingLevel;
  apiReasoning: boolean;
}

export interface HistoryTournamentRef {
  tournamentId: string;
  pairIndex: number;
  gameIndex: number;
  gamesPerPair: number;
}

export interface HistoryChampionshipRef {
  /** Championship id, or the qualifying-round id for `stage: 'qualifier'`. */
  championshipId: string;
  stage: ChampionshipStage;
  groupId: ChampionshipGroupId | null;
  seriesId: string | null;
  /** Group pairing number (1–10 in qualifying, 1–6 in groups) or series slot. */
  pairIndex: number;
  gameIndex: number;
}

export interface HistoryGameSummary {
  id: string;
  mode: HistoryMode;
  status: HistoryStatus;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  red: HistoryPlayer;
  black: HistoryPlayer;
  result: GameResult | null;
  winnerSide: Side | null;
  failedSide: Side | null;
  error: string | null;
  plies: number;
  tokensIn: number;
  tokensOut: number;
  redTokensIn: number;
  redTokensOut: number;
  blackTokensIn: number;
  blackTokensOut: number;
  /** Present only for games played by the automated round-robin. */
  tournament: HistoryTournamentRef | null;
  /** Present only for games played by the 16-entrant championship. */
  championship?: HistoryChampionshipRef | null;
}

export interface HistoryGameRecord extends HistoryGameSummary {
  /** Full move list for the management detail view. */
  moves: MoveView[];
}

export interface HistoryStats {
  total: number;
  arena: number;
  tournament: number;
  championship: number;
  finished: number;
  failed: number;
  totalPlies: number;
  firstAt: number | null;
  lastAt: number | null;
}

export interface HistoryListResponse {
  records: HistoryGameSummary[];
  total: number;
  limit: number;
  offset: number;
  stats: HistoryStats;
}

export interface HistoryDeleteResponse {
  removed: number;
  total: number;
}

export const HISTORY_PAGE_SIZE_DEFAULT = 20;
export const HISTORY_PAGE_SIZE_MAX = 100;

export const START_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1';
