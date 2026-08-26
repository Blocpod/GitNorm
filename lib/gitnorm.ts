import { cookies } from "next/headers";
import { getDatabase } from "@/lib/database";
import { migrateDatabase } from "@/lib/database-schema";
import { deleteObjects } from "@/lib/storage";

export const MAX_FILES = 250;
export const MAX_FILE_SIZE = 8 * 1024 * 1024;
export const MAX_PROJECT_SIZE = 30 * 1024 * 1024;
export const MAX_PROJECTS = 50;
export const MAX_VERSIONS = 100;
export const MAX_REQUEST_SIZE = 34 * 1024 * 1024;
export const getD1 = getDatabase;

export async function ensureSchema() {
  await migrateDatabase();
}

export async function currentProfile() {
  await ensureSchema();
  const jar = await cookies();
  const token =
    jar.get("__Host-gitnorm_session")?.value ||
    jar.get("gitnorm_session")?.value;
  if (!token) return null;
  const tokenHash = await sha256Text(token);
  const profile = await getD1()
    .prepare(
      `SELECT p.id,p.email,p.display_name AS displayName,p.handle,p.bio,s.expires_at AS expiresAt FROM sessions s JOIN profiles p ON p.id=s.user_id WHERE s.token_hash=?`,
    )
    .bind(tokenHash)
    .first<{
      id: string;
      email: string;
      displayName: string;
      handle: string;
      bio: string;
      expiresAt: number;
    }>();
  if (!profile || profile.expiresAt <= Date.now()) return null;
  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.displayName,
    handle: profile.handle,
    bio: profile.bio,
  };
}

export function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}
export function makeSlug(title: string) {
  const stem =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 42) || "project";
  return `${stem}-${crypto.randomUUID().slice(0, 6)}`;
}
export function safePath(raw: string) {
  const value = raw.normalize("NFC").replaceAll("\\", "/").replace(/^\/+/, "");
  const lowerParts = value.toLowerCase().split("/");
  const sensitive =
    lowerParts.some(
      (part) =>
        [".git", "node_modules", ".next", ".turbo", "__macosx"].includes(
          part,
        ) || /^\.env(?:\.|$)/.test(part),
    ) ||
    /(^|\/)(id_rsa|id_ed25519|credentials|secrets?)(\.|$)/i.test(value) ||
    /\.(pem|key|p12|pfx)$/i.test(value);
  if (
    !value ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    value.split("/").some((part) => !part || part === "." || part === "..") ||
    sensitive
  )
    throw new Error(
      "GitNorm blocked a sensitive, generated, or unsafe file path.",
    );
  return value;
}
export async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function sha256Text(value: string) {
  return sha256(new TextEncoder().encode(value).buffer as ArrayBuffer);
}
export function requestBodyAllowed(request: Request) {
  const length = Number(request.headers.get("content-length") || 0);
  return !Number.isFinite(length) || length <= 0 || length <= MAX_REQUEST_SIZE;
}
export async function allocateVersionNumber(projectId: string) {
  await getD1()
    .prepare(
      `INSERT OR IGNORE INTO project_version_counters (project_id,next_version) SELECT ?,COALESCE(MAX(number),0)+1 FROM versions WHERE project_id=?`,
    )
    .bind(projectId, projectId)
    .run();
  const row = await getD1()
    .prepare(
      "UPDATE project_version_counters SET next_version=next_version+1 WHERE project_id=? RETURNING next_version-1 AS number",
    )
    .bind(projectId)
    .first<{ number: number }>();
  if (!row)
    throw new Error("GitNorm could not reserve a saved version number.");
  return row.number;
}
export async function rateLimit(
  request: Request,
  scope: string,
  limit: number,
  windowMs: number,
) {
  const address =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    "local";
  const keyHash = await sha256Text(`${scope}:${address}`);
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const row = await getD1()
    .prepare(
      `INSERT INTO rate_limits (key_hash,window_start,attempts) VALUES (?,?,1) ON CONFLICT(key_hash,window_start) DO UPDATE SET attempts=attempts+1 RETURNING attempts`,
    )
    .bind(keyHash, windowStart)
    .first<{ attempts: number }>();
  return (row?.attempts || limit + 1) <= limit;
}
export async function deleteProjectFully(projectId: string, ownerId: string) {
  const project = await getD1()
    .prepare("SELECT id FROM projects WHERE id=? AND owner_id=?")
    .bind(projectId, ownerId)
    .first();
  if (!project) return false;
  const now = Date.now();
  await getD1().batch([
    getD1()
      .prepare(
        `INSERT INTO garbage_objects (storage_key,created_at,delete_after)
         SELECT DISTINCT f.storage_key,?,MAX(?,COALESCE((SELECT MAX(ui.token_expires_at) FROM upload_intents ui WHERE ui.storage_key=f.storage_key),?))
         FROM project_files f WHERE f.project_id=?
         ON CONFLICT(storage_key) DO UPDATE SET delete_after=MAX(delete_after,excluded.delete_after)`,
      )
      .bind(now, now, now, projectId),
    getD1()
      .prepare(
        `INSERT INTO garbage_objects (storage_key,created_at,delete_after)
         SELECT storage_key,?,CASE WHEN MAX(token_expires_at)>? THEN MAX(token_expires_at) ELSE ? END
         FROM upload_intents WHERE project_id=? GROUP BY storage_key
         ON CONFLICT(storage_key) DO UPDATE SET delete_after=MAX(delete_after,excluded.delete_after)`,
      )
      .bind(now, now, now, projectId),
    getD1()
      .prepare("DELETE FROM upload_intents WHERE project_id=? AND owner_id=?")
      .bind(projectId, ownerId),
    getD1()
      .prepare("DELETE FROM projects WHERE id=? AND owner_id=?")
      .bind(projectId, ownerId),
  ]);
  await cleanupGarbageObjects(500).catch(() => undefined);
  return true;
}
export async function cleanupGarbageObjects(limit = 50) {
  const objects = await getD1()
    .prepare(
      "SELECT storage_key AS storageKey FROM garbage_objects WHERE delete_after<=? ORDER BY created_at ASC LIMIT ?",
    )
    .bind(Date.now(), limit)
    .all<{ storageKey: string }>();
  const keys = objects.results.map((object) => object.storageKey);
  if (!keys.length) return 0;
  await deleteObjects(keys);
  await getD1().batch(
    keys.map((key) =>
      getD1()
        .prepare("DELETE FROM garbage_objects WHERE storage_key=?")
        .bind(key),
    ),
  );
  return keys.length;
}
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
export function validMutation(request: Request) {
  return request.headers.get("Origin") === new URL(request.url).origin;
}
