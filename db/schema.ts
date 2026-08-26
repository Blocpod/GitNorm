import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable(
  "profiles",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    displayName: text("display_name").notNull(),
    handle: text("handle").notNull(),
    bio: text("bio").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_profiles_handle").on(table.handle)],
);
export const passkeys = sqliteTable(
  "passkeys",
  {
    credentialId: text("credential_id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    counter: integer("counter").notNull().default(0),
    transports: text("transports").notNull().default("[]"),
    deviceType: text("device_type").notNull(),
    backedUp: integer("backed_up").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (table) => [index("idx_passkeys_user").on(table.userId)],
);
export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [
    index("idx_sessions_user").on(table.userId),
    index("idx_sessions_expiry").on(table.expiresAt),
  ],
);
export const authChallenges = sqliteTable(
  "auth_challenges",
  {
    tokenHash: text("token_hash").primaryKey(),
    kind: text("kind").notNull(),
    challenge: text("challenge").notNull(),
    userId: text("user_id"),
    handle: text("handle"),
    displayName: text("display_name"),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_auth_challenges_expiry").on(table.expiresAt)],
);
export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => profiles.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    about: text("about").notNull().default(""),
    icon: text("icon").notNull().default("✦"),
    accent: text("accent").notNull().default("mint"),
    visibility: text("visibility").notNull().default("private"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (table) => [
    uniqueIndex("idx_projects_slug").on(table.slug),
    index("idx_projects_owner_updated").on(table.ownerId, table.updatedAt),
    index("idx_projects_public_updated").on(table.visibility, table.updatedAt),
  ],
);
export const versions = sqliteTable(
  "versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    note: text("note").notNull().default(""),
    summary: text("summary").notNull().default(""),
    fileCount: integer("file_count").notNull().default(0),
    totalSize: integer("total_size").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_versions_project_number").on(
      table.projectId,
      table.number,
    ),
    index("idx_versions_project_created").on(table.projectId, table.createdAt),
  ],
);
export const projectFiles = sqliteTable(
  "project_files",
  {
    id: text("id").primaryKey(),
    versionId: text("version_id")
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    storageKey: text("storage_key").notNull(),
    hash: text("hash").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
  },
  (table) => [
    uniqueIndex("idx_files_version_path").on(table.versionId, table.path),
    index("idx_files_project_version").on(table.projectId, table.versionId),
  ],
);
export const projectVersionCounters = sqliteTable("project_version_counters", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  nextVersion: integer("next_version").notNull(),
});
export const garbageObjects = sqliteTable("garbage_objects", {
  storageKey: text("storage_key").primaryKey(),
  createdAt: integer("created_at").notNull(),
});
export const rateLimits = sqliteTable(
  "rate_limits",
  {
    keyHash: text("key_hash").notNull(),
    windowStart: integer("window_start").notNull(),
    attempts: integer("attempts").notNull(),
  },
  (table) => [
    uniqueIndex("idx_rate_limit_key_window").on(
      table.keyHash,
      table.windowStart,
    ),
  ],
);
