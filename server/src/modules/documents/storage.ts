import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, constants as fsConstants } from 'node:fs';
import { access, mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Response } from 'express';
import type { DocumentFormat } from '@campusflow/shared';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { IStoredFile } from '../../models';

/**
 * Private file storage for participant documents and requirement templates.
 *
 * Files live under DOCUMENT_DIR (outside the publicly served UPLOAD_DIR — the server refuses to start
 * otherwise), under random names chosen here. The original filename is only kept, sanitised, as
 * metadata for the download. Files are read back exclusively through authorized API routes.
 */

export type StoredKind = DocumentFormat | 'docx';

export const MIME: Record<StoredKind, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const EXT: Record<StoredKind, string> = { pdf: '.pdf', jpg: '.jpg', png: '.png', docx: '.docx' };

/**
 * Identify a file by its content, never by its name or the browser's declared type, so an
 * executable or script renamed to `.pdf` is refused.
 */
export function sniffFile(buf: Buffer): StoredKind | null {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  // DOCX is a ZIP package; require the Word part names so arbitrary archives are refused.
  if (
    buf.length > 30 &&
    buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) &&
    buf.includes('[Content_Types].xml') &&
    buf.includes('word/')
  ) {
    return 'docx';
  }
  return null;
}

/** A display/download name: no directories, control characters or odd punctuation; extension matches the content. */
export function safeFileName(original: string | undefined, kind: StoredKind): string {
  const base = (original ?? '')
    .normalize('NFKC')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.[^.]*$/, '')
    .replace(/[^\p{L}\p{N} ._()-]+/gu, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .slice(0, 80);
  return `${base || 'document'}${EXT[kind]}`;
}

function root() {
  return path.resolve(env.DOCUMENT_DIR);
}

/** Resolve a stored relative path, refusing anything that would escape the private root. */
function resolveStored(storedName: string): string {
  const full = path.resolve(root(), storedName);
  if (!full.startsWith(root() + path.sep)) throw new AppError(500, 'storage_path', 'Invalid stored file path');
  return full;
}

let probe: { at: number; ok: boolean } | null = null;

/** Whether the private directory is writable (a success is cached briefly; failures are re-checked). */
export async function storageAvailable(): Promise<boolean> {
  if (probe?.ok && Date.now() - probe.at < 10_000) return true;
  let ok = true;
  try {
    await mkdir(root(), { recursive: true, mode: 0o700 });
    await access(root(), fsConstants.W_OK);
  } catch (err) {
    ok = false;
    logger.error('document storage unavailable', { dir: root(), err });
  }
  probe = { at: Date.now(), ok };
  return ok;
}

export const storageUnavailable = () =>
  new AppError(503, 'storage_unavailable', 'Document storage is unavailable on the server right now. Nothing was saved — try again later or tell the organizers.');

/** Write a new private file (never overwrites) and describe it. */
export async function storeFile(opts: {
  folder: string;
  buffer: Buffer;
  kind: StoredKind;
  originalName: string | undefined;
  uploadedBy: IStoredFile['uploadedBy'];
}): Promise<IStoredFile> {
  if (!(await storageAvailable())) throw storageUnavailable();
  const relative = path.join(opts.folder, `${randomBytes(16).toString('hex')}${EXT[opts.kind]}`);
  const full = resolveStored(relative);
  try {
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, opts.buffer, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    logger.error('document write failed', { err });
    probe = null;
    throw storageUnavailable();
  }
  return {
    storedName: relative,
    originalName: safeFileName(opts.originalName, opts.kind),
    mime: MIME[opts.kind],
    size: opts.buffer.length,
    sha256: createHash('sha256').update(opts.buffer).digest('hex'),
    uploadedBy: opts.uploadedBy,
    uploadedAt: new Date(),
  };
}

/** Remove a file that was written but never recorded (a lost race). Recorded files are never deleted. */
export async function discardUnrecorded(file: IStoredFile) {
  await unlink(resolveStored(file.storedName)).catch(() => undefined);
}

/**
 * Stream a private file. Images may be shown inline (for review); everything else downloads.
 * Responses are never cached and can't be sniffed into something executable.
 */
export async function sendStoredFile(res: Response, file: Pick<IStoredFile, 'storedName' | 'originalName' | 'mime' | 'size'>, inline: boolean) {
  const full = resolveStored(file.storedName);
  try {
    await stat(full);
  } catch (err) {
    logger.error('document missing from storage', { storedName: file.storedName, err });
    throw new AppError(503, 'storage_unavailable', 'This file can’t be read from storage right now. Ask the organizers or try again later.');
  }
  const disposition = inline && (file.mime.startsWith('image/') || file.mime === 'application/pdf') ? 'inline' : 'attachment';
  const ascii = file.originalName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  res.setHeader('Content-Type', file.mime);
  res.setHeader('Content-Length', String(file.size));
  res.setHeader('Content-Disposition', `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Nothing in a served document may run script or reach the network as this origin. (Checked: Chrome's
  // PDF viewer still renders inline under this sandboxed policy.)
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  await new Promise<void>((resolve) => {
    const stream = createReadStream(full);
    stream.on('error', (err) => {
      logger.error('document read failed', { err });
      res.destroy();
      resolve();
    });
    stream.on('end', resolve);
    stream.pipe(res);
  });
}
