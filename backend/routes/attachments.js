// routes/attachments.js — replaces supabase.from('attachments')... calls
// (src/cloudStore.ts's addAttachment) plus a real-file option backed by
// backend/s3.js (see that file's header for why it's additive, not a 1:1
// port — supabase/schema.sql never had a storage bucket, only a freeform
// `url` column). Mounted at /api.
//
// No a_del policy existed in supabase/schema.sql — DELETE here is a
// deliberate, narrow addition for UI parity (see authz.js's
// canDeleteAttachment comment), gated the same as adding one.

import { Router } from 'express';
import multer from 'multer';
import { query } from '../db.js';
import { canSee, canAddAttachment, canDeleteAttachment } from '../authz.js';
import { fetchAllPeople, fetchProjectForAuthz } from '../serialize.js';
import { handle, HttpError } from '../errors.js';
import { attachmentKey, uploadAttachment, attachmentSignedUrl, removeObjects, MAX_ATTACHMENT_BYTES } from '../s3.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES } });

async function requireCanAdd(req, projectId) {
  const allPeople = await fetchAllPeople(query);
  const project = await fetchProjectForAuthz(query, projectId);
  if (!project) throw new HttpError(404, 'NOT_FOUND: project');
  if (!canAddAttachment(req.profile, project, allPeople)) {
    throw new HttpError(403, 'FORBIDDEN: cannot attach a document to a project outside your court');
  }
  return { allPeople, project };
}

// POST /api/projects/:projectId/attachments — link only (name, kind, url),
// the shape cloudStore.ts's addAttachment() has always sent.
router.post('/projects/:projectId/attachments', handle(async (req, res) => {
  const { projectId } = req.params;
  await requireCanAdd(req, projectId);
  const { name, kind, url } = req.body;
  const { rows } = await query(
    `insert into attachments (project_id, name, kind, url, by_id) values ($1,$2,$3,$4,$5) returning *`,
    [projectId, name, kind, url ?? null, req.profile.id]
  );
  res.status(201).json(rows[0]);
}));

// POST /api/projects/:projectId/attachments/upload — actual file upload
// (multipart/form-data, field name "file"), stored in S3. Additive — see
// file header. Requires ATTACHMENTS_BUCKET to be configured.
router.post('/projects/:projectId/attachments/upload', upload.single('file'), handle(async (req, res) => {
  const { projectId } = req.params;
  await requireCanAdd(req, projectId);
  if (!req.file) throw new HttpError(400, 'INVALID: no file provided');

  const key = attachmentKey(projectId, req.file.originalname);
  await uploadAttachment(key, req.file.buffer, req.file.mimetype);

  const kind = req.body.kind || 'Doc';
  const { rows } = await query(
    `insert into attachments (project_id, name, kind, storage_key, by_id) values ($1,$2,$3,$4,$5) returning *`,
    [projectId, req.body.name || req.file.originalname, kind, key, req.profile.id]
  );
  res.status(201).json(rows[0]);
}));

// GET /api/attachments/:id/url — a fresh 60s presigned download URL for an
// S3-stored attachment. Re-checks canSee() on the owning project FIRST — see
// s3.js's header on why this check has to live here, not in the bucket.
router.get('/attachments/:id/url', handle(async (req, res) => {
  const { rows } = await query('select * from attachments where id = $1', [req.params.id]);
  const attachment = rows[0];
  if (!attachment) throw new HttpError(404, 'NOT_FOUND: attachment');
  if (!attachment.storage_key) throw new HttpError(400, 'INVALID: this attachment is a link, not an uploaded file');

  const allPeople = await fetchAllPeople(query);
  const project = await fetchProjectForAuthz(query, attachment.project_id);
  if (!project || !canSee(req.profile, project, allPeople)) {
    throw new HttpError(403, 'FORBIDDEN: cannot view this attachment');
  }

  const url = await attachmentSignedUrl(attachment.storage_key);
  res.json({ url });
}));

// DELETE /api/attachments/:id — see file header.
router.delete('/attachments/:id', handle(async (req, res) => {
  const { rows } = await query('select * from attachments where id = $1', [req.params.id]);
  const attachment = rows[0];
  if (!attachment) throw new HttpError(404, 'NOT_FOUND: attachment');

  const allPeople = await fetchAllPeople(query);
  const project = await fetchProjectForAuthz(query, attachment.project_id);
  if (!project || !canDeleteAttachment(req.profile, project, allPeople)) {
    throw new HttpError(403, 'FORBIDDEN: cannot delete this attachment');
  }

  await query('delete from attachments where id = $1', [attachment.id]);
  if (attachment.storage_key) await removeObjects([attachment.storage_key]);
  res.json({ ok: true });
}));

export default router;
