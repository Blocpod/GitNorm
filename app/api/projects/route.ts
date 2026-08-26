import {
  currentProfile,
  ensureSchema,
  getD1,
  json,
  makeId,
  makeSlug,
  MAX_PROJECTS,
  validMutation,
} from "@/lib/gitnorm";
import {
  markUploadCommitted,
  releaseUploadClaim,
  verifiedUploadIntent,
} from "@/lib/uploads";

export async function GET(request: Request) {
  await ensureSchema();
  const discover = new URL(request.url).searchParams.get("discover") === "1";
  if (discover) {
    const result = await getD1()
      .prepare(
        `SELECT p.id,p.slug,p.title,p.description,p.icon,p.accent,p.updated_at AS updatedAt,pr.display_name AS creator,pr.handle,v.file_count AS fileCount FROM projects p JOIN profiles pr ON pr.id=p.owner_id LEFT JOIN versions v ON v.project_id=p.id AND v.number=(SELECT MAX(number) FROM versions WHERE project_id=p.id) WHERE p.visibility='public' AND p.deleted_at IS NULL ORDER BY p.updated_at DESC LIMIT 24`,
      )
      .all();
    return json({ projects: result.results });
  }
  const profile = await currentProfile();
  if (!profile)
    return json({ error: "Please sign in to see your projects." }, 401);
  const result = await getD1()
    .prepare(
      `SELECT p.id,p.slug,p.title,p.description,p.about,p.icon,p.accent,p.visibility,p.created_at AS createdAt,p.updated_at AS updatedAt,v.number AS version,v.file_count AS fileCount,v.total_size AS totalSize FROM projects p LEFT JOIN versions v ON v.project_id=p.id AND v.number=(SELECT MAX(number) FROM versions WHERE project_id=p.id) WHERE p.owner_id=? AND p.deleted_at IS NULL ORDER BY p.updated_at DESC`,
    )
    .bind(profile.id)
    .all();
  return json({ profile, projects: result.results });
}

export async function POST(request: Request) {
  if (!validMutation(request))
    return json({ error: "This request came from an unexpected site." }, 403);
  const profile = await currentProfile();
  if (!profile)
    return json({ error: "Please sign in before adding a project." }, 401);
  const projectCount = await getD1()
    .prepare(
      "SELECT COUNT(*) AS count FROM projects WHERE owner_id=? AND deleted_at IS NULL",
    )
    .bind(profile.id)
    .first<{ count: number }>();
  if ((projectCount?.count || 0) >= MAX_PROJECTS)
    return json(
      {
        error: `GitNorm currently supports up to ${MAX_PROJECTS} active projects per account.`,
      },
      409,
    );

  let activeIntentId = "";
  try {
    const body = (await request.json()) as {
      intentId?: string;
      title?: string;
      description?: string;
      visibility?: string;
      note?: string;
    };
    const title = String(body.title || "")
      .trim()
      .slice(0, 80);
    const description = String(body.description || "")
      .trim()
      .slice(0, 220);
    const visibility = body.visibility === "public" ? "public" : "private";
    const note = String(body.note || "First saved version")
      .trim()
      .slice(0, 160);
    if (!title) return json({ error: "Give your project a name first." }, 400);
    if (!body.intentId)
      return json({ error: "Choose a project folder to upload first." }, 400);

    const { intent, archive } = await verifiedUploadIntent({
      intentId: body.intentId,
      ownerId: profile.id,
      operation: "create_project",
    });
    activeIntentId = intent.id;
    const projectId = intent.projectId;
    const versionId = makeId("ver");
    const now = Date.now();
    const iconChoices = ["orbit", "sprout", "prism", "wave"];
    const accentChoices = ["mint", "sun", "lilac", "coral", "sky"];

    await getD1().batch([
      getD1()
        .prepare(
          `INSERT INTO projects (id,owner_id,slug,title,description,about,icon,accent,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          projectId,
          profile.id,
          makeSlug(title),
          title,
          description,
          "",
          iconChoices[Math.floor(Math.random() * iconChoices.length)],
          accentChoices[Math.floor(Math.random() * accentChoices.length)],
          visibility,
          now,
          now,
        ),
      getD1()
        .prepare(
          "INSERT INTO project_version_counters (project_id,next_version) VALUES (?,2)",
        )
        .bind(projectId),
      getD1()
        .prepare(
          `INSERT INTO versions (id,project_id,upload_intent_id,number,note,summary,file_count,total_size,created_at) VALUES (?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          versionId,
          projectId,
          intent.id,
          1,
          note,
          `${archive.fileCount} files safely saved`,
          archive.fileCount,
          archive.totalSize,
          now,
        ),
      ...archive.files.map((file) =>
        getD1()
          .prepare(
            `INSERT INTO project_files (id,version_id,project_id,path,storage_key,hash,mime_type,size) VALUES (?,?,?,?,?,?,?,?)`,
          )
          .bind(
            makeId("fil"),
            versionId,
            projectId,
            file.path,
            intent.storageKey,
            file.hash,
            file.mimeType,
            file.size,
          ),
      ),
      markUploadCommitted(intent.id, now),
    ]);
    return json(
      { id: projectId, message: "Your project is safely saved." },
      201,
    );
  } catch (error) {
    if (activeIntentId) await releaseUploadClaim(activeIntentId);
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "We could not save that project. Your files are still safe on your device.",
      },
      400,
    );
  }
}
