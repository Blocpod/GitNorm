import { getDatabase, type D1CompatibleDatabase } from "./database";

export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    handle TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle ON profiles(handle)`,
  `CREATE TABLE IF NOT EXISTS passkeys (
    credential_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    device_type TEXT NOT NULL,
    backed_up INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(user_id)`,
  `CREATE TABLE IF NOT EXISTS auth_challenges (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('register','login')),
    challenge TEXT NOT NULL,
    user_id TEXT,
    handle TEXT,
    display_name TEXT,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges(expires_at)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES profiles(id),
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    about TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'orbit',
    accent TEXT NOT NULL DEFAULT 'mint',
    visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_owner_updated ON projects(owner_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_public_updated ON projects(visibility, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    upload_intent_id TEXT,
    number INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL DEFAULT '',
    file_count INTEGER NOT NULL DEFAULT 0,
    total_size INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_project_number ON versions(project_id, number)`,
  `CREATE INDEX IF NOT EXISTS idx_versions_project_created ON versions(project_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS project_files (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    hash TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_files_version_path ON project_files(version_id, path)`,
  `CREATE INDEX IF NOT EXISTS idx_files_project_version ON project_files(project_id, version_id)`,
  `CREATE TABLE IF NOT EXISTS project_version_counters (
    project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    next_version INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS garbage_objects (
    storage_key TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    delete_after INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS rate_limits (
    key_hash TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    attempts INTEGER NOT NULL,
    PRIMARY KEY(key_hash, window_start)
  )`,
  `CREATE TABLE IF NOT EXISTS upload_intents (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('create_project','create_version')),
    storage_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','uploaded','committed','expired')),
    filename TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/zip',
    expected_size INTEGER NOT NULL CHECK(expected_size > 0),
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    token_expires_at INTEGER NOT NULL,
    uploaded_at INTEGER,
    claimed_at INTEGER,
    committed_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_upload_intents_storage_key ON upload_intents(storage_key)`,
  `CREATE INDEX IF NOT EXISTS idx_upload_intents_owner_status ON upload_intents(owner_id, status, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_upload_intents_expiry ON upload_intents(status, expires_at)`,
  `CREATE TRIGGER IF NOT EXISTS trg_passkeys_owner_guard BEFORE INSERT ON passkeys BEGIN
    SELECT RAISE(ABORT, 'passkey owner missing') WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id=NEW.user_id);
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_sessions_owner_guard BEFORE INSERT ON sessions BEGIN
    SELECT RAISE(ABORT, 'session owner missing') WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id=NEW.user_id);
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_projects_owner_guard_v2 BEFORE INSERT ON projects BEGIN
    SELECT RAISE(ABORT, 'project owner missing') WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id=NEW.owner_id);
    SELECT RAISE(ABORT, 'project limit reached') WHERE (SELECT COUNT(*) FROM projects WHERE owner_id=NEW.owner_id AND deleted_at IS NULL) >= 50;
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_versions_project_guard_v2 BEFORE INSERT ON versions BEGIN
    SELECT RAISE(ABORT, 'version project missing') WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND deleted_at IS NULL);
    SELECT RAISE(ABORT, 'version limit reached') WHERE (SELECT COUNT(*) FROM versions WHERE project_id=NEW.project_id) >= 100;
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_files_parent_guard BEFORE INSERT ON project_files BEGIN
    SELECT RAISE(ABORT, 'file version missing') WHERE NOT EXISTS (SELECT 1 FROM versions WHERE id=NEW.version_id AND project_id=NEW.project_id);
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_counters_project_guard BEFORE INSERT ON project_version_counters BEGIN
    SELECT RAISE(ABORT, 'counter project missing') WHERE NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id);
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_uploads_owner_guard_v3 BEFORE INSERT ON upload_intents BEGIN
    SELECT RAISE(ABORT, 'upload owner missing') WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE id=NEW.owner_id);
    SELECT RAISE(ABORT, 'upload project missing') WHERE NEW.operation='create_version' AND NOT EXISTS (SELECT 1 FROM projects WHERE id=NEW.project_id AND owner_id=NEW.owner_id AND deleted_at IS NULL);
    SELECT RAISE(ABORT, 'pending upload limit reached') WHERE (SELECT COUNT(*) FROM upload_intents WHERE owner_id=NEW.owner_id AND status IN ('pending','uploaded') AND expires_at>NEW.created_at) >= 10;
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_versions_delete AFTER DELETE ON versions BEGIN
    DELETE FROM project_files WHERE version_id=OLD.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_projects_delete AFTER DELETE ON projects BEGIN
    DELETE FROM project_files WHERE project_id=OLD.id;
    DELETE FROM versions WHERE project_id=OLD.id;
    DELETE FROM project_version_counters WHERE project_id=OLD.id;
  END`,
  `CREATE TRIGGER IF NOT EXISTS trg_profiles_delete AFTER DELETE ON profiles BEGIN
    DELETE FROM project_files WHERE project_id IN (SELECT id FROM projects WHERE owner_id=OLD.id);
    DELETE FROM versions WHERE project_id IN (SELECT id FROM projects WHERE owner_id=OLD.id);
    DELETE FROM project_version_counters WHERE project_id IN (SELECT id FROM projects WHERE owner_id=OLD.id);
    DELETE FROM projects WHERE owner_id=OLD.id;
    DELETE FROM passkeys WHERE user_id=OLD.id;
    DELETE FROM sessions WHERE user_id=OLD.id;
    DELETE FROM upload_intents WHERE owner_id=OLD.id;
  END`,
] as const;

let migrationPromise: Promise<void> | undefined;

async function runMigrations(database: D1CompatibleDatabase) {
  await database.prepare("PRAGMA foreign_keys = ON").run();
  await database.batch(
    SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)),
  );

  // Early GitNorm databases may not have this column.
  const profileColumns = await database
    .prepare("PRAGMA table_info(profiles)")
    .all<{ name: string }>();
  if (!profileColumns.results.some((column) => column.name === "bio")) {
    await database
      .prepare("ALTER TABLE profiles ADD COLUMN bio TEXT NOT NULL DEFAULT ''")
      .run();
  }

  const versionColumns = await database
    .prepare("PRAGMA table_info(versions)")
    .all<{ name: string }>();
  if (
    !versionColumns.results.some((column) => column.name === "upload_intent_id")
  ) {
    await database
      .prepare("ALTER TABLE versions ADD COLUMN upload_intent_id TEXT")
      .run();
  }
  await database
    .prepare(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_versions_upload_intent ON versions(upload_intent_id) WHERE upload_intent_id IS NOT NULL",
    )
    .run();

  const uploadIntentColumns = await database
    .prepare("PRAGMA table_info(upload_intents)")
    .all<{ name: string }>();
  if (
    !uploadIntentColumns.results.some((column) => column.name === "claimed_at")
  ) {
    await database
      .prepare("ALTER TABLE upload_intents ADD COLUMN claimed_at INTEGER")
      .run();
  }
  if (
    !uploadIntentColumns.results.some(
      (column) => column.name === "token_expires_at",
    )
  ) {
    await database
      .prepare("ALTER TABLE upload_intents ADD COLUMN token_expires_at INTEGER")
      .run();
    await database
      .prepare(
        "UPDATE upload_intents SET token_expires_at=expires_at WHERE token_expires_at IS NULL",
      )
      .run();
  }

  const garbageColumns = await database
    .prepare("PRAGMA table_info(garbage_objects)")
    .all<{ name: string }>();
  if (
    !garbageColumns.results.some((column) => column.name === "delete_after")
  ) {
    await database
      .prepare(
        "ALTER TABLE garbage_objects ADD COLUMN delete_after INTEGER NOT NULL DEFAULT 0",
      )
      .run();
  }
}

/** Apply the full, idempotent GitNorm schema exactly once per process. */
export function migrateDatabase(database = getDatabase()) {
  migrationPromise ??= runMigrations(database).catch((error) => {
    migrationPromise = undefined;
    throw error;
  });
  return migrationPromise;
}
