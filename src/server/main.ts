import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createDeps } from './app';
import { loadConfig } from './config';
import { isEmpty, seedDemoData } from './db/seed';
import { createHttpServer } from './http/server';
import { createLogger, describeError } from './logger';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);

  if (config.DATA_DIR !== 'memory') {
    await mkdir(path.dirname(path.resolve(config.DATA_DIR)), { recursive: true });
  }
  const deps = await createDeps({
    dataDir: config.DATA_DIR,
    publicUrl: config.PUBLIC_URL,
    sessionTtlHours: config.SESSION_TTL_HOURS,
  });

  if (config.SEED_DEMO && (await isEmpty(deps))) {
    await seedDemoData(deps);
    logger.info('Seeded fictional demo data');
  }

  const server = createHttpServer({
    deps,
    logger,
    webRoot: path.resolve('dist/web'),
    secureCookies: config.PUBLIC_URL.startsWith('https://'),
    graphiql: config.NODE_ENV === 'development',
  });
  server.listen(config.PORT, () => {
    logger.info('Signoff Ledger is ready', { url: config.PUBLIC_URL, port: config.PORT });
  });

  const shutdown = (signal: string): void => {
    logger.info('Shutting down', { signal });
    server.close(() => {
      deps.db.close().then(
        () => process.exit(0),
        (error: unknown) => {
          logger.error('Closing the database failed', describeError(error));
          process.exit(1);
        },
      );
    });
  };
  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  createLogger('error').error('Signoff Ledger failed to start', describeError(error));
  process.exit(1);
});
