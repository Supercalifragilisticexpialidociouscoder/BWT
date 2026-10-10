import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { ALL_MODELS } from '../models';

export async function connectDb(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  // Integrity guarantees (one live ticket per participant, one active check-in per ticket, …)
  // depend on unique indexes, so make sure they exist before serving traffic.
  await Promise.all(ALL_MODELS.map((m) => m.createIndexes()));
  logger.info('database connected', { db: conn.connection.name });
  return conn;
}

export async function disconnectDb(): Promise<void> {
  await mongoose.disconnect();
}
