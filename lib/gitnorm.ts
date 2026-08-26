import { env } from "cloudflare:workers";
import { cookies } from "next/headers";

export const MAX_FILES = 250;
export const MAX_FILE_SIZE = 8 * 1024 * 1024;
export const MAX_PROJECT_SIZE = 30 * 1024 * 1024;
export const MAX_PROJECTS = 50;
export const MAX_VERSIONS = 100;
export const MAX_REQUEST_SIZE = 34 * 1024 * 1024;
let schemaReady = false;

export function getD1(): D1Database {
  return env.DB;
}
export function getFilesBucket(): R2Bucket {
  return env.FILES;
}

export async function ensureSchema() {
  if (schemaReady) return;
  const db = getD1();
  const sql = [
    `CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, handle TEXT NOT NULL, bio TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle ON profiles(handle)`,
    `CREATE TABLE IF NOT EXISTS passkeys (credential_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]', device_type TEXT NOT NULL, backed_up INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_used_at INTEGER)`,
    `CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id)`,
    `CREATE TABLE IF NOT EXISTS auth_challenges (token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('register','login')), challenge TEXT NOT NULL, user_id TEXT, handle TEXT, display_name TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges(expires_at)`,
    `CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`,
    `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES profiles(id), slug TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', about TEXT NOT NULL DEFAULT '', icon TEXT NOT NULL DEFAULT '✦', accent TEXT NOT NULL DEFAULT 'mint', visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)`,
    `CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_id, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_projects_public_updated ON projects(visibility, updated_at DESC)`,
    `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, number INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', file_count INTEGER NOT NULL DEFAULT 0, total_size INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_project_number ON versions(project_id, number)`,
    `CREATE INDEX IF NOT EXISTS idx_versions_project_created ON versions(project_id, created_at DESC)`,
    `CREATE TABLE IF NOT EXISTS project_files (id TEXT PRIMARY KEY, version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, path TEXT NOT NULL, storage_key TEXT NOT NULL, hash TEXT NOT NULL, mime_type TEXT NOT NULL, size INTEGER NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_files_version_path ON project_files(version_id, path)`,
    `CREATE INDEX IF NOT EXISTS idx_files_project_version ON project_files(project_id, version_id)`,
    `CREATE TABLE IF NOT EXISTS project_version_counters (project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, next_version INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS garbage_objects (storage_key TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS rate_limits (key_hash TEXT NOT NULL, window_start INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(key_hash,window_start))`,
  ];
  await db.batch(sql.map((statement) => db.prepare(statement)));
  const profileColumns = await db
    .prepare("PRAGMA table_info(profiles)")
    .all<{ name: string }>();
  if (!profileColumns.results.some((column) => column.name === "bio"))
    await db
      .prepare("ALTER TABLE profiles ADD COLUMN bio TEXT NOT NULL DEFAULT ''")
      .run();
  schemaReady = true;
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
  const objects = await getD1()
    .prepare(
      "SELECT DISTINCT storage_key AS storageKey FROM project_files WHERE project_id=?",
    )
    .bind(projectId)
    .all<{ storageKey: string }>();
  const now = Date.now();
  await getD1().batch([
    ...objects.results.map((object) =>
      getD1()
        .prepare(
          "INSERT OR IGNORE INTO garbage_objects (storage_key,created_at) VALUES (?,?)",
        )
        .bind(object.storageKey, now),
    ),
    getD1()
      .prepare("DELETE FROM projects WHERE id=? AND owner_id=?")
      .bind(projectId, ownerId),
  ]);
  const keys = objects.results.map((object) => object.storageKey);
  if (keys.length) {
    await getFilesBucket().delete(keys);
    await getD1().batch(
      keys.map((key) =>
        getD1()
          .prepare("DELETE FROM garbage_objects WHERE storage_key=?")
          .bind(key),
      ),
    );
  }
  return true;
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
