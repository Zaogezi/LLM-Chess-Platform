import { existsSync } from 'node:fs';
import path from 'node:path';
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import type {
  ArenaState,
  ChampionshipArchiveListResponse,
  ChampionshipSetupResponse,
} from '../shared/protocol';
import type { ProviderFactory } from './providers/index';
import { ValidationError, validateStartRequest } from './providers/validate';
import { Arena, ArenaConflictError } from './arena/arena';
import {
  ChampionshipArchiveStore,
} from './championship/archive';
import { Championship, ChampionshipConflictError } from './championship/championship';
import { ChampionshipCheckpointStore } from './championship/checkpoint';
import { Qualifier, QualifierConflictError } from './championship/qualifier';
import { QualifierCheckpointStore } from './championship/qualifierCheckpoint';
import {
  ChampionshipSetupStore,
  parseChampionshipSetupSaveRequest,
} from './championship/setup';
import { validateQualifierStartRequest } from './championship/qualifierValidate';
import { validateChampionshipStartRequest } from './championship/validate';
import { HistoryQueryError, HistoryStore, validateHistoryQuery } from './history/history';
import { testModelAvailability } from './models/availability';
import {
  ModelProfileStore,
  validateProfileCreate,
  validateProfileUpdate,
} from './models/profiles';
import {
  fetchThinkingOptions,
  validateThinkingOptionsRequest,
} from './models/thinking-options';
import { Tournament, TournamentConflictError } from './tournament/tournament';
import { validateTournamentStartRequest } from './tournament/validate';

export interface CreateAppOptions {
  arena?: Arena;
  tournament?: Tournament;
  championship?: Championship;
  qualifier?: Qualifier;
  /** Persistent championship checkpoint store; defaults to in-memory. */
  checkpointStore?: ChampionshipCheckpointStore;
  /** Persistent qualifying-round checkpoint store; defaults to in-memory. */
  qualifierCheckpointStore?: QualifierCheckpointStore;
  /** Persisted pre-start championship setup; defaults to in-memory. */
  setupStore?: ChampionshipSetupStore;
  /** Historical championship editions; defaults to an in-memory store. */
  archiveStore?: ChampionshipArchiveStore;
  history?: HistoryStore;
  profiles?: ModelProfileStore;
  providerFactory?: ProviderFactory;
  /** When set, serve the built SPA from this directory (production mode). */
  clientDir?: string;
}

export interface AppBundle {
  app: Express;
  arena: Arena;
  tournament: Tournament;
  championship: Championship;
  qualifier: Qualifier;
  archiveStore: ChampionshipArchiveStore;
  setupStore: ChampionshipSetupStore;
  history: HistoryStore;
  profiles: ModelProfileStore;
}

function sendError(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

function safeInternalMessage(error: unknown): string {
  if (error instanceof ValidationError) return error.message;
  if (error instanceof ArenaConflictError) return error.message;
  return '服务器内部错误，请稍后重试';
}

function handleStateAction(res: Response, action: () => ArenaState): void {
  try {
    res.json(action());
  } catch (error) {
    if (error instanceof ArenaConflictError) {
      sendError(res, 409, error.message);
      return;
    }
    console.error('[arena] state action failed:', error instanceof Error ? error.message : error);
    sendError(res, 500, '对局操作失败，请稍后重试');
  }
}

function streamState<T>(
  req: Request,
  res: Response,
  getState: () => T,
  subscribe: (listener: (state: T) => void) => () => void,
): void {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const writeState = (state: T): void => {
    if (res.writableEnded) return;
    res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
  };

  res.write('retry: 2000\n\n');
  writeState(getState());

  const unsubscribe = subscribe(writeState);
  const heartbeat = setInterval(() => {
    if (res.writableEnded) return;
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, 15_000);
  heartbeat.unref?.();

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

export function createApp(options: CreateAppOptions = {}): AppBundle {
  const history = options.history ?? new HistoryStore();
  const profiles = options.profiles ?? new ModelProfileStore();
  const archiveStore =
    options.archiveStore ?? new ChampionshipArchiveStore({ filePath: null });
  const setupStore =
    options.setupStore ?? new ChampionshipSetupStore({ filePath: null });
  const arena =
    options.arena ??
    new Arena({
      providerFactory: options.providerFactory,
      onGameComplete: (completion) => {
        history.recordArenaGame(completion);
      },
    });
  const tournament =
    options.tournament ??
    new Tournament({
      providerFactory: options.providerFactory,
      onGameComplete: (completion) => {
        history.recordTournamentGame(completion);
      },
    });
  const championship =
    options.championship ??
    new Championship({
      providerFactory: options.providerFactory,
      checkpointStore: options.checkpointStore,
      onGameComplete: (completion) => {
        history.recordChampionshipGame(completion);
      },
      onArchive: (archive) => {
        archiveStore.save(archive);
      },
    });
  const qualifier =
    options.qualifier ??
    new Qualifier({
      providerFactory: options.providerFactory,
      checkpointStore: options.qualifierCheckpointStore,
      onGameComplete: (completion) => {
        history.recordQualifierGame(completion);
      },
    });
  const app = express();

  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '128kb' }));

  const api = express.Router();
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  });

  api.get('/health', (req, res) => {
    res.json({ ok: true, name: '楚河论弈', time: Date.now() });
  });

  api.get('/state', (req, res) => {
    res.json(arena.getState());
  });

  api.get('/events', (req, res) => {
    streamState(
      req,
      res,
      () => arena.getState(),
      (listener) => arena.onState(listener),
    );
  });

  api.post('/game/start', (req, res) => {
    try {
      const input = validateStartRequest(req.body, profiles);
      const state = arena.start(input);
      res.json(state);
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(res, 400, error.message);
        return;
      }
      if (error instanceof ArenaConflictError) {
        sendError(res, 409, error.message);
        return;
      }
      console.error('[arena] start failed:', error instanceof Error ? error.message : error);
      sendError(res, 500, '开局失败，请稍后重试');
    }
  });

  api.post('/game/pause', (req, res) => handleStateAction(res, () => arena.pause()));
  api.post('/game/resume', (req, res) => handleStateAction(res, () => arena.resume()));
  api.post('/game/retry', (req, res) => handleStateAction(res, () => arena.retry()));
  api.post('/game/reset', (req, res) => handleStateAction(res, () => arena.reset()));

  api.get('/tournament/state', (req, res) => {
    res.json(tournament.getState());
  });

  api.get('/tournament/events', (req, res) => {
    streamState(
      req,
      res,
      () => tournament.getState(),
      (listener) => tournament.onState(listener),
    );
  });

  api.get('/tournament/games/:id', (req, res) => {
    const snapshot = tournament.getGameSnapshot(req.params.id);
    if (!snapshot) {
      sendError(res, 404, '评测对局不存在');
      return;
    }
    res.json(snapshot);
  });

  api.post('/tournament/start', (req, res) => {
    try {
      const input = validateTournamentStartRequest(req.body, profiles);
      res.json(tournament.start(input));
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(res, 400, error.message);
        return;
      }
      if (error instanceof TournamentConflictError) {
        sendError(res, 409, error.message);
        return;
      }
      console.error(
        '[tournament] start failed:',
        error instanceof Error ? error.message : error,
      );
      sendError(res, 500, '启动自动评测失败，请稍后重试');
    }
  });

  api.post('/tournament/stop', async (req, res) => {
    try {
      res.json(await tournament.stop());
    } catch (error) {
      if (error instanceof TournamentConflictError) {
        sendError(res, 409, error.message);
        return;
      }
      console.error(
        '[tournament] stop failed:',
        error instanceof Error ? error.message : error,
      );
      sendError(res, 500, '终止自动评测失败，请稍后重试');
    }
  });

  api.get('/championship/state', (req, res) => {
    res.json(championship.getState());
  });

  api.get('/championship/events', (req, res) => {
    streamState(
      req,
      res,
      () => championship.getState(),
      (listener) => championship.onState(listener),
    );
  });

  api.get('/championship/games/:id', (req, res) => {
    const snapshot = championship.getGameSnapshot(req.params.id);
    if (!snapshot) {
      sendError(res, 404, '锦标赛对局不存在');
      return;
    }
    res.json(snapshot);
  });

  api.post('/championship/start', (req, res) => {
    try {
      const input = validateChampionshipStartRequest(req.body, profiles);
      res.json(championship.start(input));
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(res, 400, error.message);
        return;
      }
      if (error instanceof ChampionshipConflictError) {
        sendError(res, 409, error.message);
        return;
      }
      console.error(
        '[championship] start failed:',
        error instanceof Error ? error.message : error,
      );
      sendError(res, 500, '启动锦标赛失败，请稍后重试');
    }
  });

  api.post('/championship/stop', async (req, res) => {
    try {
      res.json(await championship.stop());
    } catch (error) {
      if (error instanceof ChampionshipConflictError) {
        sendError(res, 409, error.message);
        return;
      }
      console.error(
        '[championship] stop failed:',
        error instanceof Error ? error.message : error,
      );
      sendError(res, 500, '终止锦标赛失败，请稍后重试');
    }
  });

  api.post('/championship/resume', (req, res) => {
    try {
      res.json(championship.resume());
    } catch (error) {
      if (error instanceof ChampionshipConflictError) {
        sendError(res, 409, error.message);
        return;
      }
      console.error(
        '[championship] resume failed:',
        error instanceof Error ? error.message : error,
      );
      sendError(res, 500, '继续锦标赛失败，请稍后重试');
    }
  });

  api.get('/championship/setup', (req, res) => {
    const response: ChampionshipSetupResponse = { setup: setupStore.load() };
    res.json(response);
  });

  api.put('/championship/setup', (req, res) => {
    const request = parseChampionshipSetupSaveRequest(req.body);
    if (!request) {
      sendError(res, 400, '锦标赛配置数据不完整或格式不正确。');
      return;
    }
    const setup = setupStore.save(request);
    if (!setup) {
      console.error('[championship] failed to save setup snapshot');
      sendError(res, 500, '保存锦标赛配置失败，请稍后重试。');
      return;
    }
    const response: ChampionshipSetupResponse = { setup };
    res.json(response);
  });

  api.get('/championship/qualifier/state', (req, res) => {
    res.json(qualifier.getState());
  });

  api.get('/championship/qualifier/events', (req, res) => {
    streamState(
      req,
      res,
      () => qualifier.getState(),
      (listener) => qualifier.onState(listener),
    );
  });

  api.get('/championship/qualifier/games/:id', (req, res) => {
    const snapshot = qualifier.getGameSnapshot(req.params.id);
    if (!snapshot) {
      sendError(res, 404, '入围赛对局不存在');
      return;
    }
    res.json(snapshot);
  });

  api.post('/championship/qualifier/start', (req, res) => {
    try {
      const input = validateQualifierStartRequest(req.body, profiles);
      res.json(qualifier.start(input));
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(res, 400, error.message);
        return;
      }
      if (error instanceof QualifierConflictError) {
        sendError(res, 409, error.message);
        return;
      }
      console.error(
        '[qualifier] start failed:',
        error instanceof Error ? error.message : error,
      );
      sendError(res, 500, '启动入围赛失败，请稍后重试');
    }
  });

  api.post('/championship/qualifier/stop', async (req, res) => {
    try {
      res.json(await qualifier.stop());
    } catch (error) {
      if (error instanceof QualifierConflictError) {
        sendError(res, 409, error.message);
        return;
      }
      console.error(
        '[qualifier] stop failed:',
        error instanceof Error ? error.message : error,
      );
      sendError(res, 500, '终止入围赛失败，请稍后重试');
    }
  });

  api.post('/championship/qualifier/resume', (req, res) => {
    try {
      res.json(qualifier.resume());
    } catch (error) {
      if (error instanceof QualifierConflictError) {
        sendError(res, 409, error.message);
        return;
      }
      console.error(
        '[qualifier] resume failed:',
        error instanceof Error ? error.message : error,
      );
      sendError(res, 500, '继续入围赛失败，请稍后重试');
    }
  });

  api.get('/championship/archives', (req, res) => {
    const response: ChampionshipArchiveListResponse = {
      archives: archiveStore.list(),
      total: archiveStore.size,
    };
    res.json(response);
  });

  api.get('/championship/archives/:id', (req, res) => {
    const archive = archiveStore.get(req.params.id);
    if (!archive) {
      sendError(res, 404, '锦标赛档案不存在');
      return;
    }
    res.json(archive);
  });

  api.get('/models', (req, res) => {
    res.json({ profiles: profiles.list() });
  });

  api.post('/models/thinking-options', async (req, res) => {
    try {
      const setup = validateThinkingOptionsRequest(req.body, profiles);
      res.json(await fetchThinkingOptions(setup));
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(res, 400, error.message);
        return;
      }
      console.error(
        '[models] thinking options failed:',
        error instanceof Error ? error.message : error,
      );
      sendError(res, 500, '读取模型思考档位失败，请稍后重试');
    }
  });

  api.post('/models/test', async (req, res) => {
    try {
      const setup = validateThinkingOptionsRequest(req.body, profiles);
      res.json(await testModelAvailability(setup, options.providerFactory));
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(res, 400, error.message);
        return;
      }
      console.error(
        '[models] availability test failed:',
        error instanceof Error ? error.message : error,
      );
      sendError(res, 500, '测试模型可用性失败，请稍后重试');
    }
  });

  api.post('/models', (req, res) => {
    try {
      const input = validateProfileCreate(req.body);
      res.status(201).json(profiles.create(input));
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(res, 400, error.message);
        return;
      }
      console.error('[models] create failed:', error instanceof Error ? error.message : error);
      sendError(res, 500, '保存模型失败，请稍后重试');
    }
  });

  api.put('/models/:id', (req, res) => {
    try {
      const input = validateProfileUpdate(req.body);
      const updated = profiles.update(req.params.id, input);
      if (!updated) {
        sendError(res, 404, '模型库中不存在该模型');
        return;
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof ValidationError) {
        sendError(res, 400, error.message);
        return;
      }
      console.error('[models] update failed:', error instanceof Error ? error.message : error);
      sendError(res, 500, '更新模型失败，请稍后重试');
    }
  });

  api.delete('/models/:id', (req, res) => {
    const removed = profiles.remove(req.params.id);
    if (!removed) {
      sendError(res, 404, '模型库中不存在该模型');
      return;
    }
    res.json({ removed: 1, total: profiles.size });
  });

  api.get('/history', (req, res) => {
    try {
      res.json(history.list(validateHistoryQuery(req.query)));
    } catch (error) {
      if (error instanceof HistoryQueryError) {
        sendError(res, 400, error.message);
        return;
      }
      console.error('[history] list failed:', error instanceof Error ? error.message : error);
      sendError(res, 500, '读取历史对局失败，请稍后重试');
    }
  });

  api.get('/history/:id', (req, res) => {
    const record = history.get(req.params.id);
    if (!record) {
      sendError(res, 404, '历史对局不存在');
      return;
    }
    res.json(record);
  });

  api.delete('/history/:id', (req, res) => {
    const removed = history.remove(req.params.id);
    if (removed === 0) {
      sendError(res, 404, '历史对局不存在');
      return;
    }
    res.json({ removed, total: history.size });
  });

  api.delete('/history', (req, res) => {
    const removed = history.clear();
    res.json({ removed, total: 0 });
  });

  api.use((req, res) => {
    sendError(res, 404, '接口不存在');
  });

  app.use('/api', api);

  if (options.clientDir) {
    const clientDir = path.resolve(options.clientDir);
    const indexFile = path.join(clientDir, 'index.html');
    if (existsSync(indexFile)) {
      app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
      app.use((req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          next();
          return;
        }
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexFile, (error) => {
          if (error) next(error);
        });
      });
    } else {
      app.use((req, res, next) => {
        if (req.path.startsWith('/api/')) {
          next();
          return;
        }
        res
          .status(503)
          .type('html')
          .send(
            '<!doctype html><meta charset="utf-8"><title>楚河论弈</title>' +
              '<body style="font-family:serif;background:#19130e;color:#f2e4c9;padding:3rem">' +
              '<h1>前端尚未构建</h1><p>请先在项目目录运行 <code>npm run build</code>。</p></body>',
          );
      });
    }
  }

  // Express treats four-argument functions as error handlers. This must stay
  // last in the API pipeline; Vite middleware may be appended afterwards for
  // normal requests during development.
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (req.path.startsWith('/api/')) {
      const status =
        typeof error === 'object' &&
        error !== null &&
        'status' in error &&
        typeof (error as { status?: unknown }).status === 'number'
          ? (error as { status: number }).status
          : 500;
      const message = status === 400 ? '请求格式不正确，请检查 JSON 内容' : safeInternalMessage(error);
      sendError(res, status, message);
      return;
    }
    next(error);
  });

  return {
    app,
    arena,
    tournament,
    championship,
    qualifier,
    archiveStore,
    setupStore,
    history,
    profiles,
  };
}
