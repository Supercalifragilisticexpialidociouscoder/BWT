import type { Types } from 'mongoose';
import { AuditLog } from '../models';
import { logger } from './logger';

export interface AuditInput {
  actor: Types.ObjectId | null | undefined;
  action: string;
  entityType: string;
  entityId: Types.ObjectId;
  event?: Types.ObjectId | null;
  summary: string;
  meta?: Record<string, unknown>;
}

/** Append-only record of an administrative action. Failures are logged, never thrown. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await AuditLog.create({
      actor: input.actor ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      event: input.event ?? null,
      summary: input.summary,
      meta: input.meta ?? {},
    });
  } catch (err) {
    logger.error('audit write failed', { action: input.action, err });
  }
}
