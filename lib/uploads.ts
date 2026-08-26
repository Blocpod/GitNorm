import { canonicalArchiveBytes, validateProjectArchive } from "@/lib/archive";
import {
  deleteObjects,
  getObject,
  headObject,
  putArchive,
} from "@/lib/storage";
import { getD1 } from "@/lib/gitnorm";

export type UploadOperation = "create_project" | "create_version";

export async function cleanupExpiredUploads(now = Date.now(), limit = 250) {
  const expired = await getD1()
    .prepare(
      `SELECT id,storage_key AS storageKey FROM upload_intents
       WHERE status IN ('pending','uploaded','expired') AND expires_at<=?
         AND (claimed_at IS NULL OR claimed_at<=?)
       ORDER BY expires_at ASC LIMIT ?`,
    )
    .bind(now, now - 5 * 60 * 1000, limit)
    .all<{ id: string; storageKey: string }>();
  if (!expired.results.length) return 0;
  await deleteObjects(expired.results.map((intent) => intent.storageKey));
  await getD1().batch(
    expired.results.map((intent) =>
      getD1()
        .prepare(
          `UPDATE upload_intents SET status='expired',claimed_at=NULL
           WHERE id=? AND status IN ('pending','uploaded','expired') AND expires_at<=?`,
        )
        .bind(intent.id, now),
    ),
  );
  return expired.results.length;
}

type UploadIntent = {
  id: string;
  ownerId: string;
  projectId: string;
  operation: UploadOperation;
  storageKey: string;
  status: "pending" | "uploaded" | "committed" | "expired";
  expectedSize: number;
  expiresAt: number;
};

export async function verifiedUploadIntent(input: {
  intentId: string;
  ownerId: string;
  operation: UploadOperation;
  projectId?: string;
}) {
  const intent = await getD1()
    .prepare(
      `SELECT id,owner_id AS ownerId,project_id AS projectId,operation,storage_key AS storageKey,status,expected_size AS expectedSize,expires_at AS expiresAt FROM upload_intents WHERE id=? AND owner_id=?`,
    )
    .bind(input.intentId, input.ownerId)
    .first<UploadIntent>();
  if (
    !intent ||
    intent.operation !== input.operation ||
    (input.projectId && intent.projectId !== input.projectId) ||
    intent.status === "committed" ||
    intent.status === "expired"
  )
    throw new Error(
      "That upload is no longer available. Please choose the folder again.",
    );
  if (intent.expiresAt <= Date.now()) {
    await deleteObjects([intent.storageKey]);
    await getD1()
      .prepare(
        "UPDATE upload_intents SET status='expired',claimed_at=NULL WHERE id=?",
      )
      .bind(intent.id)
      .run();
    throw new Error("That upload expired. Please choose the folder again.");
  }
  const claimedAt = Date.now();
  const claim = await getD1()
    .prepare(
      `UPDATE upload_intents SET claimed_at=?,expires_at=MAX(expires_at,?)
       WHERE id=? AND owner_id=? AND status IN ('pending','uploaded')
         AND claimed_at IS NULL AND expires_at>?`,
    )
    .bind(
      claimedAt,
      claimedAt + 5 * 60 * 1000,
      intent.id,
      input.ownerId,
      claimedAt,
    )
    .run();
  if (!claim.meta.changes)
    throw new Error("That upload is already being saved or was already used.");

  try {
    const head = await headObject(intent.storageKey);
    if (!head || head.size !== intent.expectedSize)
      throw new Error("GitNorm has not received the complete upload yet.");
    const object = await getObject(intent.storageKey);
    if (!object) throw new Error("GitNorm could not find that upload.");
    const archive = validateProjectArchive(await object.arrayBuffer());
    const canonical = canonicalArchiveBytes(archive);
    await putArchive(intent.storageKey, canonical);
    await getD1()
      .prepare(
        "UPDATE upload_intents SET expected_size=? WHERE id=? AND claimed_at=?",
      )
      .bind(canonical.byteLength, intent.id, claimedAt)
      .run();
    return { intent, archive };
  } catch (error) {
    try {
      await deleteObjects([intent.storageKey]);
      await getD1()
        .prepare(
          "UPDATE upload_intents SET status='expired',claimed_at=NULL WHERE id=? AND claimed_at=?",
        )
        .bind(intent.id, claimedAt)
        .run();
    } catch {
      await releaseUploadClaim(intent.id);
    }
    throw error;
  }
}

export function markUploadCommitted(intentId: string, now: number) {
  return getD1()
    .prepare(
      "UPDATE upload_intents SET status='committed',committed_at=?,claimed_at=NULL WHERE id=? AND status IN ('pending','uploaded') AND claimed_at IS NOT NULL",
    )
    .bind(now, intentId);
}

export async function releaseUploadClaim(intentId: string) {
  await getD1()
    .prepare(
      "UPDATE upload_intents SET claimed_at=NULL WHERE id=? AND status IN ('pending','uploaded')",
    )
    .bind(intentId)
    .run();
}
