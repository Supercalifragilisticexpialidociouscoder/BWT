import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { DocumentConfigSchema, DocumentReviewSchema, MAX_DOCUMENT_BYTES, ParticipationDecisionSchema, requirementKeyField } from '@campusflow/shared';
import { notFound } from '../../lib/errors';
import { oid, parse, requireUser } from '../../lib/http';
import { loadEventFor } from '../../lib/access';
import { requireAuth } from '../../middleware/auth';
import { loadRegistrationFor } from '../registrations/service';
import {
  decideParticipation,
  documentConfigDTO,
  readableDocumentFile,
  registrationDocumentsDTO,
  removeTemplate,
  reviewDocument,
  saveDocumentConfig,
  saveTemplate,
  uploadDocument,
} from './service';
import { sendStoredFile } from './storage';

export const documentsRouter = Router();

/** One file per request, held in memory only until it is validated and written to private storage. */
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 0, parts: 2 },
});

const slotParam = z.string().regex(/^[a-z0-9]{8}:([a-f0-9]{24}|team)$/, 'Unknown document');
const versionQuery = z.coerce.number().int().min(1).optional();

/* ---------------------------------------------------------------- organizer: configuration */

documentsRouter.get('/events/:id/documents/config', requireAuth, async (req, res) => {
  const { event } = await loadEventFor(requireUser(req), req.params.id, 'manage');
  res.json(await documentConfigDTO(event.toObject()));
});

documentsRouter.put('/events/:id/documents/config', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  const input = parse(DocumentConfigSchema, req.body);
  const saved = await saveDocumentConfig(user, event, input);
  res.json(await documentConfigDTO(saved.toObject()));
});

documentsRouter.post('/events/:id/documents/requirements/:key/template', requireAuth, documentUpload.single('file'), async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  await saveTemplate(user, event, parse(requirementKeyField, req.params.key), req.file);
  const { event: fresh } = await loadEventFor(user, req.params.id, 'manage');
  res.json(await documentConfigDTO(fresh.toObject()));
});

documentsRouter.delete('/events/:id/documents/requirements/:key/template', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { event } = await loadEventFor(user, req.params.id, 'manage');
  await removeTemplate(user, event, parse(requirementKeyField, req.params.key));
  const { event: fresh } = await loadEventFor(user, req.params.id, 'manage');
  res.json(await documentConfigDTO(fresh.toObject()));
});

/** A blank form the organizers attached. Anyone who can see the event may download it. */
documentsRouter.get('/events/:id/documents/requirements/:key/template', async (req, res) => {
  const { event, access } = await loadEventFor(req.user, req.params.id, 'view');
  const requirement = event.documentRequirements.find((r) => r.key === req.params.key);
  if (!requirement?.template || (!requirement.active && !access.canManage)) throw notFound('Template');
  await sendStoredFile(res, requirement.template, false);
});

/* ---------------------------------------------------------------- participants and reviewers */

documentsRouter.get('/registrations/:id/documents', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { reg } = await loadRegistrationFor(user, oid(req.params.id, 'Registration'), 'view');
  res.json(await registrationDocumentsDTO(reg._id, user));
});

documentsRouter.post('/registrations/:id/documents/:slot', requireAuth, documentUpload.single('file'), async (req, res) => {
  const user = requireUser(req);
  const { reg } = await loadRegistrationFor(user, oid(req.params.id, 'Registration'), 'view');
  await uploadDocument(user, reg._id, parse(slotParam, req.params.slot), req.file);
  res.status(201).json(await registrationDocumentsDTO(reg._id, user));
});

documentsRouter.get('/documents/:id/file', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const version = parse(versionQuery, req.query.version);
  const file = await readableDocumentFile(user, oid(req.params.id, 'Document'), version);
  await sendStoredFile(res, file, req.query.inline === '1');
});

documentsRouter.post('/documents/:id/review', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const input = parse(DocumentReviewSchema, req.body);
  const regId = await reviewDocument(user, oid(req.params.id, 'Document'), input);
  res.json(await registrationDocumentsDTO(regId, user));
});

documentsRouter.post('/registrations/:id/participation', requireAuth, async (req, res) => {
  const user = requireUser(req);
  const { reg } = await loadRegistrationFor(user, oid(req.params.id, 'Registration'), 'manage');
  const input = parse(ParticipationDecisionSchema, req.body);
  await decideParticipation(user, reg._id, input);
  res.json(await registrationDocumentsDTO(reg._id, user));
});
