import { Router } from 'express';
import multer from 'multer';
import { ImportMappingSchema } from '@campusflow/shared';
import { badRequest } from '../../lib/errors';
import { oid, parse, requireUser } from '../../lib/http';
import { loadEventFor } from '../../lib/access';
import { requireAuth } from '../../middleware/auth';
import { MAX_IMPORT_BYTES, analyzeBatch, commitBatch, listBatches, uploadImport } from './service';

export const importsRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } });

importsRouter.get('/events/:id/imports', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  res.json(await listBatches(event._id));
});

importsRouter.post('/events/:id/imports', requireAuth, upload.single('file'), async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  if (!req.file) throw badRequest('Choose a CSV file to upload');
  res.status(201).json(await uploadImport(user, event.toObject(), req.file));
});

importsRouter.post('/events/:id/imports/:batchId/analyze', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const input = parse(ImportMappingSchema, req.body);
  res.json(await analyzeBatch(event.toObject(), oid(req.params.batchId, 'Import'), input));
});

importsRouter.post('/events/:id/imports/:batchId/commit', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const input = parse(ImportMappingSchema, req.body);
  res.json(await commitBatch(user, event.toObject(), oid(req.params.batchId, 'Import'), input));
});
