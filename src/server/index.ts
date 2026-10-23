import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { createApp } from './app';
import { ChampionshipArchiveStore } from './championship/archive';
import { ChampionshipCheckpointStore } from './championship/checkpoint';
import { QualifierCheckpointStore } from './championship/qualifierCheckpoint';

const production =
  process.argv.includes('--production') || process.env.NODE_ENV === 'production';

const rawPort = Number.parseInt(process.env.PORT ?? '4317', 10);
const port = Number.isFinite(rawPort) && rawPort > 0 && rawPort < 65_536 ? rawPort : 4317;
const host = process.env.HOST?.trim() || '127.0.0.1';

const clientDir = path.resolve(process.cwd(), 'dist/client');
const { app, arena, tournament, championship, qualifier } = createApp({
  ...(production ? { clientDir } : {}),
  checkpointStore: new ChampionshipCheckpointStore(),
  qualifierCheckpointStore: new QualifierCheckpointStore(),
  archiveStore: new ChampionshipArchiveStore(),
});
const server = createServer(app);

let vite: import('vite').ViteDevServer | null = null;
if (!production) {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { server },
    },
    appType: 'spa',
  });
  app.use(vite.middlewares);
  app.use(async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    try {
      const template = readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
      const html = await vite!.transformIndexHtml(req.originalUrl, template);
      res.status(200).set({ 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' }).end(html);
    } catch (error) {
      next(error);
    }
  });
}

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[楚河论弈] 端口 ${port} 已被占用，请设置 PORT 环境变量后重试。`);
  } else {
    console.error('[楚河论弈] 服务启动失败：', error.message);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`[楚河论弈] ${production ? '生产' : '开发'}模式已启动：http://${host}:${port}`);
  if (!production) {
    console.log('[楚河论弈] Vite HMR 已连接；修改前端会自动刷新。');
  }
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[楚河论弈] 收到 ${signal}，正在关闭服务…`);
  arena.dispose();
  tournament.dispose();
  championship.dispose();
  qualifier.dispose();
  await vite?.close().catch(() => undefined);
  server.close(() => process.exit(0));
  setTimeout(() => {
    server.closeAllConnections();
    process.exit(0);
  }, 700).unref();
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
