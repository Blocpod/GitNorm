import {
  currentProfile,
  cleanupGarbageObjects,
  getD1,
  json,
  makeId,
  MAX_PROJECTS,
  MAX_REQUEST_SIZE,
  MAX_VERSIONS,
  validMutation,
} from "@/lib/gitnorm";
import { storageMode } from "@/lib/storage";
import { cleanupExpiredUploads } from "@/lib/uploads";

export const runtime = "nodejs";

const INTENT_LIFETIME_MS = 15 * 60 * 1000;
const MAX_PENDING_UPLOADS = 10;

type CreateIntentBody = {
  operation?: unknown;
  projectId?: unknown;
  expectedSize?: unknown;
  filename?: unknown;
};

function safeArchiveName(value: unknown) {
  const leaf = String(value || "project.zip")
    .replaceAll("\\", "/")
    .split("/")
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 180);
  if (!leaf) return "project.zip";
  return leaf.toLowerCase().endsWith(".zip") ? leaf : `${leaf}.zip`;
}

export async function POST(request: Request) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);

  const profile = await currentProfile();
  if (!profile)
    return json({ error: "Please sign in before uploading a project." }, 401);

  let input: CreateIntentBody;
  try {
    input = (await request.json()) as CreateIntentBody;
  } catch {
    return json({ error: "That upload request was not valid JSON." }, 400);
  }

  const operation = input.operation;
  if (operation !== "create_project" && operation !== "create_version")
    return json({ error: "Choose a valid upload operation." }, 400);

  const expectedSize = Number(input.expectedSize);
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize < 1 ||
    expectedSize > MAX_REQUEST_SIZE
  )
    return json(
      { error: "That archive is empty or larger than GitNorm's upload limit." },
      413,
    );

  const now = Date.now();
  await cleanupExpiredUploads(now).catch(() => undefined);
  await cleanupGarbageObjects().catch(() => undefined);

  const pending = await getD1()
    .prepare(
      `SELECT COUNT(*) AS count FROM upload_intents
       WHERE owner_id=? AND status IN ('pending','uploaded') AND expires_at>?`,
    )
    .bind(profile.id, now)
    .first<{ count: number }>();
  if ((pending?.count || 0) >= MAX_PENDING_UPLOADS)
    return json(
      {
        error:
          "Too many uploads are already waiting. Finish one or wait a few minutes and try again.",
      },
      429,
    );

  let projectId: string;
  if (operation === "create_project") {
    const [projectCount, reservedCount] = await Promise.all([
      getD1()
        .prepare(
          "SELECT COUNT(*) AS count FROM projects WHERE owner_id=? AND deleted_at IS NULL",
        )
        .bind(profile.id)
        .first<{ count: number }>(),
      getD1()
        .prepare(
          `SELECT COUNT(*) AS count FROM upload_intents
           WHERE owner_id=? AND operation='create_project'
             AND status IN ('pending','uploaded') AND expires_at>?`,
        )
        .bind(profile.id, now)
        .first<{ count: number }>(),
    ]);
    if (
      (projectCount?.count || 0) + (reservedCount?.count || 0) >=
      MAX_PROJECTS
    )
      return json(
        {
          error: `GitNorm currently supports up to ${MAX_PROJECTS} active projects per account.`,
        },
        409,
      );
    projectId = makeId("prj");
  } else {
    projectId = String(input.projectId || "").trim();
    if (!projectId)
      return json(
        { error: "Choose the project this version belongs to." },
        400,
      );

    const project = await getD1()
      .prepare(
        "SELECT id FROM projects WHERE id=? AND owner_id=? AND deleted_at IS NULL",
      )
      .bind(projectId, profile.id)
      .first();
    if (!project)
      return json({ error: "We could not find that project." }, 404);

    const [versionCount, reservedCount] = await Promise.all([
      getD1()
        .prepare("SELECT COUNT(*) AS count FROM versions WHERE project_id=?")
        .bind(projectId)
        .first<{ count: number }>(),
      getD1()
        .prepare(
          `SELECT COUNT(*) AS count FROM upload_intents
           WHERE owner_id=? AND project_id=? AND operation='create_version'
             AND status IN ('pending','uploaded') AND expires_at>?`,
        )
        .bind(profile.id, projectId, now)
        .first<{ count: number }>(),
    ]);
    if (
      (versionCount?.count || 0) + (reservedCount?.count || 0) >=
      MAX_VERSIONS
    )
      return json(
        {
          error: `This project has reached its ${MAX_VERSIONS}-version limit.`,
        },
        409,
      );
  }

  const intentId = makeId("upl");
  const storageKey = `users/${profile.id}/projects/${projectId}/uploads/${intentId}.zip`;
  const expiresAt = now + INTENT_LIFETIME_MS;
  const mode = storageMode();
  const tokenExpiresAt = mode === "blob" ? expiresAt : now;
  await getD1()
    .prepare(
      `INSERT INTO upload_intents
       (id,owner_id,project_id,operation,storage_key,status,filename,content_type,expected_size,payload_json,created_at,expires_at,token_expires_at)
       VALUES (?,?,?,?,?,'pending',?,'application/zip',?,?,?,?,?)`,
    )
    .bind(
      intentId,
      profile.id,
      projectId,
      operation,
      storageKey,
      safeArchiveName(input.filename),
      expectedSize,
      JSON.stringify({ projectId }),
      now,
      expiresAt,
      tokenExpiresAt,
    )
    .run();

  return json({
    intentId,
    projectId,
    storageKey,
    mode,
    expiresAt,
    uploadUrl: mode === "local" ? `/api/uploads/local/${intentId}` : undefined,
    handleUploadUrl: mode === "blob" ? "/api/uploads/blob" : undefined,
  });
}
