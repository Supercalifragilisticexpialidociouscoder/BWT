import http from 'node:http';
import { env } from './config/env';
import { createApp } from './app';
import { connectDb, disconnectDb } from './db/connect';
import { initRealtime } from './realtime/socket';
import { logger } from './lib/logger';

async function main() {
  await connectDb();
  const app = createApp();
  const server = http.createServer(app);
  const io = initRealtime(server);
  server.listen(env.PORT, () => logger.info('api listening', { port: env.PORT, origins: env.webOrigins }));

  const shutdown = async (signal: string) => {
    logger.info('shutting down', { signal });
    io.close();
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('failed to start', { err });
  process.exit(1);
});
