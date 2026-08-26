import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '@/app/chatgpt-auth';

export const MAX_FILES = 250;
export const MAX_FILE_SIZE = 8 * 1024 * 1024;
export const MAX_PROJECT_SIZE = 30 * 1024 * 1024;
let schemaReady = false;

export function getD1(): D1Database { return env.DB; }
export function getFilesBucket(): R2Bucket { return env.FILES; }

export async function ensureSchema() {
  if (schemaReady) return;
  const db = getD1();
  const sql = [
    `CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, email TEXT NOT NULL, display_name TEXT NOT NULL, handle TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle ON profiles(handle)`,
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
  ];
  await db.batch(sql.map((statement) => db.prepare(statement)));
  schemaReady = true;
}

export async function currentProfile() {
  const user = await getChatGPTUser();
  if (!user) return null;
  await ensureSchema();
  const now = Date.now();
  const base = (user.fullName || user.email.split('@')[0] || 'maker').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'maker';
  const existing = await getD1().prepare('SELECT id, email, display_name AS displayName, handle FROM profiles WHERE id = ?').bind(user.userId).first<{id:string;email:string;displayName:string;handle:string}>();
  if (existing) {
    await getD1().prepare('UPDATE profiles SET email = ?, display_name = ?, updated_at = ? WHERE id = ?').bind(user.email, user.displayName, now, user.userId).run();
    return { ...existing, email: user.email, displayName: user.displayName };
  }
  let handle = base;
  if (await getD1().prepare('SELECT id FROM profiles WHERE handle = ?').bind(handle).first()) handle = `${base}${Math.floor(1000 + Math.random() * 9000)}`;
  await getD1().prepare('INSERT INTO profiles (id,email,display_name,handle,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(user.userId, user.email, user.displayName, handle, now, now).run();
  return { id: user.userId, email: user.email, displayName: user.displayName, handle };
}

export function makeId(prefix: string) { return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`; }
export function makeSlug(title: string) { const stem = title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'project'; return `${stem}-${crypto.randomUUID().slice(0, 6)}`; }
export function safePath(raw: string) { const value = raw.normalize('NFC').replaceAll('\\', '/').replace(/^\/+/, ''); if (!value || value.length > 500 || value.includes('\0') || value.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('One of those file names is not safe to save.'); return value; }
export async function sha256(bytes: ArrayBuffer) { const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
export function json(data: unknown, status = 200) { return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }); }
export function validMutation(request: Request) { const origin=request.headers.get('Origin'); return !origin||origin===new URL(request.url).origin; }
