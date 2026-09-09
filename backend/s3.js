// s3.js — attachment file storage, adapted from gyftr-ceo-portal/backend/s3.js.
//
// The old shape (attachments already had a freeform `url` column — cloudStore.ts's
// addAttachment(name, kind, url?) always passed a caller-supplied URL, usually a
// Google Doc / Figma / SharePoint link, not an uploaded file) had NO Supabase
// Storage bucket behind it in supabase/schema.sql — every attachment was, and
// still is, allowed to be a plain external link. This module is additive: it
// gives routes/attachments.js a real, private-bucket option for teams that want
// to upload an actual file instead of pasting a link, without changing the
// existing link-only behaviour or the `attachments.url` column's shape.
//
// Operations: PutObject, a short-lived presigned GetObject, and DeleteObjects —
// same private-bucket model as the CEO Office/Legal siblings' attachment buckets.
//
// ── Authorization note (same shape as the sibling this was copied from) ──
// S3 cannot consult authz.js. A presigned URL is valid for whoever holds it, so
// the check has to happen at the one place that mints URLs: routes/attachments.js
// re-reads the attachment's project through canSee() FIRST, and only presigns if
// that returns true. The bucket must stay private with public access fully
// blocked — if it were readable directly, that check would be decorative.

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

const BUCKET = process.env.ATTACHMENTS_BUCKET;
const s3 = new S3Client({ region: process.env.AWS_REGION || 'ap-south-1' });

// Generous default for BRDs/PRDs/design exports — adjust per real usage once live.
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function requireBucket() {
  if (!BUCKET) throw new Error('ATTACHMENTS_BUCKET env var is not set');
  return BUCKET;
}

/** `project/<id>/<uuid>-<safe file name>` — browsable by project, and
 *  namespaced enough that an orphan-cleanup-by-prefix pass is possible later. */
export function attachmentKey(projectId, fileName) {
  const safe = String(fileName).replace(/[^\w.-]+/g, '_');
  return `project/${projectId}/${randomUUID()}-${safe}`;
}

export async function uploadAttachment(key, buffer, contentType) {
  await s3.send(new PutObjectCommand({
    Bucket: requireBucket(),
    Key: key,
    Body: buffer,
    ContentType: contentType || 'application/octet-stream',
  }));
  return key;
}

/** Short-lived presigned GET URL — a bearer credential, kept just long
 *  enough to open a file, not to be forwarded or embedded anywhere durable. */
export async function attachmentSignedUrl(key, expiresInSeconds = 60) {
  const command = new GetObjectCommand({ Bucket: requireBucket(), Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/** Best-effort removal — deliberately does not throw. The DB row is always
 *  deleted first (the authoritative action, already irreversible); a
 *  leftover S3 object is unreachable anyway since no row means no route
 *  will ever presign it. */
export async function removeObjects(keys) {
  if (!keys?.length) return;
  try {
    for (let i = 0; i < keys.length; i += 1000) {
      await s3.send(new DeleteObjectsCommand({
        Bucket: requireBucket(),
        Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true },
      }));
    }
  } catch (err) {
    console.warn('[s3] could not remove orphaned attachment objects:', err.message);
  }
}
