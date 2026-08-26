import {
  currentProfile,
  getD1,
  json,
  MAX_REQUEST_SIZE,
  validMutation,
} from "@/lib/gitnorm";
import {
  deleteObjects,
  headObject,
  putLocalArchive,
  storageMode,
} from "@/lib/storage";

export const runtime = "nodejs";

type PendingIntent = {
  id: string;
  storageKey: string;
  expectedSize: number;
  status: string;
  expiresAt: number;
};

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (storageMode() !== "local")
    return json(
      { error: "Local uploads are disabled on this deployment." },
      404,
    );
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);

  const profile = await currentProfile();
  if (!profile) return json({ error: "Please sign in before uploading." }, 401);

  const { id } = await context.params;
  const intent = await getD1()
    .prepare(
      `SELECT id,storage_key AS storageKey,expected_size AS expectedSize,
              status,expires_at AS expiresAt
       FROM upload_intents WHERE id=? AND owner_id=?`,
    )
    .bind(id, profile.id)
    .first<PendingIntent>();
  if (!intent)
    return json({ error: "That upload is no longer available." }, 404);
  if (intent.status !== "pending")
    return json({ error: "That upload has already been used." }, 409);
  if (intent.expiresAt <= Date.now()) {
    await deleteObjects([intent.storageKey]).catch(() => undefined);
    await getD1()
      .prepare(
        "UPDATE upload_intents SET status='expired' WHERE id=? AND status='pending'",
      )
      .bind(intent.id)
      .run();
    return json({ error: "That upload expired. Start it again." }, 410);
  }

  const contentType = (request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    contentType !== "application/zip" &&
    contentType !== "application/octet-stream"
  )
    return json({ error: "GitNorm only accepts ZIP project archives." }, 415);

  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (
    (declaredSize && !Number.isSafeInteger(declaredSize)) ||
    declaredSize > MAX_REQUEST_SIZE ||
    (declaredSize && declaredSize !== intent.expectedSize)
  )
    return json({ error: "The uploaded archive size did not match." }, 413);

  const bytes = await request.arrayBuffer();
  if (
    bytes.byteLength < 1 ||
    bytes.byteLength > MAX_REQUEST_SIZE ||
    bytes.byteLength !== intent.expectedSize
  )
    return json({ error: "The uploaded archive size did not match." }, 413);

  if (await headObject(intent.storageKey))
    return json({ error: "That upload path is already occupied." }, 409);

  await putLocalArchive(intent.storageKey, bytes);
  const updated = await getD1()
    .prepare(
      `UPDATE upload_intents SET status='uploaded',uploaded_at=?
       WHERE id=? AND owner_id=? AND status='pending' AND expires_at>?`,
    )
    .bind(Date.now(), intent.id, profile.id, Date.now())
    .run();
  if (!updated.meta.changes) {
    await deleteObjects([intent.storageKey]).catch(() => undefined);
    return json({ error: "That upload could not be finalized." }, 409);
  }

  return json({ uploaded: true, intentId: intent.id });
}
